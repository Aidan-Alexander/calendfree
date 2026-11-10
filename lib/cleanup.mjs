// Deletes booking records (name, email, purpose, guests, time) 30 days after the meeting ends.
// They're only kept so the "cancel or move" link works, and a meeting can't be cancelled once it's over.
// Also deletes "can't find a time" messages 30 days after they were sent (the owner had them by email too).
// Runs daily from netlify/functions/cleanup.mjs. The meeting itself stays in the host's Google Calendar.
import * as store from './store.mjs';

export const KEEP_DAYS = 30;
const DAY = 86_400_000;

// `db` is the store (swappable in tests). Returns how many records were deleted.
export async function deleteOldBookings({ now = Date.now(), days = KEEP_DAYS, db = store } = {}) {
  const cutoff = now - days * DAY;
  let deleted = 0;
  for (const key of await db.listKeys('bookings/')) {
    const booking = await db.getJSON(key);
    // Records without an end time fall back to when they were made.
    const end = Number(booking?.end) || Date.parse(booking?.createdAt || '') || 0;
    if (!booking || end < cutoff) {
      await db.remove(key);
      deleted += 1;
    }
  }
  return deleted;
}

// Messages from people who couldn't find a time, 30 days after they were sent.
export async function deleteOldRequests({ now = Date.now(), days = KEEP_DAYS, db = store } = {}) {
  const cutoff = now - days * DAY;
  let deleted = 0;
  for (const key of await db.listKeys('requests/')) {
    const request = await db.getJSON(key);
    if (!request || (Date.parse(request.createdAt || '') || 0) < cutoff) {
      await db.remove(key);
      deleted += 1;
    }
  }
  return deleted;
}
