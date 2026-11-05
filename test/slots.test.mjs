import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { computeSlots, mergeBusy } from '../lib/slots.mjs';
import { DEFAULT_HOURS, DEFAULT_RULES, defaultPage, normalisePage, parsePeople, clampDuration } from '../lib/pages.mjs';

// A page as availability() sees it: rules and start-time spacing filled in.
const page = (over = {}) => ({ ...defaultPage({ owner: 'me@example.org', ownerName: 'Me', timezone: 'Europe/London' }), ...DEFAULT_RULES, stepMinutes: 30, hours: DEFAULT_HOURS, minNoticeHours: 0, ...over });
const at = (iso, zone = 'Europe/London') => DateTime.fromISO(iso, { zone }).toMillis();
const show = (slots, zone = 'Europe/London') => slots.map((t) => DateTime.fromMillis(t, { zone }).toFormat('ccc HH:mm'));

test('offers slots inside working hours only', () => {
  const now = at('2026-11-09T00:00'); // a Monday
  const slots = computeSlots({ page: page({ daysAhead: 0 }), duration: 25, busy: [], now });
  assert.equal(show(slots)[0], 'Mon 09:00');
  assert.equal(show(slots).at(-1), 'Mon 17:00'); // 17:00 + 25 min fits before 17:30
  assert.equal(slots.length, 17);
});

test('longer meetings must fit before the end of the day', () => {
  const now = at('2026-11-09T00:00');
  const slots = computeSlots({ page: page({ daysAhead: 0 }), duration: 75, busy: [], now });
  assert.equal(show(slots).at(-1), 'Mon 16:00'); // 16:00–17:15 fits, 16:30–17:45 doesn't
});

test("skips times that clash with anyone's busy block, with buffer", () => {
  const now = at('2026-11-09T00:00');
  const busy = mergeBusy([
    [{ start: '2026-11-09T10:00:00Z', end: '2026-11-09T11:00:00Z' }], // person A
    [{ start: '2026-11-09T10:30:00Z', end: '2026-11-09T12:00:00Z' }], // person B
  ]);
  const slots = show(computeSlots({ page: page({ daysAhead: 0 }), duration: 25, busy, now }));
  assert.ok(slots.includes('Mon 09:30'));
  assert.ok(!slots.includes('Mon 10:00') && !slots.includes('Mon 11:30'));
  assert.ok(slots.includes('Mon 12:00'));
  const buffered = show(computeSlots({ page: page({ daysAhead: 0, bufferMinutes: 10 }), duration: 25, busy, now }));
  assert.ok(!buffered.includes('Mon 09:30')); // 09:30–09:55 plus 10 min runs into 10:00
  assert.ok(!buffered.includes('Mon 12:00'));
  assert.ok(buffered.includes('Mon 12:30'));
});

test('respects minimum notice and days ahead', () => {
  const now = at('2026-11-09T10:10');
  const slots = computeSlots({ page: page({ minNoticeHours: 2, daysAhead: 1 }), duration: 25, busy: [], now });
  assert.equal(show(slots)[0], 'Mon 12:30');
  assert.equal(show(slots).at(-1), 'Tue 17:00');
});

test('weekends are off by default', () => {
  const now = at('2026-11-14T00:00'); // Saturday
  const slots = computeSlots({ page: page({ daysAhead: 2 }), duration: 25, busy: [], now });
  assert.equal(show(slots)[0], 'Mon 09:00');
});

test('working hours follow the clock across a daylight-saving change', () => {
  const now = at('2026-10-23T00:00'); // Friday before UK clocks go back on Sun 25 Oct
  const slots = computeSlots({ page: page({ daysAhead: 4 }), duration: 25, busy: [], now });
  const mondayFirst = slots.find((t) => DateTime.fromMillis(t, { zone: 'Europe/London' }).weekday === 1);
  assert.equal(new Date(mondayFirst).toISOString(), '2026-10-26T09:00:00.000Z'); // 09:00 GMT
  assert.equal(new Date(slots[0]).toISOString(), '2026-10-23T08:00:00.000Z'); // 09:00 BST
});

test('a narrow from/to window checks one exact start', () => {
  const now = at('2026-11-09T00:00');
  const start = at('2026-11-09T14:00');
  const slots = computeSlots({ page: page(), duration: 45, busy: [], now, from: start - 60_000, to: start + 60_000 });
  assert.deepEqual(slots, [start]);
});

test('reads people in the usual formats', () => {
  const { people, bad } = parsePeople('Jo Smith <Jo@Example.org>\nsam@example.org, "Kim Lee" kim@example.org\nnot an email');
  assert.deepEqual(people, [
    { email: 'jo@example.org', name: 'Jo Smith' },
    { email: 'sam@example.org', name: '' },
    { email: 'kim@example.org', name: 'Kim Lee' },
  ]);
  assert.deepEqual(bad, ['not an email']);
});

test('page checks: reserved names, CC people who are already hosts, durations', () => {
  const base = page();
  assert.ok(normalisePage({ ...base, slug: 'admin' }, 'me@example.org').errors.length);
  const { page: p, errors } = normalisePage({ ...base, slug: 'interviews', cc: 'me@example.org, boss@example.org' }, 'me@example.org');
  assert.deepEqual(errors, []);
  assert.deepEqual(p.cc.map((c) => c.email), ['boss@example.org']);
  assert.equal(clampDuration(p, '75'), 75);
  assert.equal(clampDuration(p, 'abc'), 30);
  assert.equal(clampDuration(p, 999), 240);
});

test('preferred times: only starts whose whole meeting fits the window', async () => {
  const { preferredSlots } = await import('../lib/slots.mjs');
  const now = at('2026-11-09T00:00');
  const p = page({ daysAhead: 0, preferred: ['12:00', '15:00'] });
  const all = computeSlots({ page: p, duration: 45, busy: [], now });
  const pref = show(preferredSlots(p, all, 45));
  assert.equal(pref[0], 'Mon 12:00');
  assert.equal(pref.at(-1), 'Mon 14:00'); // 14:00–14:45 fits, 14:30–15:15 doesn't
  assert.deepEqual(preferredSlots({ ...p, preferred: null }, all, 45), []);
  assert.ok(normalisePage({ ...p, slug: 'x', preferred: ['15:00', '12:00'] }, 'me@example.org').errors.length);
});

test('preferred times can differ by day', async () => {
  const { preferredSlots } = await import('../lib/slots.mjs');
  const now = at('2026-11-09T00:00'); // a Monday
  const p = page({ daysAhead: 1, preferred: { mon: ['13:00', '15:00'], tue: null } });
  const all = computeSlots({ page: p, duration: 30, busy: [], now });
  const pref = show(preferredSlots(p, all, 30));
  assert.equal(pref[0], 'Mon 13:00');
  assert.equal(pref.at(-1), 'Mon 14:30');
  assert.ok(!pref.some((t) => t.startsWith('Tue')), 'no preferred times on Tuesday');
});

test("someone's own working hours block the rest of the day, in their time zone", async () => {
  const { outsideHours } = await import('../lib/slots.mjs');
  const now = at('2026-11-09T00:00'); // Monday, London
  const ny = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }; // 14:00–22:00 London in November
  const blocks = outsideHours(ny, 'America/New_York', now, now + 86_400_000);
  const slots = show(computeSlots({ page: page({ daysAhead: 0 }), duration: 25, busy: mergeBusy([blocks]), now }));
  assert.equal(slots[0], 'Mon 14:00');
  assert.equal(slots.at(-1), 'Mon 17:00');
});

test('daily cap drops days that are full', async () => {
  const { applyDailyCap } = await import('../lib/slots.mjs');
  const now = at('2026-11-09T00:00');
  const p = page({ daysAhead: 1, dailyCap: 2 });
  const slots = computeSlots({ page: p, duration: 25, busy: [], now });
  const capped = show(applyDailyCap(p, slots, [at('2026-11-09T10:00'), at('2026-11-09T15:00')]));
  assert.ok(capped.every((s) => s.startsWith('Tue')));
  assert.equal(applyDailyCap({ ...p, dailyCap: 0 }, slots, [at('2026-11-09T10:00')]).length, slots.length);
});

test('lengths guests can choose', async () => {
  const { parseDurations } = await import('../lib/pages.mjs');
  assert.deepEqual(parseDurations('60, 45 999', 25, 180), [25, 45, 60]);
  assert.deepEqual(parseDurations('', 25, 180), []);
});

test('per-day hours: an early finish on Fridays', async () => {
  const { outsideHours } = await import('../lib/slots.mjs');
  const now = at('2026-11-13T00:00'); // Friday
  const mine = { ...DEFAULT_HOURS, fri: ['09:00', '15:00'] };
  const p = page({ hours: null, daysAhead: 0 });
  const busy = mergeBusy([outsideHours(mine, 'Europe/London', now, now + 2 * 86_400_000)]);
  const slots = show(computeSlots({ page: p, duration: 25, busy, now }));
  assert.equal(slots[0], 'Fri 09:00');
  assert.equal(slots.at(-1), 'Fri 14:30');
});

test('travel: the same hours follow you to another time zone for those dates', async () => {
  const { outsideHours } = await import('../lib/slots.mjs');
  const now = at('2026-11-16T00:00'); // Monday
  const trip = [{ from: '2026-11-16', to: '2026-11-16', timezone: 'America/New_York' }];
  const p = page({ hours: null, daysAhead: 1 });
  const busy = mergeBusy([outsideHours(DEFAULT_HOURS, 'Europe/London', now, now + 3 * 86_400_000, trip)]);
  const slots = show(computeSlots({ page: p, duration: 25, busy, now }));
  assert.equal(slots[0], 'Mon 14:00'); // 09:00 in New York
  assert.ok(slots.includes('Mon 22:00')); // 17:00 in New York
  assert.ok(slots.includes('Tue 09:00')); // home again
});

test('pages without their own hours follow the default working hours', () => {
  const { page: p, errors } = normalisePage({ ...page(), slug: 'x', hours: null }, 'me@example.org');
  assert.deepEqual(errors, []);
  assert.equal(p.hours, null);
});

test("'different hours' pages: an evening link outside normal working hours", async () => {
  const { outsideHours } = await import('../lib/slots.mjs');
  const now = at('2026-11-09T00:00'); // Monday
  const evenings = { ...Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, null])), mon: ['18:00', '20:00'] };
  const p = page({ hours: null, daysAhead: 0 });
  const busy = mergeBusy([outsideHours(evenings, 'Europe/London', now, now + 2 * 86_400_000)]);
  assert.deepEqual(show(computeSlots({ page: p, duration: 45, busy, now })), ['Mon 18:00', 'Mon 18:30', 'Mon 19:00']);
});

test('booking rules: pages use the usual rules unless they override them', () => {
  const { page: plain } = normalisePage({ ...page(), slug: 'a', rules: null }, 'me@example.org');
  assert.equal(plain.rules, null);
  const { page: own } = normalisePage({ ...page(), slug: 'b', rules: { bufferMinutes: 10, minNoticeHours: 24, daysAhead: 7 } }, 'me@example.org');
  assert.deepEqual(own.rules, { bufferMinutes: 10, minNoticeHours: 24, daysAhead: 7 });
  const { page: different } = normalisePage({ ...page(), slug: 'c', hoursMode: 'narrow', hours: { ...DEFAULT_HOURS } }, 'me@example.org');
  assert.equal(different.hoursMode, 'replace'); // older 'narrow' pages become 'Different hours'
  const { page: working } = normalisePage({ ...page(), slug: 'd', hoursMode: 'working', hours: { ...DEFAULT_HOURS } }, 'me@example.org');
  assert.equal(working.hours, null);
});

test('whole-day pages let a meeting cross midnight, without repeating the next start', () => {
  const now = at('2026-11-09T22:00');
  const p = page({ hours: null, daysAhead: 1 });
  const slots = show(computeSlots({ page: p, duration: 45, busy: [], now, to: at('2026-11-10T01:00') }));
  assert.deepEqual(slots, ['Mon 22:00', 'Mon 22:30', 'Mon 23:00', 'Mon 23:30', 'Tue 00:00', 'Tue 00:30', 'Tue 01:00']);
});

test('a start time right after a meeting and its gap, as well as the half-hour grid', () => {
  const now = at('2026-11-09T00:00'); // Monday
  const p = page({ daysAhead: 0, bufferMinutes: 5 });
  const busy = mergeBusy([[{ start: '2026-11-09T12:00:00Z', end: '2026-11-09T12:30:00Z' }]]);
  const slots = show(computeSlots({ page: p, duration: 30, busy, now }));
  assert.ok(slots.includes('Mon 11:00') && !slots.includes('Mon 11:30') && !slots.includes('Mon 12:30'));
  assert.ok(slots.includes('Mon 12:35'));
  assert.ok(slots.includes('Mon 13:00'));
  assert.ok(!slots.some((s) => /:(05|10|15|20|40|45|50|55)$/.test(s))); // no other odd times
});

test('the gap only applies around meetings, not the edges of working hours', async () => {
  const { outsideHours } = await import('../lib/slots.mjs');
  const now = at('2026-11-09T00:00');
  const p = page({ hours: null, daysAhead: 0, bufferMinutes: 10 });
  const blocked = mergeBusy([outsideHours(DEFAULT_HOURS, 'Europe/London', now, now + 86_400_000)]);
  const slots = show(computeSlots({ page: p, duration: 30, busy: [], blocked, now }));
  assert.equal(slots[0], 'Mon 09:00');
  assert.equal(slots.at(-1), 'Mon 17:00');
});

test('start times: every 30 minutes for whole half-hours, every 15 otherwise', async () => {
  const { effectivePage } = await import('../lib/calendar.mjs');
  const demo = { ...page(), demo: true };
  assert.equal((await effectivePage(demo, 30)).stepMinutes, 30);
  assert.equal((await effectivePage(demo, 60)).stepMinutes, 30);
  assert.equal((await effectivePage(demo, 45)).stepMinutes, 15);
  assert.equal((await effectivePage(demo, 25)).stepMinutes, 15);
});

test('working hours can have several windows a day (a lunch break)', async () => {
  const { outsideHours } = await import('../lib/slots.mjs');
  const { normaliseHours } = await import('../lib/pages.mjs');
  const { hours, error } = normaliseHours({ mon: [['13:00', '17:30'], ['09:00', '12:00'], ['11:30', '12:15']], sun: [['22:00', '24:00']] });
  assert.equal(error, undefined);
  assert.deepEqual(hours.mon, [['09:00', '12:15'], ['13:00', '17:30']]); // sorted and merged
  const now = at('2026-11-09T00:00'); // Monday
  const blocked = outsideHours(hours, 'Europe/London', now, now + 86_400_000);
  const p = page({ hours: null, daysAhead: 0 });
  const slots = show(computeSlots({ page: { ...p, hours: null }, duration: 30, busy: [], blocked, now }));
  assert.ok(slots.includes('Mon 09:00') && slots.includes('Mon 11:30') && slots.includes('Mon 13:00'));
  assert.ok(!slots.includes('Mon 12:30'), 'nothing in the lunch break');
  assert.ok(normaliseHours({ mon: [['10:00', '09:00']] }).error);
});

test('finished trips stay listed for a week, then drop off', async () => {
  const { normaliseTravel, currentTrips } = await import('../lib/pages.mjs');
  const day = (n) => DateTime.now().plus({ days: n }).toISODate();
  const trips = [
    { from: day(-20), to: day(-10), timezone: 'America/New_York' }, // ended 10 days ago: gone
    { from: day(-6), to: day(-3), timezone: 'America/New_York' }, // ended 3 days ago: still listed
    { from: day(5), to: day(9), timezone: 'Asia/Tokyo' }, // coming up
  ];
  const { travel, error } = normaliseTravel(trips);
  assert.equal(error, undefined);
  assert.deepEqual(travel.map((t) => t.to), [day(-3), day(9)]);
  assert.deepEqual(currentTrips(trips).map((t) => t.to), [day(-3), day(9)]);
});

test('preference levels: most preferred when everyone prefers a time, preferred when anyone does', async () => {
  const { preferenceLevels } = await import('../lib/calendar.mjs');
  const mon = (hm) => at(`2026-11-09T${hm}`);
  const slots = [mon('10:00'), mon('13:00'), mon('15:00')];
  const people = [
    { email: 'a@x.org', pref: ['12:00', '17:30'], timezone: 'Europe/London', travel: [] },
    { email: 'b@x.org', pref: { mon: [['14:00', '16:00']] }, timezone: 'Europe/London', travel: [] },
  ];
  const all = preferenceLevels({ mode: 'all', showFirst: true }, people, slots, 30, new Map());
  assert.deepEqual(show(all.preferred), ['Mon 13:00', 'Mon 15:00']);
  assert.deepEqual(show(all.most), ['Mon 15:00']);
  // Round robin: anyone free who prefers it makes it preferred; no "most" level.
  const free = new Map(slots.map((t) => [t, ['a@x.org', 'b@x.org']]));
  const rr = preferenceLevels({ mode: 'any', showFirst: true }, people, slots, 30, free);
  assert.deepEqual(show(rr.preferred), ['Mon 13:00', 'Mon 15:00']);
  assert.deepEqual(rr.most, []);
  // Switched off for the page: nothing preferred.
  assert.deepEqual(preferenceLevels({ mode: 'all', showFirst: false }, people, slots, 30, new Map()).preferred, []);
});
