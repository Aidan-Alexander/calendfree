// Works out bookable start times. Pure functions, no I/O, so they're easy to test (see test/slots.test.mjs).
import { DateTime } from 'luxon';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MIN = 60_000;
const HOUR = 3_600_000;

// [{start, end}] ISO strings from Google → sorted, merged [{s, e}] in milliseconds
export function mergeBusy(lists) {
  const all = lists
    .flat()
    .map((b) => ('s' in b ? { s: b.s, e: b.e } : { s: Date.parse(b.start), e: Date.parse(b.end) }))
    .filter((i) => Number.isFinite(i.s) && Number.isFinite(i.e) && i.e > i.s)
    .sort((a, b) => a.s - b.s);
  const out = [];
  for (const i of all) {
    const last = out[out.length - 1];
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ ...i });
  }
  return out;
}

function overlaps(busy, s, e) {
  for (const b of busy) {
    if (b.s >= e) return false;
    if (b.e > s) return true;
  }
  return false;
}

// One day's hours as a list of windows: [['09:00', '12:00'], ['13:00', '17:30']]. Older data has one window,
// ['09:00', '17:30'], and null or [] means none that day.
export function windowsOf(v) {
  if (!Array.isArray(v) || !v.length) return [];
  if (typeof v[0] === 'string') return [[v[0], v[1]]];
  return v.filter((w) => Array.isArray(w) && w.length === 2);
}

// A local time on a given day as ms; '24:00' is the end of that day.
function atTime(local, hm) {
  if (hm === '24:00') return local.startOf('day').plus({ days: 1 }).toMillis();
  const [h, m] = hm.split(':').map(Number);
  return local.set({ hour: h, minute: m }).toMillis();
}

// Per-day hours { mon: [windows], …, sun: null }. Also accepts the older { days, from, to } shape.
export function perDayHours(hours) {
  if (!hours) return null;
  if (Array.isArray(hours.days)) return Object.fromEntries(WEEKDAYS.map((d) => [d, hours.days.includes(d) ? [hours.from, hours.to] : null]));
  return hours;
}

// A person's own working hours as busy blocks: everything between from and to (ms) outside their working windows.
// Hours are in their home time zone `tz`, except on dates covered by a trip ({ from, to, timezone }, dates as
// YYYY-MM-DD), when the same hours apply in the trip's time zone.
export function outsideHours(hours, tz, from, to, travel = []) {
  const perDay = perDayHours(hours);
  const windows = [];
  const last = DateTime.fromMillis(to, { zone: tz }).startOf('day').plus({ days: 1 });
  for (let d = DateTime.fromMillis(from, { zone: tz }).startOf('day').minus({ days: 1 }); d <= last; d = d.plus({ days: 1 })) {
    const date = d.toISODate();
    const trip = travel.find((t) => date >= t.from && date <= t.to);
    const local = DateTime.fromISO(date, { zone: trip?.timezone || tz });
    for (const w of windowsOf(perDay[WEEKDAYS[local.weekday - 1]])) windows.push([atTime(local, w[0]), atTime(local, w[1])]);
  }
  windows.sort((a, b) => a[0] - b[0]);
  const out = [];
  let cursor = from;
  for (const [ws, we] of windows) {
    if (ws > cursor) out.push({ s: cursor, e: Math.min(ws, to) });
    cursor = Math.max(cursor, we);
  }
  if (cursor < to) out.push({ s: cursor, e: to });
  return out.filter((i) => i.e > i.s);
}

// Drops start times on days that already have `cap` bookings from this page (days in the page's time zone).
export function applyDailyCap(page, slots, bookedStarts) {
  if (!page.dailyCap) return slots;
  const day = (t) => DateTime.fromMillis(t, { zone: page.timezone }).toISODate();
  const counts = new Map();
  for (const t of bookedStarts) counts.set(day(t), (counts.get(day(t)) || 0) + 1);
  return slots.filter((t) => (counts.get(day(t)) || 0) < page.dailyCap);
}

// The time zone someone is in at time t: their home zone, or a trip's zone on the trip's dates.
export function zoneOn(t, tz, travel = []) {
  const date = DateTime.fromMillis(t, { zone: tz }).toISODate();
  return travel.find((x) => date >= x.from && date <= x.to)?.timezone || tz;
}

// The start times (ms) that fall inside the page's preferred hours, start to finish, in the page's time zone.
// page.preferred is either per day ({ mon: ['12:00', '17:30'], … }) or one range for every day (older pages).
export function preferredSlots(page, slots, duration) {
  if (!page.preferred) return [];
  const toMin = (hm) => {
    const [h, m] = hm.split(':').map(Number);
    return h * 60 + m;
  };
  return slots.filter((t) => {
    const d = DateTime.fromMillis(t, { zone: zoneOn(t, page.timezone, page.travel) });
    const ranges = Array.isArray(page.preferred) ? [page.preferred] : windowsOf(page.preferred[WEEKDAYS[d.weekday - 1]]);
    const start = d.hour * 60 + d.minute;
    return ranges.some((r) => start >= toMin(r[0]) && start + duration <= toMin(r[1]));
  });
}

// The span of time to ask Google about: from the earliest allowed start to the end of the last bookable day.
export function bookingWindow(page, now = Date.now()) {
  const from = now + page.minNoticeHours * HOUR;
  const lastDay = DateTime.fromMillis(now, { zone: page.timezone }).startOf('day').plus({ days: page.daysAhead });
  return { from, to: lastDay.endOf('day').toMillis() };
}

// Every start time (ms) where a meeting of `duration` minutes fits inside the page's hours and clear of everything.
// - busy: other meetings. The page's gap (buffer) applies around these.
// - blocked: time outside someone's working hours or the page's hours. No gap needed around these.
// Start times are on the tidy grid (every stepMinutes from the start of the hours), plus the first time after each
// meeting (and its gap) or blocked spell ends, rounded up to 5 minutes, so a 12:00–12:30 meeting with a 5-minute
// gap still lets someone book 12:35. `from`/`to` optionally narrow the range of start times.
export function computeSlots({ page, duration, busy, blocked = [], now = Date.now(), from, to }) {
  const win = bookingWindow(page, now);
  const earliest = Math.max(win.from, from ?? -Infinity);
  const latest = Math.min(win.to, to ?? Infinity);
  const dur = duration * MIN;
  const step = page.stepMinutes * MIN;
  const buf = page.bufferMinutes * MIN;
  const slots = [];
  if (!(latest > earliest)) return slots;

  const FIVE = 5 * MIN;
  const ceil5 = (t) => Math.ceil(t / FIVE) * FIVE;
  const afterwards = [...busy.map((b) => ceil5(b.e + buf)), ...blocked.map((b) => ceil5(b.e))].sort((a, b) => a - b);
  const fits = (t) => t >= earliest && t <= latest && !overlaps(busy, t - buf, t + dur + buf) && !overlaps(blocked, t, t + dur);

  let day = DateTime.fromMillis(earliest, { zone: page.timezone }).startOf('day');
  while (day.toMillis() <= latest) {
    // A page without its own hours offers the whole day; people's working hours (as blocked time) do the limiting.
    const hours = page.hours ? page.hours[WEEKDAYS[day.weekday - 1]] : ['00:00', '24:00'];
    if (hours) {
      const [sh, sm] = hours[0].split(':').map(Number);
      const [eh, em] = hours[1].split(':').map(Number);
      const ws = day.set({ hour: sh, minute: sm }).toMillis();
      // Whole-day windows run into the next day, so a meeting can cross midnight (someone travelling, say).
      const we = eh === 24 ? day.plus({ days: 1 }).toMillis() + dur - 1 : day.set({ hour: eh, minute: em }).toMillis();
      const starts = new Set();
      for (let t = ws; t + dur <= we; t += step) starts.add(t);
      for (const t of afterwards) if (t >= ws && t + dur <= we) starts.add(t);
      for (const t of [...starts].sort((a, b) => a - b)) if (fits(t)) slots.push(t);
    }
    day = day.plus({ days: 1 });
  }
  return slots;
}
