// Once a day: delete booking records 30 days after their meeting (see lib/cleanup.mjs).
import { deleteOldBookings, KEEP_DAYS } from '../../lib/cleanup.mjs';

export default async () => {
  const deleted = await deleteOldBookings();
  console.log(`Deleted ${deleted} booking record${deleted === 1 ? '' : 's'} more than ${KEEP_DAYS} days after the meeting.`);
  return new Response(JSON.stringify({ deleted }), { headers: { 'content-type': 'application/json' } });
};

export const config = { schedule: '@daily' };
