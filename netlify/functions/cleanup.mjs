// Once a day: delete booking records 30 days after their meeting, and "can't find a time" messages 30 days after
// they were sent (see lib/cleanup.mjs).
import { deleteOldBookings, deleteOldRequests, KEEP_DAYS } from '../../lib/cleanup.mjs';

export default async () => {
  const deleted = await deleteOldBookings();
  const messages = await deleteOldRequests();
  const s = (n) => (n === 1 ? '' : 's');
  console.log(`Deleted ${deleted} booking record${s(deleted)} more than ${KEEP_DAYS} days after the meeting, and ${messages} message${s(messages)} more than ${KEEP_DAYS} days old.`);
  return new Response(JSON.stringify({ deleted, messages }), { headers: { 'content-type': 'application/json' } });
};

export const config = { schedule: '@daily' };
