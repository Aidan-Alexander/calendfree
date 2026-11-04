// Signed cookies and encrypted Google tokens, both keyed from APP_SECRET.
import { cfg } from './config.mjs';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

let cached = null;

async function keys() {
  const secret = cfg().appSecret;
  if (!secret) throw new Error('APP_SECRET is not set');
  if (cached?.secret === secret) return cached;
  const hmacRaw = await subtle.digest('SHA-256', enc.encode(`overlap:session:${secret}`));
  const aesRaw = await subtle.digest('SHA-256', enc.encode(`overlap:tokens:${secret}`));
  cached = {
    secret,
    hmac: await subtle.importKey('raw', hmacRaw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
    aes: await subtle.importKey('raw', aesRaw, 'AES-GCM', false, ['encrypt', 'decrypt']),
  };
  return cached;
}

export async function sign(obj) {
  const k = await keys();
  const payload = b64u(enc.encode(JSON.stringify(obj)));
  const sig = b64u(await subtle.sign('HMAC', k.hmac, enc.encode(payload)));
  return `${payload}.${sig}`;
}

export async function verify(token) {
  if (!token || !token.includes('.')) return null;
  const k = await keys();
  const [payload, sig] = token.split('.');
  let ok = false;
  try {
    ok = await subtle.verify('HMAC', k.hmac, unb64u(sig), enc.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  const obj = JSON.parse(dec.decode(unb64u(payload)));
  if (obj.exp && obj.exp < Date.now()) return null;
  return obj;
}

export async function encrypt(text) {
  const k = await keys();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, k.aes, enc.encode(text));
  return `${b64u(iv)}.${b64u(ct)}`;
}

export async function decrypt(s) {
  const k = await keys();
  const [iv, ct] = s.split('.');
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, k.aes, unb64u(ct));
  return dec.decode(pt);
}

export function randomId(bytes = 18) {
  return b64u(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}
