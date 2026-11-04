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

function joinOr(names) {
  const n = names.filter(Boolean);
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} or ${n[n.length - 1]}`;
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

// Time zone picker. Top: well-known cities, merged when their clocks agree on every date that matters (the booking
// window on a booking page, the whole year for a page's working hours), so there's one option per real choice.
// Then a dotted line, then every location.
const COMMON_ZONES = [
  ['Pacific/Honolulu', 'Honolulu'], ['America/Anchorage', 'Anchorage'], ['America/Los_Angeles', 'Los Angeles'],
  ['America/Vancouver', 'Vancouver'], ['America/Denver', 'Denver'], ['America/Phoenix', 'Phoenix'],
  ['America/Chicago', 'Chicago'], ['America/Mexico_City', 'Mexico City'], ['America/New_York', 'New York'],
  ['America/Toronto', 'Toronto'], ['America/Bogota', 'Bogotá'], ['America/Lima', 'Lima'],
  ['America/Halifax', 'Halifax'], ['America/Santiago', 'Santiago'], ['America/Sao_Paulo', 'São Paulo'],
  ['America/Argentina/Buenos_Aires|America/Buenos_Aires', 'Buenos Aires'], ['Europe/London', 'London'],
  ['Europe/Dublin', 'Dublin'], ['Europe/Lisbon', 'Lisbon'], ['Africa/Accra', 'Accra'], ['Europe/Paris', 'Paris'],
  ['Europe/Berlin', 'Berlin'], ['Europe/Madrid', 'Madrid'], ['Africa/Lagos', 'Lagos'],
  ['Africa/Johannesburg', 'Johannesburg'], ['Africa/Cairo', 'Cairo'], ['Europe/Athens', 'Athens'],
  ['Europe/Kyiv|Europe/Kiev', 'Kyiv'], ['Africa/Nairobi', 'Nairobi'], ['Africa/Addis_Ababa', 'Addis Ababa'],
  ['Europe/Istanbul', 'Istanbul'], ['Asia/Riyadh', 'Riyadh'], ['Europe/Moscow', 'Moscow'], ['Asia/Tehran', 'Tehran'],
  ['Asia/Dubai', 'Dubai'], ['Asia/Karachi', 'Karachi'], ['Asia/Kolkata|Asia/Calcutta', 'India'],
  ['Asia/Kathmandu|Asia/Katmandu', 'Kathmandu'], ['Asia/Dhaka', 'Dhaka'], ['Asia/Bangkok', 'Bangkok'],
  ['Asia/Jakarta', 'Jakarta'], ['Asia/Shanghai', 'Beijing'], ['Asia/Singapore', 'Singapore'],
  ['Australia/Perth', 'Perth'], ['Asia/Tokyo', 'Tokyo'], ['Asia/Seoul', 'Seoul'], ['Australia/Darwin', 'Darwin'],
  ['Australia/Adelaide', 'Adelaide'], ['Australia/Brisbane', 'Brisbane'], ['Australia/Sydney', 'Sydney'],
  ['Australia/Melbourne', 'Melbourne'], ['Pacific/Auckland', 'Auckland'],
];
const zoneFormats = new Map();
function offsetAt(tz, date) {
  try {
    if (!zoneFormats.has(tz)) zoneFormats.set(tz, new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'longOffset' }));
    const part = zoneFormats.get(tz).formatToParts(date).find((p) => p.type === 'timeZoneName').value;
    const m = part.match(/([+-])(\d{2}):?(\d{2})?/);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  } catch {
    return null;
  }
}
const fmtOffset = (min) => `UTC${min < 0 ? '-' : '+'}${Math.floor(Math.abs(min) / 60)}${Math.abs(min) % 60 ? `:${String(Math.abs(min) % 60).padStart(2, '0')}` : ''}`;
// "UTC+1", or "UTC+0/+1" when the zone changes its clocks during the dates that matter.
function fmtOffsets(list) {
  const u = [...new Set(list)].sort((a, b) => a - b);
  return [fmtOffset(u[0]), ...u.slice(1).map((m) => fmtOffset(m).slice(3))].join('/');
}
const cityOf = (tz) => tz.split('/').pop().replaceAll('_', ' ');
const optionCache = new Map();

function allZones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}
const prettyZone = (tz) => tz.replaceAll('_', ' ').replaceAll('/', ' / ');
const fullList = () => allZones().map((tz) => `<option value="${esc(tz)}">${esc(prettyZone(tz))}</option>`).join('');
const DOTTED = '<option disabled>┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈</option>';
// Names for the time zones, best-known first. The last few only name zones that have no big city.
const CITY = new Map([
  ...COMMON_ZONES,
  ['America/Nuuk|America/Godthab', 'Nuuk'], ['America/Noronha', 'Fernando de Noronha'], ['Atlantic/Azores', 'Azores'],
  ['Atlantic/Cape_Verde', 'Cape Verde'], ['Pacific/Fiji', 'Fiji'], ['Asia/Kamchatka', 'Kamchatka'],
].flatMap(([names, city]) => names.split('|').map((n) => [n, city])));
const RANK = new Map([...CITY.keys()].map((z, i) => [z, i]));

// Booking page: one option per actual time zone during the bookable dates (UTC-10 to UTC+13, plus India's +5:30),
// labelled with places people know. The visitor's own zone is always there, however unusual. Zones that change
// their clocks inside the bookable dates show both offsets, e.g. "UTC+0/+1 · London".
function windowZoneOptions(selected, until) {
  const now = Date.now();
  const samples = [];
  for (let t = now; t < until; t += 7 * 86_400_000) samples.push(new Date(t));
  samples.push(new Date(until));
  const groups = new Map();
  for (const tz of new Set([...allZones(), ...CITY.keys()])) {
    const offs = samples.map((d) => offsetAt(tz, d));
    if (offs[0] === null) continue;
    const key = offs.join('|');
    if (!groups.has(key)) groups.set(key, { offs, zones: [] });
    groups.get(key).zones.push(tz);
  }
  const selectedKey = samples.map((d) => offsetAt(selected, d)).join('|');
  const keep = [...groups.entries()].filter(([key, g]) => {
    if (key === selectedKey) return true;
    const constant = g.offs.every((o) => o === g.offs[0]);
    const o = g.offs[0];
    if (constant) return (o % 60 === 0 && o >= -600 && o <= 780) || o === 330;
    return g.zones.some((z) => CITY.has(z)); // a well-known place changing its clocks during the window
  });
  const options = keep.map(([key, g]) => {
    const known = g.zones.filter((z) => CITY.has(z)).sort((a, b) => RANK.get(a) - RANK.get(b));
    const others = g.zones.filter((z) => !CITY.has(z) && !z.startsWith('Etc/') && z.includes('/'));
    const names = [...new Set(known.length ? known.map((z) => CITY.get(z)) : others.slice(0, 2).map((z) => cityOf(z)))];
    if (key === selectedKey && !known.length) names.splice(0, names.length, cityOf(selected));
    return {
      value: key === selectedKey ? selected : known[0] || others[0] || g.zones[0],
      minutes: g.offs[0],
      label: `${fmtOffsets(g.offs)} · ${names.slice(0, 3).join(', ')}`,
    };
  });
  options.sort((a, b) => a.minutes - b.minutes);
  return options.map((o) => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('') + DOTTED + fullList();
}

// A page's working hours: well-known places, kept apart when their clocks differ at any time of year.
function yearZoneOptions(selected) {
  const y = new Date().getUTCFullYear();
  const samples = [0, 3, 6, 9].map((m) => new Date(Date.UTC(y, m, 15)));
  const keyOf = (tz) => samples.map((d) => offsetAt(tz, d)).join('|');
  const groups = new Map();
  for (const [names, city] of COMMON_ZONES) {
    const tz = names.split('|').find((n) => offsetAt(n, samples[0]) !== null);
    if (!tz) continue;
    const key = keyOf(tz);
    if (!groups.has(key)) groups.set(key, { key, zones: [], cities: [] });
    groups.get(key).zones.push(tz);
    groups.get(key).cities.push(city);
  }
  const selectedKey = keyOf(selected);
  const now = new Date();
  const options = [...groups.values()].map((g) => ({
    value: g.key === selectedKey ? selected : g.zones[0],
    minutes: offsetAt(g.zones[0], now),
    label: `${fmtOffsets(g.key.split('|').map(Number))} · ${g.cities.slice(0, 3).join(', ')}`,
  }));
  if (!groups.has(selectedKey) && offsetAt(selected, now) !== null) {
    options.push({ value: selected, minutes: offsetAt(selected, now), label: `${fmtOffsets(selectedKey.split('|').map(Number))} · ${cityOf(selected)}` });
  }
  options.sort((a, b) => a.minutes - b.minutes);
  return options.map((o) => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('') + DOTTED + fullList();
}

// `until`: the last bookable moment (ms). Without it, the list is for a page's working hours.
function timeZoneOptions(selected, { until } = {}) {
  const cacheKey = `${selected}|${until ? Math.round(until / 86_400_000) : 'year'}`;
  if (!optionCache.has(cacheKey)) optionCache.set(cacheKey, until ? windowZoneOptions(selected, until) : yearZoneOptions(selected));
  return optionCache.get(cacheKey);
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

// A person's own working hours (per day), home time zone and trips. Shared by the admin and opt-in pages.
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
const DAY_KEYS = [['mon', 'Mon', 'Monday'], ['tue', 'Tue', 'Tuesday'], ['wed', 'Wed', 'Wednesday'], ['thu', 'Thu', 'Thursday'],
  ['fri', 'Fri', 'Friday'], ['sat', 'Sat', 'Saturday'], ['sun', 'Sun', 'Sunday']];
const WORKDAY = ['09:00', '17:30'];
const DEFAULT_WEEK = { mon: WORKDAY, tue: WORKDAY, wed: WORKDAY, thu: WORKDAY, fri: WORKDAY, sat: null, sun: null };

function perDay(hours) {
  if (!hours) return null;
  if (Array.isArray(hours.days)) return Object.fromEntries(DAY_KEYS.map(([d]) => [d, hours.days.includes(d) ? [hours.from, hours.to] : null]));
  return hours;
}

function tripRow(t = {}) {
  return `<div class="trip-row" data-trip>
      <input type="date" data-tfrom value="${esc(t.from || '')}" aria-label="First day"> <span class="muted">to</span>
      <input type="date" data-tto value="${esc(t.to || '')}" aria-label="Last day">
      <select class="input" data-ttz aria-label="Time zone while away">${timeZoneOptions(t.timezone || 'America/New_York')}</select>
      <button type="button" class="btn sm" data-remove-trip>Remove</button>
    </div>`;
}

function hoursForm(hours, timezone, travel = []) {
  const h = perDay(hours) || DEFAULT_WEEK;
  return `<div class="hours-mini">
      <div class="hours">${DAY_KEYS.map(([d, , full]) => `
        <div class="hour-row">
          <label class="check"><input type="checkbox" data-hon="${d}"${h[d] ? ' checked' : ''}> <span>${full}</span></label>
          <input type="time" data-hfrom="${d}" value="${esc(h[d]?.[0] || WORKDAY[0])}" aria-label="${full} from"> <span class="muted">to</span>
          <input type="time" data-hto="${d}" value="${esc(h[d]?.[1] || WORKDAY[1])}" aria-label="${full} to">
        </div>`).join('')}
      </div>
      <label class="field">Time zone <select class="input" data-htz>${timeZoneOptions(timezone || browserZone)}</select></label>
      <div class="trips">
        <span class="label">Travelling</span>
        <p class="hint">On these dates the same hours apply in the time zone you'll be in. Nothing else to change.</p>
        <div data-trips>${(travel || []).map(tripRow).join('')}</div>
        <button type="button" class="btn sm" data-add-trip>Add a trip</button>
      </div>
    </div>`;
}

function readHoursForm(el) {
  const hours = {};
  for (const [d] of DAY_KEYS) {
    hours[d] = el.querySelector(`[data-hon="${d}"]`).checked ? [el.querySelector(`[data-hfrom="${d}"]`).value, el.querySelector(`[data-hto="${d}"]`).value] : null;
  }
  const travel = [...el.querySelectorAll('[data-trip]')]
    .map((row) => ({ from: row.querySelector('[data-tfrom]').value, to: row.querySelector('[data-tto]').value || row.querySelector('[data-tfrom]').value, timezone: row.querySelector('[data-ttz]').value }))
    .filter((t) => t.from);
  return { hours, timezone: el.querySelector('[data-htz]').value, travel };
}

// "Mon–Thu 09:00–17:30, Fri 09:00–15:00 (London)"
function describeHours(hours, timezone) {
  const h = perDay(hours);
  if (!h) return '';
  const groups = [];
  DAY_KEYS.forEach(([d, short], i) => {
    if (!h[d]) return;
    const key = h[d].join('–');
    const last = groups[groups.length - 1];
    if (last && last.key === key && last.end === i - 1) {
      last.end = i;
      last.to = short;
    } else groups.push({ key, end: i, from: short, to: short });
  });
  const text = groups.map((g) => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} ${g.key}`).join(', ');
  return `${text}${timezone ? ` (${cityOf(timezone)})` : ''}`;
}

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add-trip]');
  if (add) add.closest('.trips').querySelector('[data-trips]').insertAdjacentHTML('beforeend', tripRow());
  const remove = e.target.closest('[data-remove-trip]');
  if (remove) remove.closest('[data-trip]').remove();
});
