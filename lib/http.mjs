import { cfg } from './config.mjs';

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

// `location` is either absolute or a path inside the app ("/admin/"), which gets the app's address in front.
export function redirect(location, cookies = [], req = null) {
  if (req && location.startsWith('/')) location = origin(req) + location;
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

export function getCookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

// The app's public address with its base path, e.g. "https://example.com/meet". When the app is proxied from another
// site (example.com/meet → this site), PUBLIC_URL says which address people actually use.
export function origin(req) {
  const c = cfg();
  if (c.publicUrls.length) {
    // Behind a Netlify proxy, the Host header still says which site the person typed.
    const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host).split(',')[0].trim().toLowerCase();
    return c.publicUrls.find((u) => new URL(u).host.toLowerCase() === host) || c.publicUrls[0];
  }
  return new URL(req.url).origin + c.basePath;
}

export function cookie(req, name, value, maxAge) {
  const secure = origin(req).startsWith('https:') ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function readBody(req) {
  const text = await req.text();
  if (text.length > 20_000) throw Object.assign(new Error('Request too large'), { status: 413 });
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}
