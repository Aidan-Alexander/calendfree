// Thin wrapper over Google's OAuth and Calendar REST APIs (no SDK needed).
import { cfg } from './config.mjs';
import * as fake from './fake.mjs';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL = 'https://www.googleapis.com/calendar/v3';

export const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
export const SCOPE_FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy';
// Optional, asked for only when someone switches on booking emails: send email as them (to themselves).
export const SCOPE_GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';

// People who make booking pages: create events on their calendar, check free/busy (theirs and colleagues').
export const ADMIN_SCOPES = ['openid', 'email', 'profile', SCOPE_EVENTS, SCOPE_FREEBUSY];
// Colleagues who opt in: free/busy only. Never event titles or details.
export const HOST_SCOPES = ['openid', 'email', 'profile', SCOPE_FREEBUSY];

export class GoogleError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function authUrl({ redirectUri, scopes, state, prompt, loginHint }) {
  const p = new URLSearchParams({
    client_id: cfg().clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    state,
  });
  if (prompt) p.set('prompt', prompt);
  if (loginHint) p.set('login_hint', loginHint);
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(params) {
  const c = cfg();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(data.error_description || data.error || 'token request failed', res.status, data.error);
  return data;
}

export const exchangeCode = (code, redirectUri) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });

export async function refreshAccessToken(refreshToken) {
  if (cfg().fake) return fake.refreshAccessToken(refreshToken);
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

// The ID token comes straight from Google's token endpoint over TLS, so reading its claims is safe without
// checking the signature (Google's own guidance for this flow).
export function idTokenClaims(idToken) {
  const part = String(idToken || '').split('.')[1];
  if (!part) return {};
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

async function calendarFetch(accessToken, path, { method = 'GET', body, query } = {}) {
  const url = `${CAL}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(data.error?.message || `Google Calendar error ${res.status}`, res.status, data.error?.status);
  return data;
}

// Returns { [calendarId]: { busy: [{start, end}], errors?: [...] } }
export async function freeBusy(accessToken, ids, timeMin, timeMax) {
  if (cfg().fake || accessToken === 'demo') return fake.freeBusy(ids, timeMin, timeMax, accessToken);
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const data = await calendarFetch(accessToken, '/freeBusy', {
      method: 'POST',
      body: { timeMin, timeMax, items: ids.slice(i, i + 50).map((id) => ({ id })) },
    });
    Object.assign(out, data.calendars || {});
  }
  return out;
}

export async function insertEvent(accessToken, event, { meet }) {
  if (cfg().fake) return fake.insertEvent(event, { meet });
  return calendarFetch(accessToken, '/calendars/primary/events', {
    method: 'POST',
    body: event,
    query: { sendUpdates: 'all', ...(meet ? { conferenceDataVersion: '1' } : {}) },
  });
}

// Events this app made for one booking page (tagged with a private property), between two ISO times.
export async function listPageEvents(accessToken, slug, timeMin, timeMax) {
  if (cfg().fake) return fake.listEvents(slug, timeMin, timeMax);
  const out = [];
  let pageToken;
  do {
    const data = await calendarFetch(accessToken, '/calendars/primary/events', {
      query: {
        timeMin, timeMax, singleEvents: 'true', maxResults: '2500', privateExtendedProperty: `overlapPage=${slug}`,
        ...(pageToken ? { pageToken } : {}),
      },
    });
    out.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

// A plain-text email from the signed-in person's Gmail.
export async function sendEmail(accessToken, { to, subject, text, replyTo }) {
  if (cfg().fake) {
    console.log(`[fake google] would email ${to}${replyTo ? ` (reply to ${replyTo})` : ''}: ${subject}\n${text}`);
    return {};
  }
  const raw = [
    `To: ${to}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []), // a checked email address, so no line breaks can get in
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text).toString('base64').match(/.{1,76}/g).join('\r\n'),
  ].join('\r\n');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new GoogleError(data.error?.message || `Gmail error ${res.status}`, res.status, data.error?.status);
  return data;
}

export async function deleteEvent(accessToken, eventId) {
  if (cfg().fake) return fake.deleteEvent(eventId);
  try {
    return await calendarFetch(accessToken, `/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      query: { sendUpdates: 'all' },
    });
  } catch (e) {
    if (e.status === 404 || e.status === 410) return {}; // already gone
    throw e;
  }
}
