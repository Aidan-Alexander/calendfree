// Every /api/* and /auth/* request comes through here.
import { DateTime } from 'luxon';
import { cfg, isAdmin, missingConfig } from './config.mjs';
import { sign, verify, encrypt, randomId } from './crypto.mjs';
import * as google from './google.mjs';
import { getJSON, setJSON, remove, listKeys, userKey, pageKey, bookingKey } from './store.mjs';
import { accessTokenFor, availability, forgetToken, getUser, hostNames, hostStatuses } from './calendar.mjs';
import { preferredSlots } from './slots.mjs';
import {
  RESERVED, clampDuration, defaultPage, demoPage, firstName, isEmail, joinNames, locationLabel, normaliseHours,
  normalisePage, normaliseRules, normaliseTravel, DEFAULT_RULES, parsePeople, prettyName, publicPage, validTimezone,
} from './pages.mjs';
import { json, redirect as rawRedirect, getCookie, cookie, origin, readBody } from './http.mjs';
import { adminFeedback, publicFeedback } from './feedback.mjs';

// Paths like "/admin/" are inside the app; they get the app's public address (and base path) in front.
const redirect = (req, location, cookies = []) => rawRedirect(location, cookies, req);

const SESSION = 'ov_session';
const OAUTH = 'ov_oauth';
const HOST = 'ov_host'; // a colleague who just opted in, so they can set their own working hours
const validToken = (t) => /^[A-Za-z0-9_-]{8,40}$/.test(String(t || ''));
const DAY = 86_400_000;
const now = () => new Date().toISOString();
const settings = async () => (await getJSON('settings/site')) || {};

export default async function handle(req) {
  const url = new URL(req.url);
  const base = cfg().basePath;
  let path = url.pathname;
  if (base && (path === base || path.startsWith(`${base}/`))) path = path.slice(base.length);
  path = path.replace(/\/+$/, '');
  const get = req.method === 'GET';
  const post = req.method === 'POST';
  try {
    // Signing in (admins) and opting in (colleagues)
    if (path === '/auth/login') return await login(req, url);
    if (path === '/auth/connect') return await connect(req, url);
    if (path === '/auth/callback') return await callback(req, url);
    if (path === '/auth/logout') return redirect(req, '/admin/', [cookie(req, SESSION, '', 0)]);

    // Public
    if (path === '/api/public/status' && get) {
      return json({ missing: missingConfig(), redirectUri: `${origin(req)}/auth/callback`, fake: cfg().fake });
    }
    if (path === '/api/public/page' && get) return await publicPageRoute(url);
    if (path === '/api/public/slots' && get) return await slotsRoute(url);
    if (path === '/api/public/book' && post) return await bookRoute(req);
    if (path === '/api/public/booking' && get) return await bookingRoute(url);
    if (path === '/api/public/cancel' && post) return await cancelRoute(req);
    if (path === '/api/public/connect' && get) return await connectInfoRoute(url);
    if (path.startsWith('/api/public/feedback')) return await publicFeedback(req, path);
    if (path === '/api/host/me' || path === '/api/host/hours') return await hostSelfRoute(req, path);

    // Admin
    // Signed in: admins (who make pages) and editors (who can change pages someone has shared with them).
    const session = await verify(getCookie(req, SESSION)).catch(() => null);
    const email = session?.email && (isAdmin(session.email) || (await isEditor(session.email))) ? session.email : null;
    if (path === '/api/me' && get) return email ? await me(email) : json({ error: 'signed_out' }, 401);
    if (!path.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    if (!email) return json({ error: 'signed_out' }, 401);
    // Admin changes must come from our own pages (a custom header can't be sent cross-site without permission).
    if (!get && req.headers.get('x-overlap') !== '1') return json({ error: 'bad_request' }, 400);
    if (path === '/api/feedback') return isAdmin(email) ? await adminFeedback(req, url) : json({ enabled: false });
    if (path === '/api/pages' && get) return await listPages(email, url);
    if (path === '/api/pages' && req.method === 'PUT') return await savePage(email, req);
    if (path === '/api/pages' && req.method === 'DELETE') return await deletePage(email, url);
    if (path === '/api/hosts' && get) return await hostsRoute(email, url);
    if (path === '/api/settings' && req.method === 'PUT') return await saveSettings(email, req);
    if (path === '/api/settings/test-email' && post) return await testEmail(email);
    if (path === '/api/hours' && req.method === 'PUT') return await saveHostHours(email, req);
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: 'server_error', message: e.message }, e.status || 500);
  }
}

// ---------- Google sign-in ----------

async function startOAuth(req, kind, extra, { scopes, prompt, loginHint }) {
  const state = randomId(16);
  const ticket = await sign({ n: state, kind, ...extra, exp: Date.now() + 10 * 60_000 });
  const location = google.authUrl({ redirectUri: `${origin(req)}/auth/callback`, scopes, state, prompt, loginHint });
  return redirect(req, location, [cookie(req, OAUTH, ticket, 600)]);
}

async function login(req, url) {
  if (missingConfig().length) return redirect(req, '/admin/?error=setup');
  if (url.searchParams.get('editor') === '1') {
    // Editors only need to say who they are: no calendar access.
    if (cfg().fake) {
      const as = String(url.searchParams.get('as') || 'editor@example.org').toLowerCase();
      return finishEditor(req, { email: as, name: prettyName(as) });
    }
    return startOAuth(req, 'editor', {}, { scopes: ['openid', 'email', 'profile'], prompt: 'select_account' });
  }
  if (cfg().fake) {
    // Local testing only: pretend Google said yes.
    const email = cfg().admins[0] || 'you@example.org';
    return finishAdmin(req, { email, name: prettyName(email) }, { refresh_token: `fake-refresh:${email}` }, [], false, url.searchParams.get('gmail') === '1');
  }
  const consent = url.searchParams.get('consent') === '1';
  const gmail = url.searchParams.get('gmail') === '1'; // switching on booking emails
  return startOAuth(req, 'admin', { consent, gmail }, {
    scopes: gmail ? [...google.ADMIN_SCOPES, google.SCOPE_GMAIL_SEND] : google.ADMIN_SCOPES,
    prompt: consent ? 'consent' : 'select_account',
    loginHint: url.searchParams.get('hint') || undefined,
  });
}

async function connect(req, url) {
  const slug = String(url.searchParams.get('p') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 49);
  if (missingConfig().length) return redirect(req, `/connect/?p=${slug}&error=setup`);
  if (cfg().fake) {
    // Local testing: act as ?as=<email>, or else the page's first made-up colleague whose calendar is "hidden".
    const page = await loadPage(slug);
    const as = String(url.searchParams.get('as') || page?.hosts.find((h) => /hidden|private/.test(h.email))?.email || 'new.colleague@example.org').toLowerCase();
    if (!isEmail(as)) return redirect(req, `/connect/?p=${slug}&error=fake`);
    return finishHost(req, { email: as, name: prettyName(as) }, { refresh_token: `fake-refresh:${as}` }, slug);
  }
  return startOAuth(req, 'host', { p: slug }, { scopes: google.HOST_SCOPES, prompt: 'consent' });
}

async function callback(req, url) {
  const ticket = await verify(getCookie(req, OAUTH)).catch(() => null);
  const clear = [cookie(req, OAUTH, '', 0)];
  const back = ticket?.kind === 'host' ? `/connect/?p=${ticket.p || ''}&` : '/admin/?';
  if (!ticket || ticket.n !== url.searchParams.get('state')) return redirect(req, `${back}error=expired`, clear);
  if (url.searchParams.get('error') || !url.searchParams.get('code')) return redirect(req, `${back}error=cancelled`, clear);
  const tokens = await google.exchangeCode(url.searchParams.get('code'), `${origin(req)}/auth/callback`);
  const claims = google.idTokenClaims(tokens.id_token);
  if (!claims.email || claims.email_verified === false) return redirect(req, `${back}error=no_email`, clear);
  if (ticket.kind === 'host') return finishHost(req, claims, tokens, ticket.p, clear);
  if (ticket.kind === 'editor') return finishEditor(req, claims, clear);
  return finishAdmin(req, claims, tokens, clear, ticket.consent, ticket.gmail);
}

const granted = (tokens) => String(tokens.scope || '').split(' ');

// Editors: who may change which pages, kept as one small index so every request doesn't read every page.
const EDITORS_KEY = 'settings/editors';
async function isEditor(email) {
  const index = (await getJSON(EDITORS_KEY)) || {};
  return Boolean(index[String(email).toLowerCase()]?.length);
}
async function rebuildEditorIndex() {
  const index = {};
  for (const p of await allPages()) for (const e of p.editors || []) (index[e] ||= []).push(p.slug);
  await setJSON(EDITORS_KEY, index);
}
const canEdit = (page, email) => Boolean(page && (page.owner === email || (page.editors || []).includes(email)));

// Signs in someone who edits other people's pages. Their calendar isn't touched, so nothing is stored but their name.
async function finishEditor(req, claims, cookies = []) {
  const email = claims.email.toLowerCase();
  if (!isAdmin(email) && !(await isEditor(email))) {
    return redirect(req, `/admin/?error=not_editor&email=${encodeURIComponent(email)}`, cookies);
  }
  if (!(await getUser(email))) await setJSON(userKey(email), { email, name: claims.name || prettyName(email), kind: 'editor', createdAt: now() });
  const session = await sign({ email, exp: Date.now() + 30 * DAY });
  return redirect(req, '/admin/', [...cookies, cookie(req, SESSION, session, 30 * 86_400)]);
}

async function finishAdmin(req, claims, tokens, cookies = [], consentAlreadyForced = false, wantedEmail = false) {
  const email = claims.email.toLowerCase();
  if (!isAdmin(email)) {
    // An editor who used the main sign-in button: let them in as an editor, without keeping calendar access.
    if (await isEditor(email)) return finishEditor(req, claims, cookies);
    return redirect(req, `/admin/?error=not_allowed&email=${encodeURIComponent(email)}`, cookies);
  }
  if (!cfg().fake && !(granted(tokens).includes(google.SCOPE_EVENTS) && granted(tokens).includes(google.SCOPE_FREEBUSY))) {
    return redirect(req, '/admin/?error=scopes', cookies);
  }
  const user = (await getUser(email)) || { email, createdAt: now() };
  user.name = claims.name || user.name || prettyName(email);
  if (tokens.refresh_token) {
    user.refresh = await encrypt(tokens.refresh_token);
    user.access = 'admin';
    user.revoked = false;
  }
  if (!user.refresh || user.revoked || user.access !== 'admin') {
    // Google only hands out a lasting token on the consent screen; ask once more.
    if (consentAlreadyForced) return redirect(req, '/admin/?error=no_refresh', cookies);
    return redirect(req, `/auth/login?consent=1&hint=${encodeURIComponent(email)}`, cookies);
  }
  user.kind = 'admin';
  user.canEmail = cfg().fake ? Boolean(wantedEmail || user.canEmail) : granted(tokens).includes(google.SCOPE_GMAIL_SEND);
  if (wantedEmail && user.canEmail) user.notify = true;
  user.updatedAt = now();
  await setJSON(userKey(email), user);
  forgetToken(email);
  const session = await sign({ email, exp: Date.now() + 30 * DAY });
  const next = wantedEmail ? (user.canEmail ? '/admin/?emails=on' : '/admin/?error=gmail_scope') : '/admin/';
  return redirect(req, next, [...cookies, cookie(req, SESSION, session, 30 * 86_400)]);
}

async function finishHost(req, claims, tokens, slug, cookies = []) {
  const email = claims.email.toLowerCase();
  const back = `/connect/?p=${slug || ''}`;
  if (!cfg().fake && !granted(tokens).includes(google.SCOPE_FREEBUSY)) return redirect(req, `${back}&error=scopes`, cookies);
  const user = (await getUser(email)) || { email, kind: 'host', createdAt: now() };
  user.name = claims.name || user.name || prettyName(email);
  // An admin's own connection already covers free/busy; don't swap it for a narrower one.
  const keepAdminAccess = user.access === 'admin' && user.refresh && !user.revoked;
  if (!keepAdminAccess) {
    if (!tokens.refresh_token) return redirect(req, `${back}&error=no_refresh`, cookies);
    user.refresh = await encrypt(tokens.refresh_token);
    user.access = 'freebusy';
    user.revoked = false;
  }
  user.connectedAt = now();
  await setJSON(userKey(email), user);
  forgetToken(email);
  const hostTicket = await sign({ email, exp: Date.now() + 2 * 3_600_000 });
  return redirect(req, `${back}&done=1&name=${encodeURIComponent(firstName(user.name))}`, [...cookies, cookie(req, HOST, hostTicket, 7200)]);
}

// ---------- Public routes ----------

async function loadPage(slug) {
  let s = String(slug || '').toLowerCase();
  if (s === 'demo') return demoPage();
  if (!s && cfg().sharedSite) return null; // a team copy's front page is a landing page, not someone's page
  if (!s) s = (await settings()).homeSlug;
  if (!s || !/^[a-z0-9][a-z0-9-]{0,48}$/.test(s)) return null;
  return getJSON(pageKey(s));
}

async function publicPageRoute(url) {
  const slug = url.searchParams.get('slug') || '';
  const page = await loadPage(slug);
  if (!page) return json({ error: 'not_found', home: !slug, shared: cfg().sharedSite, siteName: cfg().siteName });
  return json(publicPage(page, await hostNames(page)));
}

async function slotsRoute(url) {
  const page = await loadPage(url.searchParams.get('slug'));
  if (!page) return json({ error: 'not_found' });
  const duration = clampDuration(page, url.searchParams.get('duration'));
  const { slots, problems, page: applied } = await availability(page, duration);
  if (problems.length) {
    console.warn(`Page ${page.slug}: can't read calendars for ${problems.join(', ')}`);
    return json({ error: 'not_ready', duration, slots: [] });
  }
  return json({ duration, slots, preferred: preferredSlots(applied, slots, duration) });
}

async function bookRoute(req) {
  const b = await readBody(req);
  const page = await loadPage(b.slug);
  if (!page) return json({ error: 'not_found', message: 'That booking page no longer exists.' }, 400);
  const fail = (message, status = 400) => json({ error: 'invalid', message }, status);

  const name = String(b.name || '').trim().slice(0, 100);
  const email = String(b.email || '').trim().toLowerCase();
  const purpose = String(b.purpose || '').trim().slice(0, 2000);
  if (!name) return fail('Please add your name.');
  if (!isEmail(email)) return fail('Please check your email address.');
  if (!purpose) return fail('Please say what the meeting is for.');
  let guests = [];
  if (page.allowGuests && b.guests) {
    const parsed = parsePeople(b.guests);
    if (parsed.bad.length) return fail(`These don't look like email addresses: ${parsed.bad.join(', ')}`);
    guests = parsed.people.slice(0, 10);
  }
  const duration = clampDuration(page, b.duration);
  const start = Number(b.start);
  if (!Number.isFinite(start)) return fail('Please pick a time.');
  const end = start + duration * 60_000;

  if (b.website) return json({ ok: true, start, end }); // honeypot field: only bots fill it in

  const { slots, problems, freeHosts, booked, page: applied } = await availability(page, duration, { from: start - 60_000, to: start + 60_000 });
  if (problems.length) return json({ error: 'not_ready', message: "This page can't take bookings right now." }, 409);
  if (!slots.includes(start)) return json({ error: 'taken', message: 'Sorry, that time has just been taken. Please pick another.' }, 409);

  // Who's at the meeting: everyone, or for round robin the free person with the fewest bookings from this page.
  let attending = page.hosts;
  let assigned = '';
  if (page.mode === 'any') {
    const pool = freeHosts.get(start) || [];
    const count = (e) => booked.filter((x) => x.host === e).length;
    const fewest = Math.min(...pool.map(count));
    const choices = pool.filter((e) => count(e) === fewest);
    assigned = choices[Math.floor(Math.random() * choices.length)];
    attending = page.hosts.filter((h) => h.email === assigned);
  }
  const allNames = await hostNames(page);
  const names = attending.map((h) => allNames[page.hosts.indexOf(h)]);
  const owner = page.demo ? { name: 'Ada' } : await getUser(page.owner);
  const title = page.eventTitle
    .replaceAll('{name}', name)
    .replaceAll('{hosts}', joinNames(names.map(firstName)))
    .replaceAll('{title}', page.title)
    .replaceAll('{purpose}', purpose.split('\n')[0].slice(0, 80))
    .replaceAll('{owner}', firstName(owner?.name || prettyName(page.owner)));

  if (page.demo) {
    return json({ ok: true, demo: true, start, end, title, location: locationLabel(page), with: names.map(firstName) });
  }

  const ownerToken = await accessTokenFor(page.owner);
  if (!ownerToken) return json({ error: 'not_ready', message: "This page can't take bookings right now." }, 409);

  const token = randomId(18);
  const manageUrl = `${origin(req)}/cancel/?t=${token}`;
  const description = `Purpose of the meeting:\n${purpose}\n\nBooked by ${name} (${email}). Need to cancel or move this? ${manageUrl}`;

  const attendees = [];
  const seen = new Set([page.owner]); // the owner is the organiser
  const add = (person, extra = {}) => {
    if (seen.has(person.email)) return;
    seen.add(person.email);
    attendees.push({ email: person.email, ...(person.name ? { displayName: person.name } : {}), ...extra });
  };
  add({ email, name });
  attending.forEach((h, i) => add({ email: h.email, name: names[i] }));
  page.cc.forEach((p) => add(p, { optional: true })); // CC'd: invited whatever their availability
  guests.forEach((g) => add(g));

  const zone = applied.timezone;
  const meet = page.location === 'meet';
  const event = await google.insertEvent(ownerToken, {
    summary: title,
    description,
    start: { dateTime: DateTime.fromMillis(start, { zone }).toISO(), timeZone: zone },
    end: { dateTime: DateTime.fromMillis(end, { zone }).toISO(), timeZone: zone },
    attendees,
    ...(page.location === 'custom' ? { location: page.locationText } : {}),
    ...(meet ? { conferenceData: { createRequest: { requestId: randomId(12), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
    guestsCanSeeOtherGuests: true,
    reminders: { useDefault: true },
    // If the owner isn't at this meeting (round robin, or not one of the people), it shouldn't block their time.
    ...(attending.some((h) => h.email === page.owner) ? {} : { transparency: 'transparent' }),
    extendedProperties: { private: { overlapBooking: token, overlapPage: page.slug, overlapHost: assigned } },
  }, { meet });

  await setJSON(bookingKey(token), {
    token, slug: page.slug, owner: page.owner, eventId: event.id, start, end, duration, title,
    name, email, purpose, guests: guests.map((g) => g.email), with: names, createdAt: now(),
  });
  await notifyOwner(owner, ownerToken, page, bookingEmail({
    page, name, email, start, end, zone, names, guests: guests.map((g) => g.email), purpose, link: event.htmlLink,
  }));

  return json({
    ok: true, start, end, title, manageUrl,
    location: event.hangoutLink || locationLabel(page),
    with: names.map(firstName),
  });
}

// "Thu 5 Nov, 14:00" (short) or "Thursday 5 November, 14:00–14:25" (long), in the page's time zone.
function when(start, end, zone, long = false) {
  const s = DateTime.fromMillis(start, { zone });
  if (!long) return s.toFormat('ccc d LLL, HH:mm');
  return `${s.toFormat('cccc d LLLL, HH:mm')}–${DateTime.fromMillis(end, { zone }).toFormat('HH:mm')}`;
}

// The emails the page owner gets. The test email uses these too, so it looks exactly like the real thing.
function bookingEmail({ page, name, email, start, end, zone, names, guests = [], purpose, link }) {
  return {
    subject: `New booking: ${name}, ${when(start, end, zone)}`,
    lines: [
      `${name} (${email}) booked "${page.title}".`,
      `When: ${when(start, end, zone, true)} (${zone})`,
      `With: ${joinNames(names)}`,
      guests.length ? `Guests: ${guests.join(', ')}` : '',
      '',
      `Purpose of the meeting:\n${purpose}`,
      '',
      link ? `In your calendar: ${link}` : '',
    ],
  };
}
function cancelEmail({ name, email, title, start, end, zone }) {
  return {
    subject: `Cancelled: ${name}, ${when(start, end, zone)}`,
    lines: [`${name} (${email}) cancelled "${title}", ${when(start, end, zone, true)}.`],
  };
}
// Drops trailing and doubled blank lines, and signs off.
const emailText = (lines) => `${lines.filter((l, i, a) => l || a[i - 1]).join('\n').trim()}\n\n– Calendfree`;

// Emails the page owner about a booking or cancellation, if they've switched that on. Never blocks the booking.
async function notifyOwner(owner, token, page, { subject, lines }) {
  if (page.demo || !owner?.notify || !owner?.canEmail || !token) return;
  try {
    await google.sendEmail(token, { to: owner.email, subject, text: emailText(lines) });
    if (owner.emailError) {
      delete owner.emailError;
      await setJSON(userKey(owner.email), owner);
    }
  } catch (e) {
    console.error(`Booking email to ${owner.email} failed: ${e.message}`);
    owner.emailError = e.message;
    await setJSON(userKey(owner.email), owner);
  }
}

async function bookingRoute(url) {
  const t = String(url.searchParams.get('t') || '');
  const booking = /^[A-Za-z0-9_-]{10,40}$/.test(t) ? await getJSON(bookingKey(t)) : null;
  if (!booking) return json({ error: 'not_found' });
  const { title, start, end, duration, slug, cancelled, name } = booking;
  return json({ title, start, end, duration, slug, cancelled: Boolean(cancelled), past: end < Date.now(), name });
}

async function cancelRoute(req) {
  const { t } = await readBody(req);
  const booking = /^[A-Za-z0-9_-]{10,40}$/.test(String(t || '')) ? await getJSON(bookingKey(t)) : null;
  if (!booking) return json({ error: 'not_found', message: 'Booking not found.' }, 400);
  if (booking.cancelled) return json({ ok: true, slug: booking.slug, duration: booking.duration });
  if (booking.end < Date.now()) return json({ error: 'past', message: 'This meeting has already happened.' }, 409);
  const token = await accessTokenFor(booking.owner);
  if (!token) return json({ error: 'not_ready', message: "Couldn't reach the calendar. Please reply to the invite instead." }, 409);
  await google.deleteEvent(token, booking.eventId); // Google emails everyone the cancellation
  booking.cancelled = true;
  booking.cancelledAt = now();
  await setJSON(bookingKey(t), booking);
  const page = await getJSON(pageKey(booking.slug));
  if (page) {
    const owner = await getUser(booking.owner);
    const zone = owner?.timezone || page.timezone;
    await notifyOwner(owner, token, page, cancelEmail({ ...booking, zone }));
  }
  return json({ ok: true, slug: booking.slug, duration: booking.duration });
}

async function connectInfoRoute(url) {
  const page = await loadPage(url.searchParams.get('p'));
  if (!page || page.demo) return json({ title: null, ownerName: null, ownerEmail: null });
  const owner = await getUser(page.owner);
  return json({ title: page.title, ownerName: owner?.name || prettyName(page.owner), ownerEmail: page.owner });
}

// ---------- Admin routes ----------

async function me(email) {
  const user = await getUser(email);
  return json({
    email,
    name: user?.name || prettyName(email),
    connected: Boolean(user?.refresh && !user.revoked),
    everConnected: Boolean(user?.refresh),
    canCreate: isAdmin(email), // editors who aren't admins only change pages shared with them
    extraCalendars: user?.extraCalendars || [],
    homeSlug: (await settings()).homeSlug || '',
    defaultDuration: cfg().defaultDuration,
    hours: user?.hours || null,
    timezone: user?.timezone || '',
    travel: user?.travel || [],
    rules: { ...DEFAULT_RULES, ...(user?.rules || {}) },
    shared: cfg().sharedSite,
    notify: Boolean(user?.notify && user?.canEmail),
    canEmail: Boolean(user?.canEmail),
    emailError: user?.emailError || '',
  });
}

async function allPages() {
  const keys = await listKeys('pages/');
  const pages = (await Promise.all(keys.map((k) => getJSON(k)))).filter(Boolean);
  return pages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

async function freeSlug(base) {
  const clean = base.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'meet';
  for (let i = 0; i < 50; i++) {
    const s = i ? `${clean}-${i + 1}` : clean;
    if (!RESERVED.has(s) && !(await getJSON(pageKey(s)))) return s;
  }
  return `${clean}-${randomId(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

async function listPages(email, url) {
  const all = await allPages();
  let pages = all.filter((p) => p.owner === email);
  const site = await settings();
  const user = await getUser(email);
  // Pages other people have made you an editor of, with what the editor needs to know about their owner.
  const editable = await Promise.all(all.filter((p) => p.owner !== email && (p.editors || []).includes(email)).map(async (p) => {
    const owner = await getUser(p.owner);
    return { ...p, ownerName: owner?.name || prettyName(p.owner), ownerRules: { ...DEFAULT_RULES, ...(owner?.rules || {}) } };
  }));
  if (!pages.length && user && !user.onboarded && isAdmin(email) && user.refresh) {
    // First visit: make a starter page so there's a link to share straight away.
    const tz = url.searchParams.get('tz');
    const slug = await freeSlug(firstName(user.name) || email.split('@')[0]);
    const page = {
      ...defaultPage({ owner: email, ownerName: user.name, timezone: validTimezone(tz) ? tz : 'Europe/London', slug }),
      defaultDuration: cfg().defaultDuration,
      createdAt: now(),
      updatedAt: now(),
    };
    await setJSON(pageKey(slug), page);
    if (!site.homeSlug && !cfg().sharedSite) {
      site.homeSlug = slug;
      await setJSON('settings/site', site);
    }
    pages = [page];
  }
  if (user && !user.onboarded && isAdmin(email) && user.refresh) {
    user.onboarded = true;
    await setJSON(userKey(email), user);
  }
  return json({ pages, editable, homeSlug: site.homeSlug || '' });
}

async function savePage(email, req) {
  const body = await readBody(req);
  const original = body.originalSlug ? await getJSON(pageKey(body.originalSlug)) : null;
  if (body.originalSlug && !canEdit(original, email)) return json({ errors: ["You can't change that page."] }, 400);
  if (!original && !isAdmin(email)) return json({ errors: ['Only people who can make booking pages can add new ones.'] }, 400);
  const owner = original?.owner || email;
  const { page, errors } = normalisePage(body.page || {}, owner);
  if (errors.length) return json({ errors }, 400);
  if (original && owner !== email) {
    // Editors change the page itself, not whose calendar it books into, who else can edit it, or its time zone.
    page.editors = original.editors || [];
    page.timezone = original.timezone;
    body.home = undefined;
  }
  const existing = await getJSON(pageKey(page.slug));
  if (existing && body.originalSlug !== page.slug) {
    return json({ errors: [`The link name "${page.slug}" is already used. Pick another.`] }, 409);
  }
  page.createdAt = original?.createdAt || now();
  page.updatedAt = now();
  await setJSON(pageKey(page.slug), page);

  const site = await settings();
  let changed = false;
  if (original && body.originalSlug !== page.slug) {
    await remove(pageKey(body.originalSlug));
    if (site.homeSlug === body.originalSlug) {
      site.homeSlug = page.slug;
      changed = true;
    }
  }
  if (cfg().sharedSite) body.home = undefined; // no main link on a team copy
  if (body.home === true && site.homeSlug !== page.slug) {
    site.homeSlug = page.slug;
    changed = true;
  } else if (body.home === false && site.homeSlug === page.slug) {
    site.homeSlug = '';
    changed = true;
  }
  if (changed) await setJSON('settings/site', site);
  await rebuildEditorIndex();
  return json({ page, homeSlug: site.homeSlug || '' });
}

async function deletePage(email, url) {
  const slug = String(url.searchParams.get('slug') || '');
  const page = await getJSON(pageKey(slug));
  if (!page || page.owner !== email) return json({ error: 'not_found' }, 404);
  await remove(pageKey(slug));
  const site = await settings();
  if (site.homeSlug === slug) {
    site.homeSlug = '';
    await setJSON('settings/site', site);
  }
  await rebuildEditorIndex();
  return json({ ok: true });
}

async function hostsRoute(email, url) {
  const page = await getJSON(pageKey(String(url.searchParams.get('slug') || '')));
  if (!canEdit(page, email)) return json({ error: 'not_found' }, 404);
  return json({ hosts: await hostStatuses(page) });
}

// Saves whichever of these the admin page sends: extraCalendars, hours + timezone, notify.
async function saveSettings(email, req) {
  const body = await readBody(req);
  const user = await getUser(email);
  if (!user || !isAdmin(email)) return json({ errors: ['Sign in to make booking pages first.'] }, 400);
  if ('extraCalendars' in body) {
    const { people, bad } = parsePeople(body.extraCalendars || '');
    if (bad.length) return json({ errors: [`These don't look like calendar addresses: ${bad.join(', ')}`] }, 400);
    user.extraCalendars = people.map((p) => p.email).filter((e) => e !== email).slice(0, 20);
  }
  if ('hours' in body) {
    const error = applyHours(user, body);
    if (error) return json({ errors: [error] }, 400);
  }
  if ('notify' in body) user.notify = Boolean(body.notify) && Boolean(user.canEmail);
  if ('rules' in body) user.rules = normaliseRules(body.rules);
  await setJSON(userKey(email), user);
  return json({ extraCalendars: user.extraCalendars || [], ...hoursReply(user), notify: Boolean(user.notify), rules: { ...DEFAULT_RULES, ...(user.rules || {}) } });
}

async function testEmail(email) {
  const user = await getUser(email);
  if (!user?.canEmail) return json({ errors: ['Calendfree needs permission to send emails first.'] }, 400);
  const token = await accessTokenFor(email);
  // A made-up booking on your main page (or first page), tomorrow or the next weekday at 10:00, in your time zone.
  const mine = (await allPages()).filter((p) => p.owner === email);
  const { homeSlug } = await settings();
  const page = mine.find((p) => p.slug === homeSlug) || mine[0]
    || { title: `Meet ${firstName(user.name) || 'me'}`, defaultDuration: cfg().defaultDuration, hosts: [{ email, name: user.name }] };
  const zone = user.timezone || page.timezone || 'Europe/London';
  let day = DateTime.now().setZone(zone).plus({ days: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  while (day.weekday > 5) day = day.plus({ days: 1 });
  const sample = {
    page, zone, name: 'Sam Example', email: 'sam@example.org', title: page.title,
    start: day.toMillis(), end: day.toMillis() + page.defaultDuration * 60_000,
    names: page.slug ? await hostNames(page) : [user.name || email],
    purpose: 'A made-up booking, to show you what these emails look like.',
    link: '(a link to the event in your Google Calendar)',
  };
  const booked = bookingEmail(sample);
  const cancelled = cancelEmail(sample);
  const text = emailText([
    "This is a test: nobody has booked anything. When someone books one of your pages, you'll get an email like this:",
    '',
    '----------',
    '',
    ...booked.lines,
    '',
    '----------',
    '',
    "And if they cancel, you'll get one like this:",
    '',
    `Subject: ${cancelled.subject}`,
    ...cancelled.lines,
  ]);
  try {
    await google.sendEmail(token, { to: email, subject: `[Test] ${booked.subject}`, text });
    delete user.emailError;
    await setJSON(userKey(email), user);
    return json({ ok: true });
  } catch (e) {
    user.emailError = e.message;
    await setJSON(userKey(email), user);
    return json({ errors: [e.message] }, 400);
  }
}

// Applies { hours, timezone, travel } from a request to a user record. Returns an error message or ''.
function applyHours(user, body) {
  const { hours, error } = normaliseHours(body.hours);
  if (error) return error;
  const trips = normaliseTravel(body.travel);
  if (trips.error) return trips.error;
  user.hours = hours;
  user.timezone = validTimezone(body.timezone) ? body.timezone : '';
  user.travel = hours ? trips.travel : [];
  return '';
}
const hoursReply = (user) => ({ hours: user.hours || null, timezone: user.timezone || '', travel: user.travel || [] });

// Sets someone's working hours, for a person on one of the pages you own or edit.
async function saveHostHours(email, req) {
  const body = await readBody(req);
  const target = String(body.email || '').toLowerCase();
  const pages = (await allPages()).filter((p) => canEdit(p, email));
  if (target !== email && !pages.some((p) => p.hosts.some((h) => h.email === target))) {
    return json({ errors: ["You can only set hours for people on pages you own or edit."] }, 400);
  }
  const user = (await getUser(target)) || { email: target, kind: 'host', createdAt: now() };
  const error = applyHours(user, body);
  if (error) return json({ errors: [error] }, 400);
  await setJSON(userKey(target), user);
  return json(hoursReply(user));
}


// A colleague who has just opted in can see and set their own working hours (cookie lasts two hours).
async function hostSelfRoute(req, path) {
  const ticket = await verify(getCookie(req, HOST)).catch(() => null);
  if (!ticket?.email) return json({ error: 'signed_out' }, 401);
  const user = await getUser(ticket.email);
  if (path === '/api/host/me') {
    return json({ email: ticket.email, name: user?.name || '', ...hoursReply(user || {}) });
  }
  if (req.method !== 'PUT' || req.headers.get('x-overlap') !== '1') return json({ error: 'bad_request' }, 400);
  const body = await readBody(req);
  const error = applyHours(user, body);
  if (error) return json({ errors: [error] }, 400);
  await setJSON(userKey(ticket.email), user);
  return json(hoursReply(user));
}
