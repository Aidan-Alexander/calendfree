// Works out bookable start times. Pure functions, no I/O, so they're easy to test (see test/slots.test.mjs).
import { DateTime } from 'luxon';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MIN = 60_000;
const HOUR = 3_600_000;

// [{start, end}] ISO strings from Google → sorted, merged [{s, e}] in milliseconds
export function mergeBusy(lists) {
  const all = lists
    .flat()
    .map((b) => ({ s: Date.parse(b.start), e: Date.parse(b.end) }))
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

// The span of time to ask Google about: from the earliest allowed start to the end of the last bookable day.
export function bookingWindow(page, now = Date.now()) {
  const from = now + page.minNoticeHours * HOUR;
  const lastDay = DateTime.fromMillis(now, { zone: page.timezone }).startOf('day').plus({ days: page.daysAhead });
  return { from, to: lastDay.endOf('day').toMillis() };
}

// Every start time (ms) where a meeting of `duration` minutes fits inside the page's hours and clear of every
// busy block (plus the page's buffer on each side). `from`/`to` optionally narrow the range of start times.
export function computeSlots({ page, duration, busy, now = Date.now(), from, to }) {
  const win = bookingWindow(page, now);
  const earliest = Math.max(win.from, from ?? -Infinity);
  const latest = Math.min(win.to, to ?? Infinity);
  const dur = duration * MIN;
  const step = page.stepMinutes * MIN;
  const buf = page.bufferMinutes * MIN;
  const slots = [];
  if (!(latest > earliest)) return slots;

  let day = DateTime.fromMillis(earliest, { zone: page.timezone }).startOf('day');
  while (day.toMillis() <= latest) {
    const hours = page.hours[WEEKDAYS[day.weekday - 1]];
    if (hours) {
      const [sh, sm] = hours[0].split(':').map(Number);
      const [eh, em] = hours[1].split(':').map(Number);
      const ws = day.set({ hour: sh, minute: sm }).toMillis();
      const we = day.set({ hour: eh, minute: em }).toMillis();
      for (let t = ws; t + dur <= we; t += step) {
        if (t < earliest || t > latest) continue;
        if (overlaps(busy, t - buf, t + dur + buf)) continue;
        slots.push(t);
      }
    }
    day = day.plus({ days: 1 });
  }
  return slots;
}
