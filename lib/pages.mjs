// Booking pages: defaults, checking what an admin sends, and what the public may see.
import { DateTime } from 'luxon';
import { WEEKDAYS } from './slots.mjs';

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
  const weekday = ['09:00', '17:30'];
  return {
    slug,
    owner,
    title: `Meet ${first}`,
    description: '',
    eventTitle: '{name} <> {hosts}',
    hosts: [{ email: owner, name: ownerName || '' }],
    cc: [],
    defaultDuration: 25,
    maxDuration: 180,
    timezone: validTimezone(timezone) ? timezone : 'Europe/London',
    hours: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: null, sun: null },
    stepMinutes: 30,
    bufferMinutes: 0,
    minNoticeHours: 4,
    daysAhead: 21,
    location: 'meet',
    locationText: '',
    allowGuests: true,
  };
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

  const hours = {};
  for (const d of WEEKDAYS) {
    const v = input.hours?.[d];
    const ok = Array.isArray(v) && v.length === 2 && v.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) && v[1] > v[0];
    hours[d] = ok ? [v[0], v[1]] : null;
  }
  if (!Object.values(hours).some(Boolean)) errors.push('Choose at least one day with a start time before its end time.');

  const defaultDuration = int(input.defaultDuration, 5, 480, 25);
  const page = {
    slug,
    owner,
    title: clean(input.title, 120).trim() || 'Meeting',
    description: clean(input.description, 2000),
    eventTitle: clean(input.eventTitle, 150).trim() || '{name} <> {hosts}',
    hosts: hosts.people,
    cc: ccPeople,
    defaultDuration,
    maxDuration: Math.max(defaultDuration, int(input.maxDuration, 5, 480, 180)),
    timezone: validTimezone(input.timezone) ? input.timezone : 'Europe/London',
    hours,
    stepMinutes: [5, 10, 15, 20, 30, 60].includes(Number(input.stepMinutes)) ? Number(input.stepMinutes) : 30,
    bufferMinutes: int(input.bufferMinutes, 0, 120, 0),
    minNoticeHours: int(input.minNoticeHours, 0, 720, 4),
    daysAhead: int(input.daysAhead, 1, 90, 21),
    location: ['meet', 'custom', 'none'].includes(input.location) ? input.location : 'meet',
    locationText: clean(input.locationText, 300).trim(),
    allowGuests: input.allowGuests !== false,
  };
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
      'Add #75 to the address to book a 75-minute slot instead. Nothing here gets booked.',
    hosts: [
      { email: 'ada@example.org', name: 'Ada Lovelace' },
      { email: 'grace@example.org', name: 'Grace Hopper' },
      { email: 'alan@example.org', name: 'Alan Turing' },
    ],
    minNoticeHours: 2,
    demo: true,
  };
}
