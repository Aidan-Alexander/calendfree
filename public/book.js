// The booking page: <base>/<page-name>#<minutes>, e.g. /interviews#75 books a 75-minute slot.
(() => {
  const view = document.getElementById('view');
  const S = {
    slug: '',
    page: null,
    duration: 25,
    slots: [],
    byDay: new Map(),
    tz: '',
    month: '',
    day: '',
    start: null,
    step: 'pick', // pick → form → done, or pick → ask → asked ("can't find a time?")
    loading: true,
    error: '',
    notice: '',
    formError: '',
    askError: '',
    askResult: null,
    values: {},
    result: null,
    preferred: new Set(), // start times someone on the page prefers
    most: new Set(), // start times everyone on the page prefers
    showAll: false,
    pick: null, // the start chosen in the day view
  };

  S.slug = decodeURIComponent(location.pathname.slice(BASE.length)).replace(/^\/+|\/+$/g, '').split('/')[0].toLowerCase();

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const validTz = (tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  };
  S.tz = validTz(local.get('overlap.tz')) ? local.get('overlap.tz') : browserTz;

  // #75, #75m, #75min, #1h, #1h30, #1.5h
  function hashMinutes() {
    const h = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
    let m = h.match(/^(\d{1,3})\s*(m|min|mins|minutes)?$/);
    if (m) return Number(m[1]);
    m = h.match(/^(\d+(?:\.\d+)?)\s*h(?:r|rs|ours?)?\s*(\d{1,2})?\s*(m|min|mins)?$/);
    if (m) return Math.round(Number(m[1]) * 60 + Number(m[2] || 0));
    return null;
  }
  const wantedDuration = () => Math.max(5, Math.min(S.page.maxDuration, hashMinutes() ?? S.page.defaultDuration));

  const keyFormat = () => new Intl.DateTimeFormat('en-CA', { timeZone: S.tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const pad = (n) => String(n).padStart(2, '0');

  function group() {
    const f = keyFormat();
    S.byDay = new Map();
    // Preferred times first, when the page has some free but not all of them are preferred.
    const narrowed = !S.showAll && S.preferred.size > 0 && S.preferred.size < S.slots.length;
    for (const t of narrowed ? S.slots.filter((x) => S.preferred.has(x)) : S.slots) {
      const k = f.format(new Date(t));
      if (!S.byDay.has(k)) S.byDay.set(k, []);
      S.byDay.get(k).push(t);
    }
    if (!S.byDay.has(S.day)) S.day = S.byDay.keys().next().value || '';
    S.month = S.day ? S.day.slice(0, 7) : '';
  }

  async function boot() {
    const p = await api(`/api/public/page?slug=${encodeURIComponent(S.slug)}`);
    document.getElementById('boot').remove();
    if (p.error === 'not_found') return p.home ? landing(p) : missing();
    if (p._status !== 200) return message('Something went wrong', 'Please refresh the page to try again.');
    S.page = p;
    document.title = p.title;
    S.duration = wantedDuration();
    window.addEventListener('hashchange', () => {
      if (S.step === 'done') return;
      const d = wantedDuration();
      if (d !== S.duration) {
        S.duration = d;
        S.step = 'pick';
        loadSlots();
      }
    });
    await loadSlots();
  }

  async function loadSlots() {
    S.loading = true;
    S.error = '';
    render();
    const r = await api(`/api/public/slots?slug=${encodeURIComponent(S.page.slug)}&duration=${S.duration}`);
    S.loading = false;
    S.error = r.error === 'not_ready' ? 'not_ready' : r._status === 200 ? '' : 'failed';
    S.slots = r.slots || [];
    S.pick = null;
    S.preferred = new Set(r.preferred || []);
    S.most = new Set(r.most || []);
    if (r.duration) S.duration = r.duration;
    group();
    render();
  }

  // ---------- Views ----------

  function header() {
    const p = S.page;
    const chips = [
      `<span class="chip yellow">${esc(fmtDuration(S.duration))}</span>`,
      p.with.length ? `<span class="chip blue">with ${esc(p.mode === 'any' ? joinOr(p.with) : joinNames(p.with))}</span>` : '',
      p.location ? `<span class="chip green">${esc(p.location)}</span>` : '',
    ].join('');
    return `
      ${p.demo ? '<p class="notice small">This is a demo with made-up people and calendars. Nothing gets booked.</p>' : ''}
      <h1>${esc(p.title)}</h1>
      <div class="chips">${chips}</div>
      ${p.description ? `<p class="lede">${esc(p.description)}</p>` : ''}
      ${lengthPicker()}`;
  }

  // Lengths the guest can choose between, when the page offers them.
  function lengthPicker() {
    const options = S.page.durations || [];
    if (options.length < 2 || S.step !== 'pick') return '';
    const all = options.includes(S.duration) ? options : [...options, S.duration].sort((a, b) => a - b);
    return `<div class="lengths-pick"><span class="label">How long?</span>${all.map((n) =>
      `<button type="button" class="btn sm${n === S.duration ? ' on' : ''}" data-len="${n}" aria-pressed="${n === S.duration}">${esc(fmtDuration(n))}</button>`).join('')}</div>`;
  }

  function tzRow() {
    return `<div class="tz"><label for="tz">Times shown in</label><select id="tz">${timeZoneOptions(S.tz, { until: S.slots[S.slots.length - 1] || Date.now() + 30 * 86_400_000 })}</select></div>`;
  }

  function calendar() {
    const [y, m] = S.month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const keys = [...S.byDay.keys()];
    const today = keyFormat().format(new Date());
    let cells = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<span class="dow" aria-hidden="true">${d[0]}</span>`).join('');
    cells += '<span></span>'.repeat(lead);
    const label = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    for (let d = 1; d <= days; d++) {
      const k = `${y}-${pad(m)}-${pad(d)}`;
      // With extra availability showing, a day with no preferred times at all is yellow rather than green.
      const extraDay = extraShown() && S.byDay.has(k) && !S.byDay.get(k).some((t) => S.preferred.has(t));
      const cls = ['day', S.byDay.has(k) && 'free', extraDay && 'extra', k === S.day && 'on', k === today && 'today'].filter(Boolean).join(' ');
      cells += S.byDay.has(k)
        ? `<button type="button" class="${cls}" data-day="${k}" aria-pressed="${k === S.day}" aria-label="${esc(label.format(new Date(Date.UTC(y, m - 1, d))))}">${d}</button>`
        : `<span class="${cls}">${d}</span>`;
    }
    const monthName = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
    const atStart = S.month <= keys[0].slice(0, 7);
    const atEnd = S.month >= keys[keys.length - 1].slice(0, 7);
    return `
      <div class="cal-head"><h3>${esc(monthName)}</h3>
        <div class="cal-nav">
          <button type="button" class="btn sm round" data-month="-1" aria-label="Previous month"${atStart ? ' disabled' : ''}>‹</button>
          <button type="button" class="btn sm round" data-month="1" aria-label="Next month"${atEnd ? ' disabled' : ''}>›</button>
        </div>
      </div>
      <div class="cal-grid">${cells}</div>`;
  }

  // Extra availability is showing: the page has preferred times, and the guest asked to see the rest too.
  const extraShown = () => S.showAll && S.preferred.size > 0 && S.preferred.size < S.slots.length;

  function times() {
    const list = S.byDay.get(S.day) || [];
    // Under the day: see the rest of the free times, and "can't find a time?" (a message to the page owner).
    const buttons = [
      S.preferred.size > 0 && S.preferred.size < S.slots.length
        ? `<button type="button" class="btn sm yellow" data-more>${S.showAll ? 'Show preferred times only' : 'See more availability'}</button>` : '',
      S.page.canAsk ? '<button type="button" class="btn sm" data-ask>Can\'t find a time?</button>' : '',
    ].join('');
    const more = buttons ? `<p class="more">${buttons}</p>` : '';
    // The key: most preferred (everyone prefers it), preferred (someone does), and extra availability once shown.
    const items = [
      S.most.size ? '<span class="swatch dark" aria-hidden="true"></span>Most preferred' : '',
      S.most.size || extraShown() ? '<span class="swatch green" aria-hidden="true"></span>Preferred' : '',
      extraShown() ? '<span class="swatch yellow" aria-hidden="true"></span>Extra availability' : '',
    ].filter(Boolean);
    const key = items.length ? `<p class="dv-key">${items.join(' ')}</p>` : '';
    if (!list.length) return `<h3 class="muted">Pick a day</h3>${key}${more}`;
    return `<h3>${esc(fmtDay(list[0], S.tz))}</h3>${dayView(list)}${key}${more}`;
  }

  // The chosen day as a calendar: height is time. Green bands show when a meeting can happen (nothing about
  // anyone's events). Hovering previews the meeting at the nearest allowed start; clicking picks it.
  // 72px an hour, taller for short meetings so a meeting is never less than 36px high (a 15-minute one fits its label).
  const pxPerHour = () => Math.max(72, Math.round(2160 / S.duration));
  const minutesPast = (t) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: S.tz, minute: '2-digit' }).format(new Date(t)));

  function bandsOf(starts, dur) {
    const bands = [];
    for (const t of starts) {
      const last = bands[bands.length - 1];
      if (last && t <= last.e) last.e = Math.max(last.e, t + dur);
      else bands.push({ s: t, e: t + dur });
    }
    return bands;
  }

  function dayView(list) {
    const dur = S.duration * 60_000;
    const top = list[0] - minutesPast(list[0]) * 60_000;
    const lastEnd = list[list.length - 1] + dur;
    const bottom = lastEnd + ((60 - minutesPast(lastEnd)) % 60) * 60_000;
    const px = pxPerHour();
    const y = (t) => ((t - top) / 3_600_000) * px;
    const range = (t) => `${fmtTime(t, S.tz)} – ${fmtTime(t + dur, S.tz)}`;
    const parts = [];
    for (let h = top; h <= bottom; h += 3_600_000) {
      parts.push(`<div class="dv-hour" style="top:${y(h)}px"><span>${esc(fmtTime(h, S.tz))}</span></div>`);
      // On the taller scale, a faint half-hour line helps place short meetings.
      if (px >= 120 && h < bottom) parts.push(`<div class="dv-hour dv-half" style="top:${y(h + 1_800_000)}px"></div>`);
    }
    // A band with room for several starts invites you to choose; a band with just one shows that slot.
    const pick = list.includes(S.pick) ? S.pick : null;
    const touch = matchMedia('(hover: none)').matches;
    for (const b of bandsOf(list, dur)) {
      const starts = list.filter((t) => t >= b.s && t + dur <= b.e);
      const text = starts.length > 1 ? (touch ? 'Tap to choose a slot' : 'Hover to choose a slot') : range(starts[0]);
      const picked = pick != null && pick >= b.s && pick < b.e;
      // Each stretch of a band takes the colour of the start time you'd get there: dark green if everyone prefers it,
      // green if someone does, yellow if it's extra availability.
      const runs = (keep) => {
        const out = [];
        starts.forEach((s, i) => {
          if (!keep(s)) return;
          const e = starts[i + 1] ?? b.e;
          const last = out[out.length - 1];
          if (last && last.e === s) last.e = e;
          else out.push({ s, e });
        });
        return out;
      };
      const shade = (cls, list) => list.map((r) => `<span class="${cls}" style="top:${y(r.s) - y(b.s)}px;height:${y(r.e) - y(r.s)}px"></span>`).join('');
      const shading = (extraShown() ? shade('dv-extra', runs((s) => !S.preferred.has(s))) : '')
        + (S.most.size ? shade('dv-extra dv-most', runs((s) => S.most.has(s))) : '');
      parts.push(`<div class="dv-band${picked ? ' has-pick' : ''}" style="top:${y(b.s)}px;height:${y(b.e) - y(b.s)}px">${shading}<span class="dv-band-text">${esc(text)}</span></div>`);
    }
    parts.push('<div class="dv-ghost" hidden></div>');
    if (pick) parts.push(`<div class="dv-pick" style="top:${y(pick)}px;height:${y(pick + dur) - y(pick)}px">${esc(range(pick))}</div>`);
    return `
      <div class="dv-scroll"><div class="dayview" style="height:${y(bottom)}px" data-top="${top}" data-dur="${dur}" data-px="${px}" data-starts="${list.join(',')}">${parts.join('')}</div></div>
      <div class="dv-actions">${pick
        ? `<button type="button" class="btn green" data-slot="${pick}">Continue with ${esc(range(pick))}</button>`
        : ''}</div>
      <div class="sr-only"><p>Start times</p>${list.map((t) => `<button type="button" data-slot="${t}">${esc(range(t))}</button>`).join('')}</div>`;
  }

  // The allowed start under the pointer: the latest one at or before it, within the green band it's over.
  function startAt(dv, e) {
    const top = Number(dv.dataset.top);
    const dur = Number(dv.dataset.dur);
    const starts = dv.dataset.starts.split(',').map(Number);
    const t = top + ((e.clientY - dv.getBoundingClientRect().top) / Number(dv.dataset.px)) * 3_600_000;
    const band = bandsOf(starts, dur).find((b) => t >= b.s && t <= b.e);
    if (!band) return null;
    const inBand = starts.filter((s) => s >= band.s && s + dur <= band.e);
    return inBand.filter((s) => s <= t).pop() ?? inBand[0];
  }

  // "Can't find a time?": a message to the page owner, offered when it would reach them by email.
  const askButton = (label) => `<button type="button" class="linkish" data-ask>${esc(label)}</button>`;

  function picker() {
    const notice = S.notice ? `<p class="error">${esc(S.notice)}</p>` : '';
    const ask = S.page.canAsk;
    if (S.loading) return `<div class="picker one"><p class="loading">Finding times when everyone's free</p></div>`;
    if (S.error === 'not_ready') return `<div class="picker one"><div class="empty">This page isn't taking bookings right now. ${ask ? `${askButton(`Send ${S.page.ownerName} a message`)}.` : 'Please get in touch another way.'}</div></div>`;
    if (S.error) return `<div class="picker one"><div class="empty">Couldn't load the free times. Please refresh to try again.</div></div>`;
    if (!S.byDay.size) {
      const shorter = S.duration > S.page.defaultDuration ? ` for a ${fmtDuration(S.duration)} meeting` : '';
      return `<div class="picker one"><div class="empty">No free times in the coming weeks${esc(shorter)}. ${ask ? `${askButton(`Ask ${S.page.ownerName} for more options`)}.` : 'Please get in touch another way.'}</div></div>${tzRow()}`;
    }
    return `${notice}<div class="picker"><div class="cal-col">${calendar()}</div><div class="times">${times()}</div></div>${tzRow()}`;
  }

  function askForm() {
    const v = S.values;
    return `
      <div class="picker one">
        <p class="when">Can't find a time?</p>
        <p class="muted small">Tell ${esc(S.page.ownerName)} what would work for you, and you'll hear back by email. · <button type="button" class="linkish" data-back>Back to the times</button></p>
        ${S.askError ? `<p class="error">${esc(S.askError)}</p>` : ''}
        <form class="form" id="ask" novalidate>
          <label class="field">Your name
            <input type="text" name="name" autocomplete="name" maxlength="100" required value="${esc(v.name)}"></label>
          <label class="field">Your email
            <input type="email" name="email" autocomplete="email" required value="${esc(v.email)}"></label>
          <label class="field">Your message
            <span class="hint">For example: when you're trying to meet, and a link to your own scheduling page.</span>
            <textarea name="message" maxlength="2000" required>${esc(v.message)}</textarea></label>
          <div class="tz"><label for="ask-tz">Your time zone</label><select id="ask-tz" name="tz">${timeZoneOptions(S.tz, { until: S.slots[S.slots.length - 1] || Date.now() + 30 * 86_400_000 })}</select></div>
          <div class="hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
          <div><button class="btn green" type="submit">Send</button></div>
        </form>
      </div>`;
  }

  function asked() {
    const r = S.askResult;
    return `
      <div class="done-mark" aria-hidden="true">✓</div>
      <h1>${r.demo ? 'That would be sent' : 'Message sent'}</h1>
      <p>${r.demo ? "It's the demo, so nothing was sent." : `${esc(S.page.ownerName)} will get back to you at <strong>${esc(r.email)}</strong>.`}</p>
      <p class="muted small"><button type="button" class="linkish" data-back>Back to the times</button></p>`;
  }

  function form() {
    const t = S.start;
    const end = t + S.duration * 60_000;
    const v = S.values;
    return `
      <div class="picker one">
        <p class="when">${esc(fmtDay(t, S.tz))}, ${esc(fmtTime(t, S.tz))} – ${esc(fmtTime(end, S.tz))}</p>
        <p class="muted small">${esc(S.tz.replaceAll('_', ' '))} · <button type="button" class="linkish" data-back>Pick another time</button></p>
        ${S.formError ? `<p class="error">${esc(S.formError)}</p>` : ''}
        <form class="form" id="book" novalidate>
          <label class="field">Your name
            <input type="text" name="name" autocomplete="name" maxlength="100" required value="${esc(v.name)}"></label>
          <label class="field">Your email
            <input type="email" name="email" autocomplete="email" required value="${esc(v.email)}"></label>
          <label class="field">Purpose of the meeting
            <span class="hint">${S.page.requirePurpose === false ? 'Optional. ' : ''}What would you like to cover?</span>
            <textarea name="purpose" maxlength="2000"${S.page.requirePurpose === false ? '' : ' required'}>${esc(v.purpose)}</textarea></label>
          ${S.page.allowGuests ? `<label class="field">Anyone else to invite?
            <span class="hint">Optional. Email addresses, separated by commas.</span>
            <input type="text" name="guests" value="${esc(v.guests)}"></label>` : ''}
          <div class="hp" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
          <div><button class="btn green big" type="submit">Book it</button></div>
        </form>
      </div>`;
  }

  function done() {
    const r = S.result;
    const where = r.location
      ? /^https?:\/\//.test(r.location) ? `<a href="${esc(r.location)}">${esc(r.location.replace(/^https?:\/\//, ''))}</a>` : esc(r.location)
      : '';
    return `
      <div class="done-mark" aria-hidden="true">✓</div>
      <h1>${r.demo ? 'That would be booked' : "You're booked"}</h1>
      <dl class="details">
        <dt>What</dt><dd>${esc(r.title)}</dd>
        <dt>When</dt><dd>${esc(fmtDay(r.start, S.tz))}, ${esc(fmtTime(r.start, S.tz))} – ${esc(fmtTime(r.end, S.tz))}
          <span class="muted">(${esc(S.tz.replaceAll('_', ' '))})</span></dd>
        ${where ? `<dt>Where</dt><dd>${where}</dd>` : ''}
        ${r.with?.length ? `<dt>With</dt><dd>${esc(joinNames(r.with))}</dd>` : ''}
      </dl>
      <p>${r.demo ? "It's the demo, so nothing was booked and no invite went out." : `A calendar invite is on its way to <strong>${esc(r.email)}</strong>.`}</p>
      ${r.manageUrl ? `<p class="muted small">Need to change it? <a href="${esc(r.manageUrl)}">Cancel or pick a new time</a>. The link is in the invite too.</p>` : ''}`;
  }

  function render() {
    if (S.step === 'done') view.innerHTML = done();
    else if (S.step === 'asked') view.innerHTML = asked();
    else view.innerHTML = header() + (S.step === 'form' ? form() : S.step === 'ask' ? askForm() : picker());
    const scroller = view.querySelector('.dv-scroll');
    const first = view.querySelector('.dv-pick') || view.querySelector('.dv-band');
    if (scroller && first) scroller.scrollTop = Math.max(0, first.offsetTop - 40);
  }

  function landing(p = {}) {
    if (p.shared) {
      // A team copy: everyone has their own links, so the front page just points people the right way.
      const name = p.siteName ? `${p.siteName} booking pages` : 'Booking pages';
      document.title = name;
      view.innerHTML = `
        <h1>${esc(name)}</h1>
        <p class="lede">Everyone here has their own booking links. If you're booking a meeting, ask the person you're meeting for theirs.</p>
        <div class="chips"><a class="btn green" href="${BASE}/admin/">Sign in to make your own</a></div>`;
      return;
    }
    document.title = 'Calendfree';
    view.innerHTML = `
      <h1>Calendfree</h1>
      <p class="lede">A free, open-source scheduler that only offers times when everyone who needs to be there is free.</p>
      <div class="chips">
        <a class="btn green" href="${BASE}/demo">Try the demo</a>
        <a class="btn blue" href="https://github.com/Aidan-Alexander/calendfree">See the code</a>
        <a class="btn" href="${BASE}/admin/">Sign in</a>
      </div>`;
  }

  function missing() {
    message('No booking page here', "Check the link you were sent. It may have changed.");
  }

  function message(title, text) {
    view.innerHTML = `<h1>${esc(title)}</h1><p class="lede">${esc(text)}</p>`;
  }

  // ---------- Actions ----------

  view.addEventListener('click', (e) => {
    const dv = e.target.closest('.dayview');
    if (dv && !e.target.closest('button')) {
      const t = startAt(dv, e);
      if (t != null) {
        S.pick = t;
        const scroll = view.querySelector('.dv-scroll').scrollTop;
        render();
        view.querySelector('.dv-scroll').scrollTop = scroll;
      }
      return;
    }
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.day) {
      S.pick = null;
      S.day = el.dataset.day;
      S.notice = '';
      render();
      if (matchMedia('(max-width: 760px)').matches) view.querySelector('.times')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (el.dataset.month) {
      const [y, m] = S.month.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + Number(el.dataset.month), 1));
      S.month = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
      const firstThatMonth = [...S.byDay.keys()].find((k) => k.startsWith(S.month));
      if (firstThatMonth) S.day = firstThatMonth;
      render();
    } else if (el.dataset.slot) {
      S.start = Number(el.dataset.slot);
      S.step = 'form';
      S.formError = '';
      S.notice = '';
      render();
      view.querySelector('input[name=name]')?.focus();
    } else if (el.dataset.len) {
      location.hash = el.dataset.len; // the hash sets the length, so the address can be shared as is
    } else if ('more' in el.dataset) {
      S.showAll = !S.showAll;
      S.pick = null;
      group();
      render();
    } else if ('ask' in el.dataset) {
      S.step = 'ask';
      S.askError = '';
      render();
      view.querySelector(S.values.name && S.values.email ? 'textarea[name=message]' : 'input[name=name]')?.focus();
    } else if ('back' in el.dataset) {
      S.step = 'pick';
      render();
    }
  });

  // Preview the meeting under the pointer.
  view.addEventListener('pointermove', (e) => {
    const dv = e.target.closest('.dayview');
    if (!dv) return;
    const ghost = dv.querySelector('.dv-ghost');
    const t = e.target.closest('.dv-pick') ? null : startAt(dv, e);
    if (t == null) {
      ghost.hidden = true;
      return;
    }
    const top = Number(dv.dataset.top);
    const dur = Number(dv.dataset.dur);
    ghost.hidden = false;
    const px = Number(dv.dataset.px);
    ghost.style.top = `${((t - top) / 3_600_000) * px}px`;
    ghost.style.height = `${(dur / 3_600_000) * px}px`;
    ghost.textContent = `${fmtTime(t, S.tz)} – ${fmtTime(t + dur, S.tz)}`;
  });
  view.addEventListener('pointerout', (e) => {
    const dv = e.target.closest('.dayview');
    if (dv && !dv.contains(e.relatedTarget)) dv.querySelector('.dv-ghost').hidden = true;
  });

  view.addEventListener('change', (e) => {
    if (e.target.id === 'ask-tz') {
      // Choosing a zone in the message form also sets the times shown, without redrawing what they've typed.
      S.tz = e.target.value;
      local.set('overlap.tz', S.tz);
      group();
      return;
    }
    if (e.target.id !== 'tz') return;
    S.tz = e.target.value;
    local.set('overlap.tz', S.tz);
    group();
    render();
  });

  view.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id === 'ask') return sendAsk(e.target);
    const formEl = e.target;
    const v = Object.fromEntries(new FormData(formEl));
    S.values = { ...S.values, ...v };
    const problem = !v.name.trim()
      ? 'Please add your name.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())
        ? 'Please check your email address.'
        : !v.purpose.trim() && S.page.requirePurpose !== false
          ? 'Please say what the meeting is for.'
          : '';
    if (problem) {
      S.formError = problem;
      render();
      return;
    }
    const button = formEl.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'Booking';
    const r = await api('/api/public/book', {
      method: 'POST',
      body: { ...v, slug: S.page.slug, duration: S.duration, start: S.start },
    });
    if (r.ok) {
      S.result = { ...r, email: v.email.trim() };
      S.step = 'done';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (r.error === 'taken') {
      S.step = 'pick';
      await loadSlots();
      S.notice = r.message;
      render();
      return;
    }
    S.formError = r.message || 'Something went wrong. Please try again.';
    render();
  });

  // Sends the "can't find a time?" message to the page owner.
  async function sendAsk(formEl) {
    const v = Object.fromEntries(new FormData(formEl));
    S.values = { ...S.values, ...v };
    const problem = !v.name.trim()
      ? 'Please add your name.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())
        ? 'Please check your email address.'
        : !v.message.trim()
          ? 'Please add a message.'
          : '';
    if (problem) {
      S.askError = problem;
      render();
      return;
    }
    const button = formEl.querySelector('button[type=submit]');
    button.disabled = true;
    button.textContent = 'Sending';
    const r = await api('/api/public/ask', {
      method: 'POST',
      body: { ...v, slug: S.page.slug, duration: S.duration },
    });
    if (r.ok) {
      S.askResult = { ...r, email: v.email.trim() };
      S.values.message = '';
      S.step = 'asked';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    S.askError = r.message || 'Something went wrong. Please try again.';
    render();
  }

  boot();
})();
