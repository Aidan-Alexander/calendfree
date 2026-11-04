// Every /api/* and /auth/* request comes through here.
import { DateTime } from 'luxon';
import { cfg, isAdmin, missingConfig } from './config.mjs';
import { sign, verify, encrypt, randomId } from './crypto.mjs';
import * as google from './google.mjs';
import { getJSON, setJSON, remove, listKeys, userKey, pageKey, bookingKey } from './store.mjs';
import { accessTokenFor, availability, forgetToken, getUser, hostNames, hostStatuses } from './calendar.mjs';
import {
  RESERVED, clampDuration, defaultPage, demoPage, firstName, isEmail, joinNames, locationLabel, normalisePage,
  parsePeople, prettyName, publicPage, validTimezone,
} from './pages.mjs';
import { json, redirect as rawRedirect, getCookie, cookie, origin, readBody } from './http.mjs';

// Paths like "/admin/" are inside the app; they get the app's public address (and base path) in front.
const redirect = (req, location, cookies = []) => rawRedirect(location, cookies, req);

const SESSION = 'ov_session';
const OAUTH = 'ov_oauth';
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

    // Admin
    const session = await verify(getCookie(req, SESSION)).catch(() => null);
    const email = session?.email && isAdmin(session.email) ? session.email : null;
    if (path === '/api/me' && get) return email ? await me(email) : json({ error: 'signed_out' }, 401);
    if (!path.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    if (!email) return json({ error: 'signed_out' }, 401);
    // Admin changes must come from our own pages (a custom header can't be sent cross-site without permission).
    if (!get && req.headers.get('x-overlap') !== '1') return json({ error: 'bad_request' }, 400);
    if (path === '/api/pages' && get) return await listPages(email, url);
    if (path === '/api/pages' && req.method === 'PUT') return await savePage(email, req);
    if (path === '/api/pages' && req.method === 'DELETE') return await deletePage(email, url);
    if (path === '/api/hosts' && get) return await hostsRoute(email, url);
    if (path === '/api/settings' && req.method === 'PUT') return await saveSettings(email, req);
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
  if (cfg().fake) {
    // Local testing only: pretend Google said yes.
    const email = cfg().admins[0] || 'you@example.org';
    return finishAdmin(req, { email, name: prettyName(email) }, { refresh_token: `fake-refresh:${email}` });
  }
  const consent = url.searchParams.get('consent') === '1';
  return startOAuth(req, 'admin', { consent }, {
    scopes: google.ADMIN_SCOPES,
    prompt: consent ? 'consent' : 'select_account',
    loginHint: url.searchParams.get('hint') || undefined,
  });
}

async function connect(req, url) {
  const slug = String(url.searchParams.get('p') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 49);
  if (missingConfig().length) return redirect(req, `/connect/?p=${slug}&error=setup`);
  if (cfg().fake) {
    const as = String(url.searchParams.get('as') || '').toLowerCase();
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
  return finishAdmin(req, claims, tokens, clear, ticket.consent);
}

const granted = (tokens) => String(tokens.scope || '').split(' ');

async function finishAdmin(req, claims, tokens, cookies = [], consentAlreadyForced = false) {
  const email = claims.email.toLowerCase();
  if (!isAdmin(email)) return redirect(req, `/admin/?error=not_allowed&email=${encodeURIComponent(email)}`, cookies);
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
  user.updatedAt = now();
  await setJSON(userKey(email), user);
  forgetToken(email);
  const session = await sign({ email, exp: Date.now() + 30 * DAY });
  return redirect(req, '/admin/', [...cookies, cookie(req, SESSION, session, 30 * 86_400)]);
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
  return redirect(req, `${back}&done=1&name=${encodeURIComponent(firstName(user.name))}`, cookies);
}

// ---------- Public routes ----------

async function loadPage(slug) {
  let s = String(slug || '').toLowerCase();
  if (s === 'demo') return demoPage();
  if (!s) s = (await settings()).homeSlug;
  if (!s || !/^[a-z0-9][a-z0-9-]{0,48}$/.test(s)) return null;
  return getJSON(pageKey(s));
}

async function publicPageRoute(url) {
  const slug = url.searchParams.get('slug') || '';
  const page = await loadPage(slug);
  if (!page) return json({ error: 'not_found', home: !slug });
  return json(publicPage(page, await hostNames(page)));
}

async function slotsRoute(url) {
  const page = await loadPage(url.searchParams.get('slug'));
  if (!page) return json({ error: 'not_found' });
  const duration = clampDuration(page, url.searchParams.get('duration'));
  const { slots, problems } = await availability(page, duration);
  if (problems.length) {
    console.warn(`Page ${page.slug}: can't read calendars for ${problems.join(', ')}`);
    return json({ error: 'not_ready', duration, slots: [] });
  }
  return json({ duration, slots });
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

  const { slots, problems } = await availability(page, duration, { from: start - 60_000, to: start + 60_000 });
  if (problems.length) return json({ error: 'not_ready', message: "This page can't take bookings right now." }, 409);
  if (!slots.includes(start)) return json({ error: 'taken', message: 'Sorry, that time has just been taken. Please pick another.' }, 409);

  const names = await hostNames(page);
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
  page.hosts.forEach((h, i) => add({ email: h.email, name: names[i] }));
  page.cc.forEach((p) => add(p, { optional: true })); // CC'd: invited whatever their availability
  guests.forEach((g) => add(g));

  const zone = page.timezone;
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
    extendedProperties: { private: { overlapBooking: token, overlapPage: page.slug } },
  }, { meet });

  await setJSON(bookingKey(token), {
    token, slug: page.slug, owner: page.owner, eventId: event.id, start, end, duration, title,
    name, email, purpose, guests: guests.map((g) => g.email), createdAt: now(),
  });

  return json({
    ok: true, start, end, title, manageUrl,
    location: event.hangoutLink || locationLabel(page),
    with: names.map(firstName),
  });
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
    extraCalendars: user?.extraCalendars || [],
    homeSlug: (await settings()).homeSlug || '',
  });
}

async function myPages(email) {
  const keys = await listKeys('pages/');
  const pages = (await Promise.all(keys.map((k) => getJSON(k)))).filter((p) => p && p.owner === email);
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
  let pages = await myPages(email);
  const site = await settings();
  const user = await getUser(email);
  if (!pages.length && user && !user.onboarded) {
    // First visit: make a starter page so there's a link to share straight away.
    const tz = url.searchParams.get('tz');
    const slug = await freeSlug(firstName(user.name) || email.split('@')[0]);
    const page = { ...defaultPage({ owner: email, ownerName: user.name, timezone: validTimezone(tz) ? tz : 'Europe/London', slug }), createdAt: now(), updatedAt: now() };
    await setJSON(pageKey(slug), page);
    if (!site.homeSlug) {
      site.homeSlug = slug;
      await setJSON('settings/site', site);
    }
    pages = [page];
  }
  if (user && !user.onboarded) {
    user.onboarded = true;
    await setJSON(userKey(email), user);
  }
  return json({ pages, homeSlug: site.homeSlug || '' });
}

async function savePage(email, req) {
  const body = await readBody(req);
  const { page, errors } = normalisePage(body.page || {}, email);
  if (errors.length) return json({ errors }, 400);
  const original = body.originalSlug ? await getJSON(pageKey(body.originalSlug)) : null;
  if (original && original.owner !== email) return json({ errors: ["That page isn't yours."] }, 403);
  const existing = await getJSON(pageKey(page.slug));
  if (existing && (existing.owner !== email || body.originalSlug !== page.slug)) {
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
  if (body.home === true && site.homeSlug !== page.slug) {
    site.homeSlug = page.slug;
    changed = true;
  } else if (body.home === false && site.homeSlug === page.slug) {
    site.homeSlug = '';
    changed = true;
  }
  if (changed) await setJSON('settings/site', site);
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
  return json({ ok: true });
}

async function hostsRoute(email, url) {
  const page = await getJSON(pageKey(String(url.searchParams.get('slug') || '')));
  if (!page || page.owner !== email) return json({ error: 'not_found' }, 404);
  return json({ hosts: await hostStatuses(page) });
}

async function saveSettings(email, req) {
  const body = await readBody(req);
  const { people, bad } = parsePeople(body.extraCalendars || '');
  if (bad.length) return json({ errors: [`These don't look like calendar addresses: ${bad.join(', ')}`] }, 400);
  const user = await getUser(email);
  user.extraCalendars = people.map((p) => p.email).filter((e) => e !== email).slice(0, 20);
  await setJSON(userKey(email), user);
  return json({ extraCalendars: user.extraCalendars });
}
