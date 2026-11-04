// The booking page: <base>/<page-name>#<minutes>, e.g. /interviews#75 books a 75-minute slot.
(() => {
  const view = document.getElementById('view');
  const S = {
    slug: decodeURIComponent(location.pathname.slice(BASE.length)).replace(/^\/+|\/+$/g, '').split('/')[0].toLowerCase(),
    page: null,
    duration: 25,
    slots: [],
    byDay: new Map(),
    tz: '',
    month: '',
    day: '',
    start: null,
    step: 'pick', // pick → form → done
    loading: true,
    error: '',
    notice: '',
    formError: '',
    values: {},
    result: null,
  };

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
    for (const t of S.slots) {
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
    if (p.error === 'not_found') return p.home ? landing() : missing();
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
    if (r.duration) S.duration = r.duration;
    group();
    render();
  }

  // ---------- Views ----------

  function header() {
    const p = S.page;
    const chips = [
      `<span class="chip yellow">${esc(fmtDuration(S.duration))}</span>`,
      p.with.length ? `<span class="chip blue">with ${esc(joinNames(p.with))}</span>` : '',
      p.location ? `<span class="chip green">${esc(p.location)}</span>` : '',
    ].join('');
    return `
      ${p.demo ? '<p class="notice small">This is a demo with made-up people and calendars. Nothing gets booked.</p>' : ''}
      <h1>${esc(p.title)}</h1>
      <div class="chips">${chips}</div>
      ${p.description ? `<p class="lede">${esc(p.description)}</p>` : ''}`;
  }

  function tzRow() {
    return `<div class="tz"><label for="tz">Times shown in</label><select id="tz">${timeZoneOptions(S.tz)}</select></div>`;
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
      const cls = ['day', S.byDay.has(k) && 'free', k === S.day && 'on', k === today && 'today'].filter(Boolean).join(' ');
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

  function times() {
    const list = S.byDay.get(S.day) || [];
    if (!list.length) return '<h3 class="muted">Pick a green day</h3>';
    return `<h3>${esc(fmtDay(list[0], S.tz))}</h3>
      <div class="slot-list">${list.map((t) => `<button type="button" class="btn" data-slot="${t}">${esc(fmtTime(t, S.tz))}</button>`).join('')}</div>`;
  }

  function picker() {
    const notice = S.notice ? `<p class="error">${esc(S.notice)}</p>` : '';
    if (S.loading) return `<div class="picker one"><p class="loading">Finding times when everyone's free</p></div>`;
    if (S.error === 'not_ready') return `<div class="picker one"><div class="empty">This page isn't taking bookings right now. Please get in touch another way.</div></div>`;
    if (S.error) return `<div class="picker one"><div class="empty">Couldn't load the free times. Please refresh to try again.</div></div>`;
    if (!S.byDay.size) {
      const shorter = S.duration > S.page.defaultDuration ? ` for a ${fmtDuration(S.duration)} meeting` : '';
      return `<div class="picker one"><div class="empty">No free times in the coming weeks${esc(shorter)}. Please get in touch another way.</div></div>${tzRow()}`;
    }
    return `${notice}<div class="picker"><div>${calendar()}</div><div class="times">${times()}</div></div>${tzRow()}`;
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
            <span class="hint">What would you like to cover?</span>
            <textarea name="purpose" maxlength="2000" required>${esc(v.purpose)}</textarea></label>
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
    else view.innerHTML = header() + (S.step === 'form' ? form() : picker());
  }

  function landing() {
    document.title = 'Overlap';
    view.innerHTML = `
      <h1>Overlap</h1>
      <p class="lede">A free, open-source scheduler that only offers times when everyone who needs to be there is free.</p>
      <div class="chips">
        <a class="btn green" href="${BASE}/demo">Try the demo</a>
        <a class="btn blue" href="https://github.com/Aidan-Alexander/overlap">See the code</a>
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
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.day) {
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
    } else if ('back' in el.dataset) {
      S.step = 'pick';
      render();
    }
  });

  view.addEventListener('change', (e) => {
    if (e.target.id !== 'tz') return;
    S.tz = e.target.value;
    local.set('overlap.tz', S.tz);
    group();
    render();
  });

  view.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formEl = e.target;
    const v = Object.fromEntries(new FormData(formEl));
    S.values = v;
    const problem = !v.name.trim()
      ? 'Please add your name.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())
        ? 'Please check your email address.'
        : !v.purpose.trim()
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

  boot();
})();
