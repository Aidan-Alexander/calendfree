// Small helpers shared by every page.
const BASE = '{{BASE}}';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-Overlap': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  }).catch(() => null);
  if (!res) return { _status: 0, error: 'offline' };
  let data = {};
  try {
    data = await res.json();
  } catch {}
  data._status = res.status;
  return data;
}

function fmtDuration(n) {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} hr ${m} min` : `${h} hour${h > 1 ? 's' : ''}`;
}

const fmtTime = (ms, timeZone) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(ms));
const fmtDay = (ms, timeZone) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(new Date(ms));

function joinNames(names) {
  const n = names.filter(Boolean);
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  if (button) {
    const before = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => (button.textContent = before), 1400);
  }
}

// Time zone picker: one option per zone that actually behaves differently (same offsets in January and July = same
// zone), labelled with a well-known city, then a dotted line, then every location.
const FAMOUS = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago',
  'America/Mexico_City', 'America/New_York', 'America/Bogota', 'America/Halifax', 'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires', 'America/Buenos_Aires', 'America/St_Johns', 'Atlantic/Azores', 'Europe/London',
  'UTC', 'Africa/Lagos', 'Europe/Paris', 'Africa/Johannesburg', 'Europe/Athens', 'Africa/Cairo', 'Africa/Nairobi',
  'Europe/Istanbul', 'Europe/Moscow', 'Asia/Tehran', 'Asia/Dubai', 'Asia/Kabul', 'Asia/Karachi', 'Asia/Kolkata',
  'Asia/Calcutta', 'Asia/Kathmandu', 'Asia/Katmandu', 'Asia/Dhaka', 'Asia/Yangon', 'Asia/Rangoon', 'Asia/Bangkok',
  'Asia/Jakarta', 'Asia/Singapore', 'Asia/Shanghai', 'Australia/Perth', 'Asia/Tokyo', 'Australia/Darwin',
  'Australia/Adelaide', 'Australia/Brisbane', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Fiji',
];
let zoneCache = null;
function zoneData() {
  if (zoneCache) return zoneCache;
  let all = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {}
  const year = new Date().getUTCFullYear();
  const jan = new Date(Date.UTC(year, 0, 15));
  const jul = new Date(Date.UTC(year, 6, 15));
  const offset = (tz, d) => {
    try {
      const part = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName').value;
      const m = part.match(/([+-])(\d{2}):?(\d{2})?/);
      return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
    } catch {
      return null;
    }
  };
  const groups = new Map();
  for (const tz of all) {
    const a = offset(tz, jan);
    const b = offset(tz, jul);
    if (a === null) continue;
    const key = `${a}|${b}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tz);
  }
  zoneCache = { all, groups, keyOf: new Map() };
  for (const [key, zones] of groups) for (const z of zones) zoneCache.keyOf.set(z, key);
  return zoneCache;
}

const cityOf = (tz) => tz.split('/').pop().replaceAll('_', ' ');

function zoneLabel(tz) {
  const now = new Date();
  let off = 'UTC';
  let generic = '';
  try {
    const raw = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName').value;
    off = raw.replace('GMT', 'UTC');
    generic = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(now).find((p) => p.type === 'timeZoneName').value;
  } catch {}
  if (/^GMT[+-]/.test(generic) || generic === 'GMT') generic = '';
  return `${off} · ${generic ? `${generic} (${cityOf(tz)})` : cityOf(tz)}`;
}

function timeZoneOptions(selected) {
  const { all, groups, keyOf } = zoneData();
  const now = new Date();
  const picks = [];
  for (const [key, zones] of groups) {
    // Show the zone already chosen in its own group, otherwise the best-known city in it.
    const tz = zones.includes(selected) ? selected : FAMOUS.find((f) => zones.includes(f)) || zones[0];
    const minutes = Number(key.split('|')[now.getUTCMonth() >= 3 && now.getUTCMonth() <= 9 ? 1 : 0]);
    picks.push({ tz, minutes });
  }
  if (!keyOf.has(selected)) picks.push({ tz: selected, minutes: 0 });
  picks.sort((x, y) => x.minutes - y.minutes || cityOf(x.tz).localeCompare(cityOf(y.tz)));
  const top = picks.map(({ tz }) => `<option value="${esc(tz)}"${tz === selected ? ' selected' : ''}>${esc(zoneLabel(tz))}</option>`);
  const rest = all.map((tz) => `<option value="${esc(tz)}">${esc(tz.replaceAll('_', ' ').replaceAll('/', ' / '))}</option>`);
  return `${top.join('')}<option disabled>┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈</option>${rest.join('')}`;
}

const local = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
