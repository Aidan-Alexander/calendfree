// Reading everyone's busy times and turning them into bookable slots.
import { DateTime } from 'luxon';
import { getJSON, setJSON, userKey } from './store.mjs';
import { decrypt } from './crypto.mjs';
import * as google from './google.mjs';
import { fakeBusy } from './fake.mjs';
import { applyDailyCap, bookingWindow, computeSlots, mergeBusy, outsideHours } from './slots.mjs';
import { DEFAULT_HOURS, DEFAULT_RULES } from './pages.mjs';
import { prettyName } from './pages.mjs';

const tokenCache = new Map(); // email → { token, exp }

export const getUser = (email) => (email ? getJSON(userKey(email)) : null);
export const forgetToken = (email) => tokenCache.delete(String(email).toLowerCase());

export async function accessTokenFor(email) {
  const key = String(email).toLowerCase();
  const hit = tokenCache.get(key);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const user = await getUser(key);
  if (!user?.refresh || user.revoked) return null;
  try {
    const t = await google.refreshAccessToken(await decrypt(user.refresh));
    tokenCache.set(key, { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
    return t.access_token;
  } catch (e) {
    console.error(`Could not refresh Google access for ${key}: ${e.message}`);
    // invalid_grant: they removed access in their Google account. OperationError: the token can't be unlocked,
    // because APP_SECRET changed. Either way they need to connect again, so ask rather than fail quietly.
    if (e.code === 'invalid_grant' || e.name === 'OperationError') {
      user.revoked = true;
      await setJSON(userKey(key), user);
    }
    return null;
  }
}

export async function hostNames(page) {
  return Promise.all(
    page.hosts.map(async (h) => {
      if (h.name) return h.name;
      if (page.demo) return prettyName(h.email);
      const u = await getUser(h.email);
      return u?.name || prettyName(h.email);
    }),
  );
}

const pick = (cals, id) => cals[id] ?? Object.entries(cals).find(([k]) => k.toLowerCase() === id.toLowerCase())?.[1];

// Reads the busy times of everyone who needs to be free. Each person is read either:
//  - "owner":     the page owner's own calendar (and any extra calendars they've listed),
//  - "connected": through the person's own Google connection, if they clicked the opt-in link, or
//  - "shared":    through the owner's Google account, which works when the person's calendar shares free/busy
//                 with the owner (Google Workspace does this by default inside an organisation).
// Returns { [email]: { ok, via, busy, reason, warnings } }
export async function readHosts(page, timeMin, timeMax) {
  const results = {};
  if (page.demo) {
    for (const h of page.hosts) results[h.email] = { ok: true, via: 'shared', busy: fakeBusy(h.email, timeMin, timeMax) };
    return results;
  }

  const owner = await getUser(page.owner);
  const ownerToken = await accessTokenFor(page.owner);
  const viaOwner = []; // [email, via]
  const connected = []; // [email, token]
  await Promise.all(
    page.hosts.map(async ({ email }) => {
      if (email === page.owner) return viaOwner.push([email, 'owner']);
      const u = await getUser(email);
      const token = u?.refresh && !u.revoked ? await accessTokenFor(email) : null;
      if (token) connected.push([email, token]);
      else viaOwner.push([email, 'shared']);
    }),
  );

  const tasks = [];
  if (viaOwner.length) {
    if (!ownerToken) {
      for (const [email, via] of viaOwner) results[email] = { ok: false, via, reason: 'owner_not_connected' };
    } else {
      const ownerIsHost = viaOwner.some(([, via]) => via === 'owner');
      const extras = ownerIsHost ? owner?.extraCalendars || [] : [];
      const ids = [...viaOwner.map(([email]) => email), ...extras];
      tasks.push(
        google.freeBusy(ownerToken, ids, timeMin, timeMax).then((cals) => {
          for (const [email, via] of viaOwner) {
            const cal = pick(cals, email);
            if (!cal || cal.errors?.length) results[email] = { ok: false, via, reason: cal?.errors?.[0]?.reason || 'notFound' };
            else results[email] = { ok: true, via, busy: cal.busy || [] };
          }
          const mine = results[page.owner];
          if (mine?.ok) {
            for (const id of extras) {
              const cal = pick(cals, id);
              if (!cal || cal.errors?.length) (mine.warnings ||= []).push(`Can't see ${id}`);
              else mine.busy = mine.busy.concat(cal.busy || []);
            }
          }
        }).catch((e) => {
          // e.g. the Calendar API isn't switched on in the Google Cloud project. Show Google's words on the admin page.
          console.error(`Free/busy check failed for ${page.slug}: ${e.message}`);
          for (const [email, via] of viaOwner) results[email] = { ok: false, via, reason: e.message };
        }),
      );
    }
  }
  for (const [email, token] of connected) {
    tasks.push(
      google.freeBusy(token, [email], timeMin, timeMax).then((cals) => {
        const cal = pick(cals, email) ?? Object.values(cals)[0];
        if (!cal || cal.errors?.length) results[email] = { ok: false, via: 'connected', reason: cal?.errors?.[0]?.reason || 'notFound' };
        else results[email] = { ok: true, via: 'connected', busy: cal.busy || [] };
      }).catch((e) => {
        results[email] = { ok: false, via: 'connected', reason: e.message };
      }),
    );
  }
  await Promise.all(tasks);
  return results;
}

// Bookings already made through this page (from the owner's calendar), as { start, host }.
// Used for the daily cap and to share round-robin bookings out fairly. If the calendar can't be read, none.
export async function pageBookings(page, timeMin, timeMax) {
  if (page.demo || (!page.dailyCap && page.mode !== 'any')) return [];
  const token = await accessTokenFor(page.owner);
  if (!token) return [];
  try {
    const events = await google.listPageEvents(token, page.slug, timeMin, timeMax);
    return events
      .filter((e) => e.status !== 'cancelled' && e.start?.dateTime)
      .map((e) => ({ start: Date.parse(e.start.dateTime), host: e.extendedProperties?.private?.overlapHost || '' }));
  } catch (e) {
    console.error(`Couldn't list bookings for ${page.slug}: ${e.message}`);
    return [];
  }
}

// The page as it actually applies: the owner's time zone and trips, their usual booking rules unless the page
// overrides them, and start times every 30 minutes for whole half-hour lengths (30, 60, 90), otherwise every 15.
export async function effectivePage(page, duration = page.defaultDuration) {
  const owner = page.demo ? null : await getUser(page.owner);
  // Pages saved before booking rules were global kept them on the page; anything changed from the defaults counts.
  const legacy = page.rules === undefined
    ? Object.fromEntries(Object.keys(DEFAULT_RULES).filter((k) => page[k] != null && page[k] !== DEFAULT_RULES[k]).map((k) => [k, page[k]]))
    : {};
  return {
    ...page,
    ...DEFAULT_RULES,
    ...(owner?.rules || {}),
    ...legacy,
    ...(page.rules || {}),
    timezone: owner?.timezone || page.timezone || 'Europe/London',
    travel: owner?.travel || [],
    hoursMode: page.hours ? 'replace' : 'working', // older 'narrow' pages count as 'replace'
    stepMinutes: duration % 30 === 0 ? 30 : 15,
  };
}

// Bookable start times (ms) for a page and meeting length.
// - Everyone must be free (mode 'all'): if anyone's calendar can't be read, `problems` lists them and no times are
//   offered, because they might not be free.
// - Round robin (mode 'any'): a time is offered when at least one person is free. `freeHosts` says who, per time.
// People's own working hours (if they've set them) count as busy outside those hours.
export async function availability(rawPage, duration, { from, to, now = Date.now() } = {}) {
  const page = await effectivePage(rawPage, duration);
  const win = bookingWindow(page, now);
  const start = Math.max(win.from, from ?? -Infinity);
  const end = Math.min(win.to, to ?? Infinity);
  if (!(end > start)) return { slots: [], problems: [], freeHosts: new Map(), booked: [], page };
  const pad = (page.bufferMinutes + 1) * 60_000;
  const busyFrom = start - pad;
  const busyTo = end + duration * 60_000 + pad;
  const timeMin = new Date(busyFrom).toISOString();
  const timeMax = new Date(busyTo).toISOString();
  const [results, booked, users] = await Promise.all([
    readHosts(page, timeMin, timeMax),
    // The whole of each day counts towards the daily cap, even when checking a single time.
    pageBookings(
      page,
      new Date(Math.min(start, now - 30 * 86_400_000)).toISOString(),
      new Date(Math.max(busyTo, DateTime.fromMillis(end, { zone: page.timezone }).endOf('day').toMillis())).toISOString(),
    ),
    Promise.all(page.hosts.map((h) => (page.demo ? null : getUser(h.email)))),
  ]);
  // Each person's working hours count as blocked outside them (the default hours if they haven't set their own).
  // On a page with different hours, those replace the owner's working hours; colleagues keep theirs.
  // The page's hours are in the owner's time zone and follow their trips.
  const ownHours = (i) => {
    if (page.hoursMode === 'replace' && page.hosts[i].email === page.owner) return [];
    const u = users[i];
    if (u?.hours) return outsideHours(u.hours, u.timezone || page.timezone, busyFrom, busyTo, u.travel || []);
    return outsideHours(DEFAULT_HOURS, page.timezone, busyFrom, busyTo, page.hosts[i].email === page.owner ? page.travel : []);
  };
  const pageHours = page.hoursMode !== 'working' && page.hours ? outsideHours(page.hours, page.timezone, busyFrom, busyTo, page.travel) : [];
  const window = { ...page, hours: null }; // the whole day; working hours and page hours do the limiting as busy blocks
  const bookedStarts = booked.map((b) => b.start);
  const freeHosts = new Map();

  if (page.mode === 'any') {
    page.hosts.forEach((h, i) => {
      if (!results[h.email]?.ok) return; // can't see them, so don't offer them
      const busy = mergeBusy([results[h.email].busy]);
      const blocked = mergeBusy([ownHours(i), pageHours]);
      for (const t of computeSlots({ page: window, duration, busy, blocked, now, from, to })) {
        if (!freeHosts.has(t)) freeHosts.set(t, []);
        freeHosts.get(t).push(h.email);
      }
    });
    if (!freeHosts.size && page.hosts.every((h) => !results[h.email]?.ok)) {
      return { slots: [], problems: page.hosts.map((h) => h.email), freeHosts, booked, page };
    }
    const slots = applyDailyCap(page, [...freeHosts.keys()].sort((a, b) => a - b), bookedStarts);
    return { slots, problems: [], freeHosts, booked, page };
  }

  const problems = page.hosts.filter((h) => !results[h.email]?.ok).map((h) => h.email);
  if (problems.length) return { slots: [], problems, freeHosts, booked, page };
  const busy = mergeBusy(page.hosts.map((h) => results[h.email].busy));
  const blocked = mergeBusy([...page.hosts.map((h, i) => ownHours(i)), pageHours]);
  const slots = applyDailyCap(page, computeSlots({ page: window, duration, busy, blocked, now, from, to }), bookedStarts);
  return { slots, problems, freeHosts, booked, page };
}

// For the admin page: can we see each person's calendar, and how? Also their own working hours, if set.
export async function hostStatuses(page) {
  const now = Date.now();
  const results = await readHosts(page, new Date(now).toISOString(), new Date(now + 2 * 86_400_000).toISOString());
  const names = await hostNames(page);
  const users = await Promise.all(page.hosts.map((h) => getUser(h.email)));
  return page.hosts.map((h, i) => {
    const r = results[h.email] || { ok: false, reason: 'unknown' };
    return {
      email: h.email, name: names[i], ok: r.ok, via: r.via, reason: r.reason, warnings: r.warnings || [],
      hours: users[i]?.hours || null, timezone: users[i]?.timezone || '', travel: users[i]?.travel || [],
    };
  });
}
