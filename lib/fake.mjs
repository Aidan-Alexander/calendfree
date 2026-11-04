// Made-up calendars for the public demo page and for local testing (OVERLAP_FAKE_GOOGLE=1 with `netlify dev`).
// Busy times are random but stable for a given calendar and day, so the demo looks like real, busy people.
import { DateTime } from 'luxon';
import { getJSON, setJSON } from './store.mjs';

function seeded(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function fakeBusy(id, timeMin, timeMax) {
  const busy = [];
  let day = DateTime.fromISO(timeMin, { zone: 'Europe/London' }).startOf('day');
  const end = DateTime.fromISO(timeMax);
  while (day < end) {
    const rand = seeded(`${id}|${day.toISODate()}`);
    if (day.weekday <= 5) {
      const blocks = 2 + Math.floor(rand() * 4);
      for (let i = 0; i < blocks; i++) {
        const startHour = 8 + Math.floor(rand() * 18) / 2; // 08:00–16:30, half-hour steps
        const length = [30, 30, 45, 60, 60, 90][Math.floor(rand() * 6)];
        const s = day.plus({ minutes: startHour * 60 });
        busy.push({ start: s.toUTC().toISO(), end: s.plus({ minutes: length }).toUTC().toISO() });
      }
    }
    day = day.plus({ days: 1 });
  }
  return busy;
}

export function freeBusy(ids, timeMin, timeMax, accessToken = '') {
  const out = {};
  for (const id of ids) {
    // Lets local testing show a colleague who hasn't shared their calendar: anyone with "hidden" in their address
    // can only be read with their own connection.
    if (/hidden|private/.test(id) && !accessToken.endsWith(`:${id}`)) out[id] = { busy: [], errors: [{ domain: 'global', reason: 'notFound' }] };
    else out[id] = { busy: fakeBusy(id, timeMin, timeMax) };
  }
  return out;
}

export async function refreshAccessToken(refreshToken) {
  return { access_token: `fake-access:${refreshToken}`, expires_in: 3600 };
}

// The made-up calendar keeps its bookings in Blobs, so local testing can count them across requests.
const loadEvents = async () => (await getJSON('fake/events')) || [];

export async function listEvents(slug, timeMin, timeMax) {
  const from = Date.parse(timeMin);
  const to = Date.parse(timeMax);
  return (await loadEvents()).filter((e) => e.extendedProperties?.private?.overlapPage === slug && Date.parse(e.start.dateTime) < to && Date.parse(e.end.dateTime) > from);
}

export async function insertEvent(event, { meet }) {
  const id = `fake-${Math.random().toString(36).slice(2, 10)}`;
  await setJSON('fake/events', [...(await loadEvents()), { ...event, id }]);
  console.log('[fake google] would create event:', JSON.stringify(event, null, 2));
  return { id, htmlLink: 'https://calendar.google.com/', hangoutLink: meet ? 'https://meet.google.com/abc-defg-hij' : undefined };
}

export async function deleteEvent(eventId) {
  console.log('[fake google] would delete event', eventId);
  await setJSON('fake/events', (await loadEvents()).filter((e) => e.id !== eventId));
  return {};
}
