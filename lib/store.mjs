// Storage: Netlify Blobs (free, built in). Keys:
//   users/<email>     who has signed in or shared their calendar (Google tokens encrypted)
//   pages/<slug>      booking pages
//   bookings/<token>  bookings, so people can cancel
//   settings/site     site-wide settings (which page shows at the site root)
import { getStore } from '@netlify/blobs';

const store = () => getStore({ name: 'overlap', consistency: 'strong' });

export const getJSON = (key) => store().get(key, { type: 'json' });
export const setJSON = (key, value) => store().setJSON(key, value);
export const remove = (key) => store().delete(key);

export async function listKeys(prefix) {
  const { blobs } = await store().list({ prefix });
  return blobs.map((b) => b.key);
}

export const userKey = (email) => `users/${String(email).toLowerCase()}`;
export const pageKey = (slug) => `pages/${slug}`;
export const bookingKey = (token) => `bookings/${token}`;
