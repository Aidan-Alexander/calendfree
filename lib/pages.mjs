// Booking pages: defaults, checking what an admin sends, and what the public may see.
import { DateTime } from 'luxon';
import { WEEKDAYS, windowsOf } from './slots.mjs';

// Page names that would clash with the site's own paths.
export const RESERVED = new Set([
  'api', 'auth', 'admin', 'connect', 'cancel', 'demo', 'book', 'book.html', 'style.css', 'book.js', 'admin.js',
  'favicon.ico', 'robots.txt', 'assets', 'static', 'index', 'index.html', 'setup', 'login', 'logout',
]);

const EMAIL_IN_TEXT = /[^\s<>"'(),;:]+@[^\s<>"'(),;:]+\.[^\s<>"'(),;:]+/;
export const isEmail = (s) => new RegExp(`^${EMAIL_IN_TEXT.source}$`).test(String(s || '').trim());

export function prettyName(email) {
  const local = String(email || '').split('@')[0];
  return local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export function joinOr(names) {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} or ${n[n.length - 1]}`;
}

export function joinNames(names) {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
}

// "Jo Smith <jo@example.org>", "jo@example.org" or {name, email}, one per line or comma-separated.
export function parsePeople(input) {
  const items = Array.isArray(input) ? input : String(input || '').split(/[\n,;]+/);
  const people = [];
  const bad = [];
  const seen = new Set();
  for (const raw of items) {
    let name;
    let email;
    if (raw && typeof raw === 'object') {
      name = String(raw.name || '').trim();
      email = String(raw.email || '').trim();
    } else {
      const s = String(raw || '').trim();
      if (!s) continue;
      const m = s.match(EMAIL_IN_TEXT);
      if (!m) {
        bad.push(s);
        continue;
      }
      email = m[0];
      name = s.replace(m[0], '').replace(/[<>"]/g, '').trim();
    }
    email = email.toLowerCase();
    if (!isEmail(email)) {
      bad.push(email);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    people.push({ email, name: name.slice(0, 80) });
  }
  return { people, bad };
}

const clean = (s, max) => String(s ?? '').replace(/\s+$/g, '').slice(0, max);
function int(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
export const validTimezone = (tz) => Boolean(tz) && DateTime.local().setZone(tz).isValid;

export function defaultPage({ owner, ownerName, timezone, slug = '' }) {
  const first = firstName(ownerName) || prettyName(owner);
  return {
    slug,
    owner,
    title: `Meet ${first}`,
    description: '',
    eventTitle: '{name} <> {hosts}',
    hosts: [{ email: owner, name: ownerName || '' }],
    cc: [],
    defaultDuration: 30,
    maxDuration: 240,
    timezone: validTimezone(timezone) ? timezone : 'Europe/London',
    hours: null, // follow each person's working hours
    hoursMode: 'working',
    rules: null,
    location: 'meet',
    locationText: '',
    allowGuests: true,
    preferred: null, // e.g. ['12:00', '17:30']: shown first, with a button for the rest
    mode: 'all',
    durations: [],
    dailyCap: 0,
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// Booking rules everyone starts with. People can change theirs under Your settings, and pages can override them.
export const DEFAULT_RULES = { bufferMinutes: 0, minNoticeHours: 4, daysAhead: 21 };

// { bufferMinutes, minNoticeHours, daysAhead } from a form, or null for "use the usual rules".
export function normaliseRules(input) {
  if (!input) return null;
  return {
    bufferMinutes: int(input.bufferMinutes, 0, 120, DEFAULT_RULES.bufferMinutes),
    minNoticeHours: int(input.minNoticeHours, 0, 720, DEFAULT_RULES.minNoticeHours),
    daysAhead: int(input.daysAhead, 1, 90, DEFAULT_RULES.daysAhead),
  };
}

// Anyone who hasn't set their own working hours is treated as working these, in the page owner's time zone.
const WEEKDAY = ['09:00', '17:30'];
export const DEFAULT_HOURS = { mon: WEEKDAY, tue: WEEKDAY, wed: WEEKDAY, thu: WEEKDAY, fri: WEEKDAY, sat: null, sun: null };

// A person's own working (or preferred) hours, per day, each day a list of windows:
// { mon: [['09:00', '12:00'], ['13:00', '17:30']], …, sun: null }, or null. A single window, ['09:00', '17:30'], is
// fine too. Overlapping windows are merged. Returns { hours, error }.
const END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
export function normaliseHours(input) {
  if (!input) return { hours: null };
  const perDay = Array.isArray(input.days)
    ? Object.fromEntries(WEEKDAYS.map((d) => [d, input.days.includes(d) ? [input.from, input.to] : null]))
    : input;
  const hours = {};
  for (const d of WEEKDAYS) {
    const list = windowsOf(perDay[d]);
    if (!list.length) {
      hours[d] = null;
      continue;
    }
    if (list.some((w) => !TIME.test(w[0]) || !END.test(w[1]) || w[1] <= w[0])) {
      return { hours: null, error: 'Working hours: each time needs a start before its end.' };
    }
    const merged = [];
    for (const w of [...list].sort((a, b) => a[0].localeCompare(b[0]))) {
      const last = merged[merged.length - 1];
      if (last && w[0] <= last[1]) last[1] = w[1] > last[1] ? w[1] : last[1];
      else merged.push([w[0], w[1]]);
    }
    hours[d] = merged.slice(0, 12);
  }
  if (!Object.values(hours).some(Boolean)) return { hours: null, error: 'Pick at least one working day.' };
  return { hours };
}

// Trips: [{ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', timezone }]. Working hours follow the person to the trip's time zone.
// Finished trips stay listed for a week, then drop off.
const TRIP_KEEP_DAYS = 7;
const tripCutoff = () => DateTime.now().minus({ days: TRIP_KEEP_DAYS }).toISODate();
export const currentTrips = (travel) => (Array.isArray(travel) ? travel.filter((t) => (t.to || t.from) >= tripCutoff()) : []);

export function normaliseTravel(input) {
  const list = Array.isArray(input) ? input : [];
  const cutoff = tripCutoff();
  const travel = [];
  for (const t of list) {
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.from) || !/^\d{4}-\d{2}-\d{2}$/.test(t.to || t.from)) {
      return { travel: [], error: 'Each trip needs a start date and an end date.' };
    }
    const to = t.to || t.from;
    if (to < t.from) return { travel: [], error: 'Each trip needs to end on or after the day it starts.' };
    if (!validTimezone(t.timezone)) return { travel: [], error: 'Pick a time zone for each trip.' };
    if (to >= cutoff) travel.push({ from: t.from, to, timezone: t.timezone }); // trips over a week ago drop off
  }
  return { travel: travel.sort((a, b) => a.from.localeCompare(b.from)).slice(0, 30) };
}

// "25, 45, 60" or [25, 45, 60] → sorted lengths guests may pick (always including the usual one), or [].
export function parseDurations(input, defaultDuration, maxDuration) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const nums = list.map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n >= 5 && n <= maxDuration);
  if (!nums.length) return [];
  return [...new Set([defaultDuration, ...nums])].sort((a, b) => a - b).slice(0, 8);
}

// A page's preferred times: null follows the owner's usual setting, true shows the owner's preferred times first on
// this page, false doesn't. Older pages may hold their own range, ['12:00', '17:30'], which still works.
export function normalisePreferred(pr, { allowOff = false } = {}) {
  if ((pr === false || pr === true) && allowOff) return { value: pr };
  if (pr == null || pr === false || pr === '') return { value: null };
  const ok = Array.isArray(pr) && pr.length === 2 && pr.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) && pr[1] > pr[0];
  return ok ? { value: [pr[0], pr[1]] } : { value: null, error: 'Preferred times: the start needs to be before the end.' };
}

// Checks and tidies a page an admin sends. Returns { page, errors }.
export function normalisePage(input, owner) {
  const errors = [];
  const slug = String(input.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(slug)) errors.push('Link name: use lowercase letters, numbers and dashes.');
  else if (RESERVED.has(slug)) errors.push(`"${slug}" is taken by the site itself. Pick another link name.`);

  const hosts = parsePeople(input.hosts);
  const cc = parsePeople(input.cc);
  if (hosts.bad.length) errors.push(`These don't look like email addresses: ${hosts.bad.join(', ')}`);
  if (cc.bad.length) errors.push(`These don't look like email addresses: ${cc.bad.join(', ')}`);
  if (!hosts.people.length) errors.push('Add at least one person who needs to be free.');
  if (hosts.people.length > 40) errors.push('That is a lot of people. Keep it to 40 or fewer.');
  // Someone who must be free doesn't also need to be CC'd.
  const hostEmails = new Set(hosts.people.map((h) => h.email));
  const ccPeople = cc.people.filter((p) => !hostEmails.has(p.email)).slice(0, 50);
  // Editors can change the page after signing in with Google. The owner doesn't need to be listed.
  const eds = parsePeople(input.editors);
  if (eds.bad.length) errors.push(`Editors: these don't look like email addresses: ${eds.bad.join(', ')}`);
  const editors = eds.people.map((p) => p.email).filter((e) => e !== owner).slice(0, 20);

  // Hours: 'working' follows everyone's working hours. 'replace' ("Different hours") uses the page's hours instead of
  // the owner's working hours (afternoons only, or an evening link); colleagues' own working hours still apply.
  // Older pages saved as 'narrow' count as 'replace'. Page hours are in the owner's time zone and follow their trips.
  const hoursMode = ['narrow', 'replace'].includes(input.hoursMode) || (input.hours && !input.hoursMode) ? 'replace' : 'working';
  let hours = null;
  if (hoursMode !== 'working' && input.hours) {
    hours = {};
    for (const d of WEEKDAYS) {
      const v = input.hours?.[d];
      const ok = Array.isArray(v) && v.length === 2 && v.every((t) => TIME.test(t)) && v[1] > v[0];
      hours[d] = ok ? [v[0], v[1]] : null;
    }
    if (!Object.values(hours).some(Boolean)) errors.push("This page's hours: choose at least one day with a start time before its end time.");
  }

  const pr = normalisePreferred(input.preferred, { allowOff: true });
  if (pr.error) errors.push(pr.error);
  const preferred = pr.value;

  const defaultDuration = int(input.defaultDuration, 5, 240, 30);
  const page = {
    slug,
    owner,
    title: clean(input.title, 120).trim() || 'Meeting',
    description: clean(input.description, 2000),
    eventTitle: clean(input.eventTitle, 150).trim() || '{name} <> {hosts}',
    hosts: hosts.people,
    cc: ccPeople,
    defaultDuration,
    maxDuration: 240, // links can ask for any length up to 4 hours (#75 and so on)
    timezone: validTimezone(input.timezone) ? input.timezone : 'Europe/London', // fallback if the owner has none set
    hoursMode: hours ? hoursMode : 'working',
    hours,
    rules: normaliseRules(input.rules), // null: the owner's usual booking rules
    location: ['meet', 'custom', 'none'].includes(input.location) ? input.location : 'meet',
    locationText: clean(input.locationText, 300).trim(),
    allowGuests: input.allowGuests !== false,
    preferred,
    // 'all': everyone listed must be free and attends. 'any': round robin, one free person is picked per booking.
    mode: input.mode === 'any' ? 'any' : 'all',
    durations: [], // filled in below: lengths the guest can choose between ([] = the link decides)
    dailyCap: int(input.dailyCap, 0, 50, 0), // most bookings a day from this page (0 = no limit)
    editors,
  };
  page.durations = parseDurations(input.durations, page.defaultDuration, page.maxDuration);
  if (page.durations.length < 2) page.durations = [];
  if (page.location === 'custom' && !page.locationText) errors.push('Say where the meeting happens, or pick Google Meet.');
  return { page, errors };
}

export function clampDuration(page, value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 5) return page.defaultDuration;
  return Math.min(n, page.maxDuration);
}

export function locationLabel(page) {
  if (page.location === 'meet') return 'Google Meet';
  if (page.location === 'custom') return page.locationText;
  return '';
}

// What anyone with the link may see. No email addresses.
export function publicPage(page, hostNames) {
  return {
    slug: page.slug,
    title: page.title,
    description: page.description,
    with: hostNames.map(firstName),
    defaultDuration: page.defaultDuration,
    maxDuration: page.maxDuration,
    location: locationLabel(page),
    allowGuests: page.allowGuests,
    timezone: page.timezone,
    mode: page.mode || 'all',
    durations: page.durations || [],
    demo: Boolean(page.demo),
  };
}

// The built-in demo page: made-up people with made-up calendars. Nothing gets booked.
export function demoPage() {
  return {
    ...defaultPage({ owner: 'demo', ownerName: 'Ada', timezone: 'Europe/London', slug: 'demo' }),
    title: 'Interview with the research team',
    description:
      'A demo with three made-up people. Only times when Ada, Grace and Alan are all free show up. ' +
      'Times all three prefer are dark green, times one of them prefers are green, and the rest are a click away. ' +
      'Add #75 to the address to book a 75-minute slot. Nothing here gets booked.',
    // Each has their own preferred times: all three overlap from 14:00 to 16:00.
    hosts: [
      { email: 'ada@example.org', name: 'Ada Lovelace', preferred: ['12:00', '17:30'] },
      { email: 'grace@example.org', name: 'Grace Hopper', preferred: ['14:00', '17:30'] },
      { email: 'alan@example.org', name: 'Alan Turing', preferred: ['10:00', '16:00'] },
    ],
    rules: { ...DEFAULT_RULES, minNoticeHours: 2 },
    preferred: ['12:00', '17:30'],
    demo: true,
  };
}
