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
  ['Pacific/Honolulu', 'Honolulu'], ['America/Anchorage', 'Anchorage'], ['America/Los_Angeles', 'San Francisco, Los Angeles'],
  ['America/Vancouver', 'Vancouver'], ['America/Denver', 'Denver'], ['America/Phoenix', 'Phoenix'],
  ['America/Chicago', 'Chicago'], ['America/Mexico_City', 'Mexico City'], ['America/New_York', 'New York, Washington DC'],
  ['America/Toronto', 'Toronto'], ['America/Bogota', 'Bogotá'], ['America/Lima', 'Lima'],
  ['America/Halifax', 'Halifax'], ['America/Santiago', 'Santiago'], ['America/Sao_Paulo', 'São Paulo'],
  ['America/Argentina/Buenos_Aires|America/Buenos_Aires', 'Buenos Aires'], ['Europe/London', 'London'],
  ['Europe/Dublin', 'Dublin'], ['Europe/Lisbon', 'Lisbon'], ['Africa/Accra', 'Accra'], ['Europe/Paris', 'Paris'],
  ['Europe/Berlin', 'Berlin'], ['Europe/Madrid', 'Madrid'], ['Africa/Lagos', 'Lagos'],
  ['Africa/Johannesburg', 'Johannesburg'], ['Africa/Cairo', 'Cairo'], ['Europe/Athens', 'Athens'],
  ['Europe/Kyiv|Europe/Kiev', 'Kyiv'], ['Africa/Nairobi', 'Nairobi'], ['Africa/Addis_Ababa', 'Addis Ababa'],
  ['Europe/Istanbul', 'Istanbul'], ['Asia/Riyadh', 'Riyadh'], ['Europe/Moscow', 'Moscow'], ['Asia/Tehran', 'Tehran'],
  ['Asia/Dubai', 'Dubai'], ['Asia/Karachi', 'Karachi'], ['Asia/Kolkata|Asia/Calcutta', 'Delhi, Mumbai'],
  ['Asia/Kathmandu|Asia/Katmandu', 'Kathmandu'], ['Asia/Dhaka', 'Dhaka'], ['Asia/Bangkok', 'Bangkok'],
  ['Asia/Jakarta', 'Jakarta'], ['Asia/Shanghai', 'Beijing'], ['Asia/Singapore', 'Singapore'], ['Asia/Hong_Kong', 'Hong Kong'],
  ['Australia/Perth', 'Perth'], ['Asia/Tokyo', 'Tokyo'], ['Asia/Seoul', 'Seoul'], ['Australia/Darwin', 'Darwin'],
  ['Australia/Adelaide', 'Adelaide'], ['Australia/Brisbane', 'Brisbane'], ['Australia/Sydney', 'Sydney'],
  ['Australia/Melbourne', 'Melbourne'], ['Pacific/Auckland', 'Auckland'],
];
// Names people use for some time zones. An option leads with one when any of its places has one.
const ZONE_NAMES = new Map(Object.entries({
  'Pacific/Honolulu': 'Hawaii', 'America/Anchorage': 'Alaska', 'America/Los_Angeles': 'Pacific Time', 'America/Vancouver': 'Pacific Time',
  'America/Denver': 'Mountain Time', 'America/Phoenix': 'Arizona', 'America/Chicago': 'Central Time', 'America/Mexico_City': 'Central Time',
  'America/New_York': 'Eastern Time', 'America/Toronto': 'Eastern Time', 'America/Halifax': 'Atlantic Time',
  'Europe/Paris': 'Central European Time', 'Europe/Berlin': 'Central European Time', 'Europe/Madrid': 'Central European Time',
  'Europe/Athens': 'Eastern European Time', 'Europe/Kyiv': 'Eastern European Time', 'Europe/Kiev': 'Eastern European Time',
  'Asia/Kolkata': 'India', 'Asia/Calcutta': 'India', 'Australia/Perth': 'Western Australia', 'Australia/Adelaide': 'South Australia',
  'Australia/Darwin': 'Northern Territory', 'Australia/Sydney': 'Eastern Australia', 'Australia/Melbourne': 'Eastern Australia',
  'Australia/Brisbane': 'Queensland', 'Pacific/Auckland': 'New Zealand',
}));
// "Pacific Time · San Francisco, Los Angeles, Vancouver (UTC-8)": a name where people use one, places, then the offset now.
// The name comes from the best-known place, and only if no other place in the option has a different one.
function zoneLabel(zones, cities, minutes) {
  const first = ZONE_NAMES.get(zones[0]);
  const name = first && zones.every((z) => !ZONE_NAMES.has(z) || ZONE_NAMES.get(z) === first) ? first : '';
  const places = cities.flatMap((c) => c.split(', ')).slice(0, 3).join(', ');
  return `${name ? `${name} · ` : ''}${places} (${fmtOffset(minutes)})`;
}
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
// labelled with places people know (and a name like "Pacific Time" where people use one). The visitor's own zone is
// always there, however unusual. Zones that change their clocks inside the bookable dates get their own option.
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
      label: zoneLabel(known, names, g.offs[0]),
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
    label: zoneLabel(g.zones, g.cities, offsetAt(g.zones[0], now)),
  }));
  if (!groups.has(selectedKey) && offsetAt(selected, now) !== null) {
    options.push({ value: selected, minutes: offsetAt(selected, now), label: zoneLabel([selected], [cityOf(selected)], offsetAt(selected, now)) });
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

// ---------- Working hours as a week you colour in ----------
// Each day is a column. You drag down a day to colour in when you work (drag across days to do several at once, and
// drag over coloured time to rub it out). With `pref` ({ hours, first }), a second mode colours in preferred times,
// which sit inside working hours and are shown first on booking pages. Steps snap to 15 minutes; holding still before
// dragging switches to 5, then 1. A day can have several windows (a lunch break, say).
const WG_PX = 36; // pixels per hour
const WG_FINE_ZOOM = 2.5; // 5-minute steps show the grid this much taller
const toMin = (hm) => {
  const [h, m] = String(hm || '0:0').split(':').map(Number);
  return h * 60 + (m || 0);
};
const toHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const winsOf = (v) => (!Array.isArray(v) || !v.length ? [] : typeof v[0] === 'string' ? [[v[0], v[1]]] : v);

function hoursToState(hours) {
  const h = perDay(hours);
  return Object.fromEntries(DAY_KEYS.map(([d]) => [d, h ? winsOf(h[d]).map(([a, b]) => [toMin(a), toMin(b)]).filter(([a, b]) => b > a) : []]));
}
function stateToHours(st) {
  const out = Object.fromEntries(DAY_KEYS.map(([d]) => [d, st[d].length ? st[d].map(([a, b]) => [toHM(a), toHM(b)]) : null]));
  return Object.values(out).some(Boolean) ? out : null;
}
// Lists of [from, to] minutes, kept sorted and non-overlapping.
function addRange(list, a, b) {
  const all = [...list, [a, b]].sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [s, e] of all) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
const cutRange = (list, a, b) => list.flatMap(([s, e]) => [[s, Math.min(e, a)], [Math.max(s, b), e]]).filter(([s, e]) => e > s);
const clipTo = (list, within) => list.flatMap(([s, e]) => within.map(([ws, we]) => [Math.max(s, ws), Math.min(e, we)])).filter(([s, e]) => e > s);
const hasAny = (layer) => Boolean(layer && DAY_KEYS.some(([d]) => layer[d].length));

function hoursForm(hours, timezone, travel = [], pref = null) {
  const st = {
    work: hoursToState(hours || DEFAULT_WEEK),
    pref: pref ? hoursToState(pref.hours) : null,
    first: pref ? Boolean(pref.first || !pref.hours) : false,
    firstOption: Boolean(pref) && pref.firstOption !== false, // only on your own settings
    mode: 'work',
  };
  return `<div class="hours-mini">
      <div class="weekgrid" data-wg="${esc(JSON.stringify(st))}">${gridInner(st)}</div>
      <label class="field">Time zone <select class="input" data-htz>${timeZoneOptions(timezone || browserZone)}</select></label>
      <div class="trips">
        <span class="label">Travelling</span>
        <p class="hint">On these dates the same hours apply in the time zone you'll be in. Nothing else to change.</p>
        <div data-trips>${(travel || []).map(tripRow).join('')}</div>
        <button type="button" class="btn sm" data-add-trip>Add a trip</button>
      </div>
    </div>`;
}

function gridInner(st) {
  const prefMode = Boolean(st.pref) && st.mode === 'pref';
  const yellow = Boolean(st.pref) && (hasAny(st.pref) || prefMode);
  const zoom = st.fine ? WG_FINE_ZOOM : 1;
  const px = WG_PX * zoom;
  const general = st.pref ? 'general hours' : 'hours';
  const block = (cls, a, b, label) => {
    const h = ((b - a) / 60) * px;
    return `<div class="${cls}" style="top:${(a / 60) * px}px;height:${h}px">${label && h >= 18 ? `<span>${toHM(a)}–<wbr>${toHM(b)}</span>` : ''}</div>`;
  };
  // The weekday Copy buttons pulse now and then, one after another, until someone has used one.
  const heads = DAY_KEYS.map(([d, short, full], i) => `<div class="wg-head"><span>${short}</span>${st.work[d].length
    ? `<button type="button" class="wg-copy${!st.copied && i < 5 ? ' pulse' : ''}" style="animation-delay:${i * 0.18}s" data-wg-copy="${d}" title="Copy ${full} to other days" aria-label="Copy ${full} to other days">Copy</button>` : ''}</div>`).join('');
  const cols = DAY_KEYS.map(([d]) => `<div class="wg-body" data-day="${d}" style="height:${24 * px}px">
      ${st.work[d].map(([a, b]) => block(`wg-work${yellow ? ' extra' : ''}`, a, b, !prefMode)).join('')}
      ${st.pref ? st.pref[d].map(([a, b]) => block('wg-pref', a, b, true)).join('') : ''}
    </div>`).join('');
  // Hour labels; zoomed in, quarter hours too.
  const marks = zoom > 1 ? Array.from({ length: 96 }, (_, q) => q * 15) : Array.from({ length: 24 }, (_, h) => h * 60);
  const axis = marks.map((m) => `<span class="${m % 60 ? 'q' : ''}" style="top:${(m / 60) * px}px">${toHM(m)}</span>`).join('');
  const copy = st.copyFrom ? copyBar(st) : '';
  const help = prefMode
    ? 'Colour in or rub out your preferred times. You can drag across several days.'
    : 'Colour in or rub out your availability. You can drag across several days.';
  // Typing is the other way in: it swaps the grid for a row of boxes per day.
  const typed = `<div class="wg-typed">
      <div class="wg-type-row wg-type-head${st.pref ? '' : ' one'}"><span></span><span>${st.pref ? 'General' : 'Hours'}</span>${st.pref ? '<span>Preferred</span>' : ''}</div>
      ${DAY_KEYS.map(([d, , full]) => `<div class="wg-type-row${st.pref ? '' : ' one'}"><span>${full}</span>
        <input type="text" data-wg-type="work:${d}" value="${esc(st.work[d].map(([a, b]) => `${toHM(a)}–${toHM(b)}`).join(', '))}" aria-label="${full} ${general}">
        ${st.pref ? `<input type="text" data-wg-type="pref:${d}" value="${esc(st.pref[d].map(([a, b]) => `${toHM(a)}–${toHM(b)}`).join(', '))}" aria-label="${full} preferred times">` : ''}</div>`).join('')}
    </div>`;
  const toggle = `<button type="button" class="linkish wg-type-toggle" data-wg-typing>${st.typing ? 'Colour them in instead' : 'Type the times instead'}</button>`;
  return `
    ${st.typing ? '' : `<div class="wg-toolbar">
      ${st.pref ? `<div class="seg wg-modes" role="radiogroup" aria-label="What to colour in">
        <label><input type="radio" name="wg-mode" value="work"${prefMode ? '' : ' checked'}><span>Choose General Hours</span></label>
        <label><input type="radio" name="wg-mode" value="pref"${prefMode ? ' checked' : ''}><span>Choose Preferred Times</span></label>
      </div>` : '<span></span>'}
      <div class="wg-snap"><span>Snap to</span><div class="seg" role="radiogroup" aria-label="Snap to">
        <label><input type="radio" name="wg-snap" value="15"${st.fine ? '' : ' checked'}><span>15 min</span></label>
        <label><input type="radio" name="wg-snap" value="5"${st.fine ? ' checked' : ''}><span>5 min</span></label>
      </div></div>
    </div>`}
    <p class="hint wg-help">${st.typing ? 'Type your times, like 09:00–12:00, 13:00–17:30. Leave a day empty for none.' : help} ${toggle}</p>
    ${st.typing ? typed : `${copy}
    <div class="wg-frame">
      <div class="wg-heads"><span></span>${heads}</div>
      <div class="wg-scroll"><div class="wg-grid${zoom > 1 ? ' zoom' : ''}" style="--px:${px}px"><div class="wg-axis" style="height:${24 * px}px">${axis}</div>${cols}</div></div>
    </div>
    <div class="wg-under">
      <div>${hasAny(st.work) ? '' : `<p class="wg-summary"><strong>No ${general} yet.</strong> Colour some in.</p>`}
        ${st.pref ? `<p class="wg-key">${yellow ? '<span class="swatch green"></span>Preferred <span class="swatch yellow"></span>Other general hours' : '<span class="swatch green"></span>General hours'}</p>` : ''}</div>
      <button type="button" class="linkish" data-wg-clear>${prefMode ? 'Clear preferred times' : 'Clear all'}</button>
    </div>`}
    ${st.pref && hasAny(st.pref) && st.firstOption ? `<label class="check wg-first"><input type="checkbox" data-wg-first${st.first ? ' checked' : ''}> <span>Show preferred times first on my booking pages
      <span class="hint">People see them first, with the rest of your free time a click away in yellow. You can change this for a single page.</span></span></label>` : ''}`;
}
// A small, read-only picture of someone's week, coloured like the grid: general hours (yellow when there are
// preferred times, else green) with preferred times in green.
function weekMini(hours, preferred) {
  const w = hoursToState(hours || DEFAULT_WEEK);
  const p = preferred ? clipTo2(hoursToState(preferred), w) : null;
  const all = DAY_KEYS.flatMap(([d]) => w[d]);
  if (!all.length) return '';
  const lo = Math.floor(Math.min(...all.map((x) => x[0])) / 60) * 60;
  const hi = Math.ceil(Math.max(...all.map((x) => x[1])) / 60) * 60;
  const pct = (m) => ((m - lo) / (hi - lo)) * 100;
  const yellow = hasAny(p);
  const blocks = (list, cls) => list.map(([a, b]) => `<span class="${cls}" style="top:${pct(a)}%;height:${pct(b) - pct(a)}%"></span>`).join('');
  const cols = DAY_KEYS.map(([d, short]) => `<div class="wk-day${w[d].length ? '' : ' off'}">
      <div class="wk-track">${blocks(w[d], yellow ? 'wk-work extra' : 'wk-work')}${p ? blocks(p[d], 'wk-pref') : ''}</div>
      <span class="wk-label">${short}</span></div>`).join('');
  const step = hi - lo > 600 ? 180 : 120;
  const ticks = [];
  for (let m = lo; m <= hi; m += step) ticks.push(`<span style="top:${pct(m)}%">${toHM(m)}</span>`);
  return `<div class="wk-mini"><div class="wk-axis">${ticks.join('')}</div><div class="wk-days">${cols}</div></div>`;
}

// Preferred times only count inside working hours, day by day.
function clipTo2(pref, work) {
  return Object.fromEntries(DAY_KEYS.map(([d]) => [d, clipTo(pref[d], work[d])]));
}

function copyBar(st) {
  const name = DAY_KEYS.find(([d]) => d === st.copyFrom)[2];
  return `<div class="wg-copybar"><span>Copy ${name}'s hours to</span>
    ${DAY_KEYS.filter(([d]) => d !== st.copyFrom).map(([d, short]) => `<button type="button" class="chipbtn${st.copyTo.includes(d) ? ' on' : ''}" data-wg-copyday="${d}" aria-pressed="${st.copyTo.includes(d)}">${short}</button>`).join('')}
    <button type="button" class="btn sm green" data-wg-copy-go${st.copyTo.length ? '' : ' disabled'}>Copy</button>
    <button type="button" class="wg-x" data-wg-copy-cancel aria-label="Close" title="Close">×</button></div>`;
}
const weekdaysBut = (d) => ['mon', 'tue', 'wed', 'thu', 'fri'].includes(d)
  ? ['mon', 'tue', 'wed', 'thu', 'fri'].filter((x) => x !== d)
  : DAY_KEYS.map(([x]) => x).filter((x) => x !== d);

const wgState = (root) => JSON.parse(root.dataset.wg);
function wgRender(root, st) {
  const sc = root.querySelector('.wg-scroll');
  const top = sc ? sc.scrollTop : null;
  root.dataset.wg = JSON.stringify(st);
  root.innerHTML = gridInner(st);
  if (top != null && root.querySelector('.wg-scroll')) root.querySelector('.wg-scroll').scrollTop = top;
  else wgScrollToStart(root, st); // the grid is back after typing
}

// Reads the hours form back. Preferred times only come back when the form has them (your own settings).
function readHoursForm(el) {
  const root = el.querySelector('.weekgrid');
  const st = wgState(root);
  const travel = [...el.querySelectorAll('[data-trip]')]
    .map((row) => ({ from: row.querySelector('[data-tfrom]').value, to: row.querySelector('[data-tto]').value || row.querySelector('[data-tfrom]').value, timezone: row.querySelector('[data-ttz]').value }))
    .filter((t) => t.from);
  const out = { hours: stateToHours(st.work), timezone: el.querySelector('[data-htz]').value, travel };
  if (st.pref) {
    out.preferredHours = stateToHours(clipTo2(st.pref, st.work));
    if (st.firstOption) out.preferFirst = Boolean(out.preferredHours && st.first);
  }
  return out;
}

// "Mon–Thu 09:00–17:30, Fri 09:00–15:00 (London)"
function describeHours(hours, timezone) {
  const h = perDay(hours);
  if (!h) return '';
  const groups = [];
  DAY_KEYS.forEach(([d, short], i) => {
    const key = winsOf(h[d]).map((w) => w.join('–')).join(' and ');
    if (!key) return;
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

// ---------- The week grid: drawing, copying, typing ----------
let wgDrag = null;
function wgMinuteAt(body, y, px = WG_PX) {
  return Math.max(0, Math.min(1440, ((y - body.getBoundingClientRect().top) / px) * 60));
}

function wgDayAt(root, x) {
  const bodies = [...root.querySelectorAll('.wg-body')];
  let best = 0;
  bodies.forEach((b, i) => {
    const r = b.getBoundingClientRect();
    if (x >= r.left) best = i;
  });
  return best;
}
function wgRange(drag) {
  const step = drag.step;
  const lo = Math.min(drag.startMin, drag.curMin);
  const hi = Math.max(drag.startMin, drag.curMin);
  const a = Math.floor(lo / step) * step;
  const b = Math.min(1440, Math.ceil(hi / step) * step);
  const d1 = Math.min(drag.startDay, drag.curDay);
  const d2 = Math.max(drag.startDay, drag.curDay);
  return { a, b: b > a ? b : a + step, days: DAY_KEYS.slice(d1, d2 + 1).map(([d]) => d) };
}
function wgPreview(drag) {
  drag.root.querySelectorAll('.wg-ghost').forEach((g) => g.remove());
  if (!drag.moved) return;
  const { a, b, days } = wgRange(drag);
  const bodies = [...drag.root.querySelectorAll('.wg-body')];
  const shorts = DAY_KEYS.filter(([d]) => days.includes(d)).map(([, s]) => s);
  const label = `${drag.erase ? 'Rub out ' : ''}${shorts.length > 1 ? `${shorts[0]}–${shorts[shorts.length - 1]} ` : ''}${toHM(a)}–${toHM(b)}`;
  days.forEach((d, i) => {
    const body = bodies[DAY_KEYS.findIndex(([x]) => x === d)];
    body.insertAdjacentHTML('beforeend', `<div class="wg-ghost${drag.erase ? ' erase' : ''}${drag.layer === 'pref' ? ' pref' : ''}" style="top:${(a / 60) * drag.px}px;height:${((b - a) / 60) * drag.px}px">${i === 0 ? `<span>${label}</span>` : ''}</div>`);
  });
}


document.addEventListener('pointerdown', (e) => {
  const body = e.target.closest('.wg-body');
  if (!body || e.button !== 0) return;
  e.preventDefault();
  const root = body.closest('.weekgrid');
  const st = wgState(root);
  const layer = st.pref && st.mode === 'pref' ? 'pref' : 'work';
  const px = WG_PX * (st.fine ? WG_FINE_ZOOM : 1);
  const min = wgMinuteAt(body, e.clientY, px);
  const day = DAY_KEYS.findIndex(([d]) => d === body.dataset.day);
  const erase = st[layer][body.dataset.day].some(([s, en]) => min >= s && min < en);
  wgDrag = { root, st, layer, erase, body, startDay: day, curDay: day, startMin: min, curMin: min, step: st.fine ? 5 : 15, px, moved: false, x: e.clientX, y: e.clientY, timers: [] };
  root.setPointerCapture?.(e.pointerId);
});
document.addEventListener('pointermove', (e) => {
  const drag = wgDrag;
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
    drag.moved = true;
    drag.timers.forEach(clearTimeout);
  }
  drag.curMin = wgMinuteAt(drag.body, e.clientY, drag.px);
  drag.curDay = wgDayAt(drag.root, e.clientX);
  wgPreview(drag);
});
function wgEnd() {
  const drag = wgDrag;
  if (!drag) return;
  wgDrag = null;
  drag.timers.forEach(clearTimeout);
  drag.root.querySelectorAll('.wg-ghost').forEach((g) => g.remove());
  const st = drag.st;
  if (!drag.moved) return wgRender(drag.root, st);
  const { a, b, days } = wgRange(drag);
  for (const d of days) {
    if (drag.layer === 'work') {
      st.work[d] = drag.erase ? cutRange(st.work[d], a, b) : addRange(st.work[d], a, b);
      if (st.pref) st.pref[d] = clipTo(st.pref[d], st.work[d]);
    } else if (drag.erase) {
      st.pref[d] = cutRange(st.pref[d], a, b);
    } else {
      // Preferred times always sit inside general hours: colouring outside them stretches the general hours too.
      st.pref[d] = addRange(st.pref[d], a, b);
      st.work[d] = addRange(st.work[d], a, b);
    }
  }
  wgRender(drag.root, st);
}
document.addEventListener('pointerup', wgEnd);
document.addEventListener('pointercancel', wgEnd);

document.addEventListener('click', (e) => {
  const root = e.target.closest('.weekgrid');
  if (!root) return;
  const t = e.target.closest('button');
  if (!t) return;
  const st = wgState(root);
  if (t.dataset.wgCopy) {
    st.copyFrom = t.dataset.wgCopy;
    st.copyTo = weekdaysBut(st.copyFrom);
  } else if (t.dataset.wgCopyday) {
    const d = t.dataset.wgCopyday;
    st.copyTo = st.copyTo.includes(d) ? st.copyTo.filter((x) => x !== d) : [...st.copyTo, d];
  } else if ('wgCopyGo' in t.dataset) {
    for (const d of st.copyTo) {
      st.work[d] = st.work[st.copyFrom].map((w) => [...w]);
      if (st.pref) st.pref[d] = st.pref[st.copyFrom].map((w) => [...w]);
    }
    delete st.copyFrom;
    st.copied = true;
  } else if ('wgTyping' in t.dataset) {
    st.typing = !st.typing;
    delete st.copyFrom;
  } else if ('wgCopyCancel' in t.dataset) {
    delete st.copyFrom;
  } else if ('wgClear' in t.dataset) {
    for (const [d] of DAY_KEYS) {
      if (st.pref && st.mode === 'pref') st.pref[d] = [];
      else {
        st.work[d] = [];
        if (st.pref) st.pref[d] = [];
      }
    }
    delete st.copyFrom;
  } else return;
  wgRender(root, st);
});

// Typed times: "09:00–12:00, 13:00–17:30" (a plain hyphen works too).
function parseWindows(text) {
  const out = [];
  for (const part of String(text).split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d{1,2})(?::?(\d{2}))?\s*[–—-]\s*(\d{1,2})(?::?(\d{2}))?$/);
    if (!m) return null;
    const a = Number(m[1]) * 60 + Number(m[2] || 0);
    const b = Number(m[3]) * 60 + Number(m[4] || 0);
    if (!(b > a) || b > 1440) return null;
    out.push([a, b]);
  }
  return out.reduce((list, [a, b]) => addRange(list, a, b), []);
}
document.addEventListener('change', (e) => {
  const root = e.target.closest?.('.weekgrid');
  if (!root) return;
  const st = wgState(root);
  if (e.target.name === 'wg-mode') {
    st.mode = e.target.value;
    delete st.copyFrom;
  } else if (e.target.name === 'wg-snap') {
    const sc = root.querySelector('.wg-scroll');
    const pxOld = WG_PX * (st.fine ? WG_FINE_ZOOM : 1);
    const mid = ((sc.scrollTop + sc.clientHeight / 2) / pxOld) * 60;
    st.fine = e.target.value === '5';
    wgRender(root, st);
    const sc2 = root.querySelector('.wg-scroll');
    sc2.scrollTop = (mid / 60) * WG_PX * (st.fine ? WG_FINE_ZOOM : 1) - sc2.clientHeight / 2;
    return;
  } else if ('wgFirst' in e.target.dataset) {
    st.first = e.target.checked;
  } else if (e.target.dataset.wgType) {
    const [layer, d] = e.target.dataset.wgType.split(':');
    const list = parseWindows(e.target.value);
    if (!list) {
      e.target.classList.add('bad');
      return;
    }
    st[layer][d] = list;
    if (layer === 'pref') st.work[d] = list.reduce((acc, [x, y]) => addRange(acc, x, y), st.work[d]);
    else if (st.pref) st.pref[d] = clipTo(st.pref[d], st.work[d]);
  } else return;
  wgRender(root, st);
});

// Scrolls the grid to an hour before the earliest working time.
function wgScrollToStart(root, st) {
  const sc = root.querySelector('.wg-scroll');
  if (!sc) return;
  const starts = DAY_KEYS.flatMap(([d]) => st.work[d].map((w) => w[0]));
  sc.scrollTop = Math.max(0, (((starts.length ? Math.min(...starts) : 480) - 60) / 60) * WG_PX * (st.fine ? WG_FINE_ZOOM : 1));
}
// When a grid appears, scroll it to an hour before the earliest working time.
new MutationObserver(() => {
  for (const root of document.querySelectorAll('.weekgrid:not([data-ready])')) {
    root.dataset.ready = '1';
    wgScrollToStart(root, wgState(root));
  }
}).observe(document.documentElement, { childList: true, subtree: true });
