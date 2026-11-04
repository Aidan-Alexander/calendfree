// Reading everyone's busy times and turning them into bookable slots.
import { getJSON, setJSON, userKey } from './store.mjs';
import { decrypt } from './crypto.mjs';
import * as google from './google.mjs';
import { fakeBusy } from './fake.mjs';
import { bookingWindow, computeSlots, mergeBusy } from './slots.mjs';
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
    if (e.code === 'invalid_grant') {
      user.revoked = true; // they removed access in their Google account
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
      }),
    );
  }
  await Promise.all(tasks);
  return results;
}

// Bookable start times (ms) for a page and meeting length. `problems` lists anyone whose calendar couldn't be read:
// if there are any, no times are offered, because they might not be free.
export async function availability(page, duration, { from, to, now = Date.now() } = {}) {
  const win = bookingWindow(page, now);
  const start = Math.max(win.from, from ?? -Infinity);
  const end = Math.min(win.to, to ?? Infinity);
  if (!(end > start)) return { slots: [], problems: [] };
  const pad = (page.bufferMinutes + 1) * 60_000;
  const timeMin = new Date(start - pad).toISOString();
  const timeMax = new Date(end + duration * 60_000 + pad).toISOString();
  const results = await readHosts(page, timeMin, timeMax);
  const problems = page.hosts.filter((h) => !results[h.email]?.ok).map((h) => h.email);
  if (problems.length) return { slots: [], problems };
  const busy = mergeBusy(page.hosts.map((h) => results[h.email].busy));
  return { slots: computeSlots({ page, duration, busy, now, from, to }), problems };
}

// For the admin page: can we see each person's calendar, and how?
export async function hostStatuses(page) {
  const now = Date.now();
  const results = await readHosts(page, new Date(now).toISOString(), new Date(now + 2 * 86_400_000).toISOString());
  const names = await hostNames(page);
  return page.hosts.map((h, i) => {
    const r = results[h.email] || { ok: false, reason: 'unknown' };
    return { email: h.email, name: names[i], ok: r.ok, via: r.via, reason: r.reason, warnings: r.warnings || [] };
  });
}
