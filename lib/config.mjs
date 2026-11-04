// Settings come from environment variables (set them in Netlify: Site configuration → Environment variables).

function env(key, fallback = '') {
  const fromNetlify = globalThis.Netlify?.env?.get?.(key);
  return fromNetlify ?? process.env[key] ?? fallback;
}

const list = (value) => value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// "/meet" or "" — where the app lives on its site. Must match the BASE_PATH the site was built with.
export function normaliseBase(value) {
  const v = String(value || '').trim().replace(/^\/+|\/+$/g, '');
  return v ? `/${v}` : '';
}

export function cfg() {
  const isDev = env('NETLIFY_DEV') === 'true' || env('CONTEXT') === 'dev';
  return {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
    appSecret: env('APP_SECRET'),
    admins: list(env('ADMIN_EMAILS')),
    domains: list(env('ALLOWED_DOMAINS')),
    basePath: normaliseBase(env('BASE_PATH')),
    // The public address(es) people use, base path included, e.g. "https://example.com/meet". Comma-separate several
    // when the app is reached through more than one domain (each needs its own redirect URI in Google Cloud).
    publicUrls: env('PUBLIC_URL').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    // Local testing only: fake Google calendars so the whole flow can be tried without a Google project.
    fake: isDev && env('OVERLAP_FAKE_GOOGLE') === '1',
    isDev,
  };
}

export function missingConfig() {
  const c = cfg();
  if (c.fake) return c.appSecret ? [] : ['APP_SECRET'];
  const missing = [];
  if (!c.clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!c.clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!c.appSecret) missing.push('APP_SECRET');
  if (!c.admins.length && !c.domains.length) missing.push('ADMIN_EMAILS');
  return missing;
}

// Who may sign in and make booking pages.
export function isAdmin(email) {
  const c = cfg();
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  if (c.admins.includes(e)) return true;
  const domain = e.split('@')[1];
  return Boolean(domain && c.domains.includes(domain));
}
