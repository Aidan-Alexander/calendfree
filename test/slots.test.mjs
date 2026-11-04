import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { computeSlots, mergeBusy } from '../lib/slots.mjs';
import { defaultPage, normalisePage, parsePeople, clampDuration } from '../lib/pages.mjs';

const page = (over = {}) => ({ ...defaultPage({ owner: 'me@example.org', ownerName: 'Me', timezone: 'Europe/London' }), minNoticeHours: 0, ...over });
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
  assert.equal(clampDuration(p, 'abc'), 25);
  assert.equal(clampDuration(p, 999), 180);
});
