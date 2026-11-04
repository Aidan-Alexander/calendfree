// The admin page: sign in, make and edit booking pages, see whose calendars Overlap can read.
(() => {
  const app = document.getElementById('app');
  const A = { me: null, pages: [], home: '', statuses: {}, editing: null, errors: [], flash: '' };
  const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  const appUrl = location.origin + BASE;
  const pageUrl = (slug) => `${appUrl}/${slug}`;
  const connectUrl = (slug) => `${appUrl}/connect/?p=${encodeURIComponent(slug)}`;
  const first = (name) => String(name || '').trim().split(/\s+/)[0];

  const SIGN_IN_ERRORS = {
    not_allowed: (email) => `${email} isn't on the list of people who can make booking pages. Add it to ADMIN_EMAILS in your Netlify settings, then try again.`,
    scopes: () => 'Google asked which calendar permissions to give, and one was unticked. Overlap needs both: one to check free times, one to add bookings to your calendar. Please sign in again and leave them ticked.',
    expired: () => 'That sign-in took too long. Please try again.',
    cancelled: () => 'Sign-in was cancelled.',
    no_email: () => "Google didn't share an email address. Please try again.",
    no_refresh: () => "Google didn't give Overlap lasting access. Remove Overlap at myaccount.google.com/permissions, then sign in again.",
    setup: () => "Google sign-in isn't set up yet.",
  };

  const params = new URLSearchParams(location.search);
  const signInError = params.get('error') ? (SIGN_IN_ERRORS[params.get('error')] || (() => 'Sign-in failed. Please try again.'))(params.get('email') || 'That account') : '';
  if (location.search) history.replaceState(null, '', location.pathname);

  async function boot() {
    const me = await api('/api/me');
    if (me._status === 200) {
      A.me = me;
      A.home = me.homeSlug;
      await loadPages();
    } else {
      const status = await api('/api/public/status');
      signInView(status);
    }
  }

  async function loadPages() {
    const r = await api(`/api/pages?tz=${encodeURIComponent(browserTz)}`);
    A.pages = r.pages || [];
    A.home = r.homeSlug || '';
    render();
    await Promise.all(A.pages.map((p) => loadStatus(p.slug)));
  }

  async function loadStatus(slug) {
    const r = await api(`/api/hosts?slug=${encodeURIComponent(slug)}`);
    A.statuses[slug] = r.hosts || [];
    if (!A.editing) render();
  }

  // ---------- Signed out ----------

  function signInView(status) {
    if (status.missing?.length) {
      app.innerHTML = `
        <section class="card"><span class="tape"></span>
          <h1>Almost there</h1>
          <p class="lede">Overlap needs a Google sign-in set up before it can read calendars.</p>
          <p>These settings are missing from Netlify: <strong>${status.missing.map(esc).join(', ')}</strong>.</p>
          <p>When Google asks for an "authorised redirect URI", use this:</p>
          <p class="linkrow"><code>${esc(status.redirectUri)}</code> <button class="btn sm blue" data-copy="${esc(status.redirectUri)}">Copy</button></p>
          <p class="muted">The steps are in the <a href="https://github.com/Aidan-Alexander/overlap#set-it-up">set-up guide</a>.</p>
        </section>`;
      return;
    }
    app.innerHTML = `
      <section class="card"><span class="tape"></span>
        <h1>Your booking pages</h1>
        <p class="lede">Sign in with the Google account whose calendar you book meetings from.</p>
        ${signInError ? `<p class="error">${esc(signInError)}</p>` : ''}
        <p><a class="btn green big" href="${BASE}/auth/login">Sign in with Google</a></p>
        <p class="muted small">Overlap asks to see when you're busy and to add bookings to your calendar. It never reads what your events are.</p>
      </section>`;
  }

  // ---------- Signed in ----------

  function render() {
    if (!A.me) return;
    const top = `
      <header class="topbar">
        <span class="chip yellow">Overlap</span>
        <span class="muted small grow">${esc(A.me.email)}</span>
        <a class="btn sm" href="${BASE}/auth/logout">Sign out</a>
      </header>
      ${A.me.connected ? '' : `<p class="error">Overlap can't reach your Google Calendar any more. <a href="${BASE}/auth/login?consent=1">Sign in again</a> to fix it.</p>`}
      ${A.flash ? `<p class="notice">${esc(A.flash)}</p>` : ''}`;
    if (A.editing) {
      app.innerHTML = top + editor();
      fillEditor();
      return;
    }
    app.innerHTML = `${top}
      <div class="dash-head"><h1>Your booking pages</h1><button class="btn green" data-new>New page</button></div>
      ${A.pages.map(card).join('') || '<section class="card"><p>No booking pages yet.</p></section>'}
      ${settingsCard()}`;
  }

  function hostChip(h) {
    if (!h) return '';
    const you = h.email === A.me.email;
    const name = esc(you ? `${first(h.name) || 'You'} (you)` : h.name || h.email);
    if (!h.ok) return `<span class="chip pink flat" title="Overlap can't see this calendar">! ${name}</span>`;
    const how = h.via === 'connected' ? 'Shared their calendar with Overlap' : h.via === 'shared' ? 'Visible through your Google account' : 'Your calendar';
    return `<span class="chip green flat" title="${esc(how)}">✓ ${name}</span>`;
  }

  function inviteMessage(page, host) {
    return `Hi ${first(host.name) || 'there'}, I'm using a scheduler that only offers times when we're all free. ` +
      `Could you click this link so it can see when you're busy? It only sees busy and free times, never what your meetings are, ` +
      `and you can switch it off any time: ${connectUrl(page.slug)}`;
  }

  function card(p) {
    const url = pageUrl(p.slug);
    const isHome = A.home === p.slug;
    const st = A.statuses[p.slug];
    const hostChips = st ? st.map(hostChip).join('') : p.hosts.map((h) => `<span class="chip flat muted">${esc(h.name || h.email)}…</span>`).join('');
    const lengths = [...new Set([p.defaultDuration, 25, 45, 60, 75, 90])].filter((n) => n <= p.maxDuration).sort((a, b) => a - b);
    const blocked = (st || []).filter((h) => !h.ok);
    const help = blocked.map((h) =>
      h.email === A.me.email
        ? `<p class="notice small">Overlap can't read your own calendar, so this page offers no times. <a href="${BASE}/auth/login?consent=1">Sign in again</a>.</p>`
        : `<div class="notice small"><p><strong>Overlap can't see ${esc(h.name || h.email)}'s calendar yet,</strong> so this page won't offer any times.
            Send them the opt-in link: it takes them two clicks.</p>
            <div class="chips"><button class="btn sm yellow" data-copy="${esc(inviteMessage(p, h))}">Copy a message for ${esc(first(h.name) || 'them')}</button>
            <button class="btn sm" data-copy="${esc(connectUrl(p.slug))}">Copy just the link</button></div></div>`,
    ).join('');
    const warnings = (st || []).flatMap((h) => h.warnings || []);
    return `
      <article class="card page-card">
        <span class="tape left" aria-hidden="true"></span>
        <div class="page-top"><h2>${esc(p.title)}</h2>${isHome ? '<span class="chip yellow flat">Main link</span>' : ''}</div>
        <div class="linkrow">
          <a class="url" href="${esc(isHome ? `${appUrl}/` : url)}" target="_blank" rel="noopener">${esc((isHome ? `${appUrl}/` : url).replace(/^https?:\/\//, ''))}</a>
          <button class="btn sm blue" data-copy="${esc(isHome ? `${appUrl}/` : url)}">Copy link</button>
        </div>
        <div class="lengths">
          <span class="label">Copy a link for</span>
          ${lengths.map((n) => `<button class="chip${n === p.defaultDuration ? ' yellow' : ''}" data-copy="${esc(url)}#${n}" title="${esc(url)}#${n}">${n} min</button>`).join('')}
          <span class="custom-len"><input type="number" min="5" max="${p.maxDuration}" placeholder="other" aria-label="Another length, in minutes">
          <button class="btn sm" data-copy-custom="${esc(url)}">Copy</button></span>
        </div>
        <div class="people">
          <div><span class="label">Must be free</span><div class="chips">${hostChips}</div></div>
          ${p.cc.length ? `<div><span class="label">Also invited</span><div class="chips">${p.cc.map((c) => `<span class="chip flat">${esc(c.name || c.email)}</span>`).join('')}</div></div>` : ''}
        </div>
        ${help}
        ${warnings.length ? `<p class="hint">${warnings.map(esc).join('. ')}.</p>` : ''}
        <div class="actions">
          <button class="btn sm" data-edit="${esc(p.slug)}">Edit</button>
          <button class="btn sm" data-dup="${esc(p.slug)}">Duplicate</button>
          <button class="btn sm pink" data-del="${esc(p.slug)}">Delete</button>
        </div>
      </article>`;
  }

  function settingsCard() {
    return `
      <section class="card">
        <h2>Your other calendars</h2>
        <p class="muted">When you're one of the people who must be free, Overlap checks your main calendar. If you keep other calendars
          (a personal Gmail one, say), list them here and their busy times count too. Each one must first be shared with
          ${esc(A.me.email)}, at least as "See only free/busy".</p>
        <form id="extras" class="form">
          <label class="field">Calendar addresses <span class="hint">One per line, e.g. you@gmail.com</span>
            <textarea name="extra">${esc(A.me.extraCalendars.join('\n'))}</textarea></label>
          <div><button class="btn" type="submit">Save calendars</button></div>
        </form>
      </section>`;
  }

  // ---------- Editor ----------

  function blankPage() {
    const weekday = ['09:00', '17:30'];
    return {
      slug: '', title: '', description: '', eventTitle: '{name} <> {hosts}',
      hosts: [{ email: A.me.email, name: A.me.name }], cc: [],
      defaultDuration: 25, maxDuration: 180, timezone: browserTz,
      hours: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: null, sun: null },
      stepMinutes: 30, bufferMinutes: 0, minNoticeHours: 4, daysAhead: 21,
      location: 'meet', locationText: '', allowGuests: true,
    };
  }

  const personLine = (p) => (p.name ? `${p.name} <${p.email}>` : p.email);

  function editor() {
    const { page: p, originalSlug } = A.editing;
    const steps = [5, 10, 15, 20, 30, 60];
    return `
      <section class="card"><span class="tape" aria-hidden="true"></span>
        <h2>${originalSlug ? `Edit “${esc(p.title)}”` : 'New booking page'}</h2>
        ${A.errors.length ? `<div class="error">${A.errors.map(esc).join('<br>')}</div>` : ''}
        <form id="editor" class="form wide" novalidate>
          <div class="grid2">
            <label class="field">Title <span class="hint">Shown at the top of the page.</span><input type="text" name="title" maxlength="120" required></label>
            <label class="field">Link name <span class="hint">${esc(appUrl.replace(/^https?:\/\//, ''))}/<b>this-bit</b></span><input type="text" name="slug" maxlength="49" required></label>
          </div>
          <label class="field">Description <span class="hint">Optional. A line or two for the person booking.</span><textarea name="description" maxlength="2000"></textarea></label>

          <fieldset><legend>Who must be free</legend>
            <label class="check"><input type="checkbox" name="meFree"> <span>Me (${esc(A.me.email)})</span></label>
            <label class="field">Others who must be free
              <span class="hint">One per line, like <code>Jo Smith &lt;jo@example.org&gt;</code>. Times only show when everyone listed is free, and they all get the invite.</span>
              <textarea name="hosts"></textarea></label>
          </fieldset>

          <label class="field">Also invite (CC)
            <span class="hint">Invited whatever their availability, marked as optional. One per line.</span>
            <textarea name="cc"></textarea></label>

          <fieldset><legend>Length</legend>
            <div class="grid2">
              <label class="field">Usual length, in minutes<input type="number" name="defaultDuration" min="5" max="480"></label>
              <label class="field">Longest you can set in a link<span class="hint">Add #75 to a link to book 75 minutes.</span><input type="number" name="maxDuration" min="5" max="480"></label>
            </div>
          </fieldset>

          <fieldset><legend>When</legend>
            <div class="hours">${DAYS.map(([d, label]) => `
              <div class="hour-row">
                <label class="check"><input type="checkbox" name="on-${d}"> <span>${label}</span></label>
                <input type="time" name="from-${d}" aria-label="${label} from"> <span class="muted">to</span>
                <input type="time" name="to-${d}" aria-label="${label} to">
              </div>`).join('')}
            </div>
            <label class="field">Time zone for these hours
              <select class="input" name="timezone">${timeZoneOptions(p.timezone)}</select></label>
            <div class="grid4">
              <label class="field">Start times every
                <select class="input" name="stepMinutes">${steps.map((s) => `<option value="${s}">${s} min</option>`).join('')}</select></label>
              <label class="field">Gap around other meetings <span class="hint">minutes</span><input type="number" name="bufferMinutes" min="0" max="120"></label>
              <label class="field">Minimum notice <span class="hint">hours</span><input type="number" name="minNoticeHours" min="0" max="720"></label>
              <label class="field">Bookable up to <span class="hint">days ahead</span><input type="number" name="daysAhead" min="1" max="90"></label>
            </div>
          </fieldset>

          <fieldset><legend>Where</legend>
            <label class="check"><input type="radio" name="location" value="meet"> <span>Google Meet <span class="hint">A link is added to every booking.</span></span></label>
            <label class="check"><input type="radio" name="location" value="custom"> <span>Somewhere else</span></label>
            <input type="text" name="locationText" placeholder="An address, a Zoom link or a phone number" maxlength="300">
            <label class="check"><input type="radio" name="location" value="none"> <span>Decide later</span></label>
          </fieldset>

          <fieldset><legend>Details</legend>
            <label class="field">Calendar event title
              <span class="hint">{name} is the person booking, {hosts} the people who must be free, {purpose} what they say it's for, {title} this page's title.</span>
              <input type="text" name="eventTitle" maxlength="150"></label>
            <label class="check"><input type="checkbox" name="allowGuests"> <span>Let people add guests</span></label>
            <label class="check"><input type="checkbox" name="home"> <span>Make this my main link <span class="hint">${esc(appUrl.replace(/^https?:\/\//, ''))}/ opens this page.</span></span></label>
          </fieldset>

          <div class="actions">
            <button class="btn green big" type="submit">Save</button>
            <button class="btn" type="button" data-cancel>Cancel</button>
          </div>
        </form>
      </section>`;
  }

  function fillEditor() {
    const { page: p, originalSlug } = A.editing;
    const f = document.getElementById('editor');
    const set = (name, value) => {
      if (f.elements[name]) f.elements[name].value = value ?? '';
    };
    set('title', p.title);
    set('slug', p.slug);
    set('description', p.description);
    f.elements.meFree.checked = p.hosts.some((h) => h.email === A.me.email);
    set('hosts', p.hosts.filter((h) => h.email !== A.me.email).map(personLine).join('\n'));
    set('cc', p.cc.map(personLine).join('\n'));
    set('defaultDuration', p.defaultDuration);
    set('maxDuration', p.maxDuration);
    for (const [d] of DAYS) {
      const h = p.hours[d];
      f.elements[`on-${d}`].checked = Boolean(h);
      set(`from-${d}`, h ? h[0] : '09:00');
      set(`to-${d}`, h ? h[1] : '17:30');
    }
    set('stepMinutes', p.stepMinutes);
    set('bufferMinutes', p.bufferMinutes);
    set('minNoticeHours', p.minNoticeHours);
    set('daysAhead', p.daysAhead);
    for (const r of f.querySelectorAll('input[name=location]')) r.checked = r.value === p.location;
    set('locationText', p.locationText);
    set('eventTitle', p.eventTitle);
    f.elements.allowGuests.checked = p.allowGuests;
    f.elements.home.checked = A.editing.home ?? (originalSlug ? A.home === originalSlug : !A.home);
  }

  function readEditor() {
    const f = document.getElementById('editor');
    const v = (name) => f.elements[name].value;
    const hours = {};
    for (const [d] of DAYS) hours[d] = f.elements[`on-${d}`].checked ? [v(`from-${d}`), v(`to-${d}`)] : null;
    const hosts = (f.elements.meFree.checked ? `${A.me.name ? `${A.me.name} <${A.me.email}>` : A.me.email}\n` : '') + v('hosts');
    return {
      page: {
        title: v('title'), slug: v('slug').trim().toLowerCase(), description: v('description'),
        hosts, cc: v('cc'),
        defaultDuration: Number(v('defaultDuration')), maxDuration: Number(v('maxDuration')),
        hours, timezone: v('timezone'),
        stepMinutes: Number(v('stepMinutes')), bufferMinutes: Number(v('bufferMinutes')),
        minNoticeHours: Number(v('minNoticeHours')), daysAhead: Number(v('daysAhead')),
        location: f.querySelector('input[name=location]:checked')?.value || 'meet', locationText: v('locationText'),
        eventTitle: v('eventTitle'), allowGuests: f.elements.allowGuests.checked,
      },
      home: f.elements.home.checked,
    };
  }

  const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  // ---------- Events ----------

  app.addEventListener('click', async (e) => {
    const el = e.target.closest('button, a');
    if (!el) return;
    const d = el.dataset;
    if (d.copy) return copyText(d.copy, el);
    if (d.copyCustom) {
      const n = Math.round(Number(el.previousElementSibling.value));
      if (n >= 5) copyText(`${d.copyCustom}#${n}`, el);
      else el.previousElementSibling.focus();
      return;
    }
    if ('new' in d) {
      A.editing = { page: blankPage(), originalSlug: null };
      A.errors = [];
      A.flash = '';
      render();
      window.scrollTo({ top: 0 });
    } else if (d.edit || d.dup) {
      const src = A.pages.find((p) => p.slug === (d.edit || d.dup));
      const page = JSON.parse(JSON.stringify(src));
      if (d.dup) {
        page.title = `${page.title} (copy)`;
        page.slug = `${page.slug}-copy`.slice(0, 49);
      }
      A.editing = { page, originalSlug: d.edit ? src.slug : null, home: d.dup ? false : undefined };
      A.errors = [];
      A.flash = '';
      render();
      window.scrollTo({ top: 0 });
    } else if (d.del) {
      const p = A.pages.find((x) => x.slug === d.del);
      if (!confirm(`Delete “${p.title}”? Its link will stop working. Meetings already booked stay in your calendar.`)) return;
      await api(`/api/pages?slug=${encodeURIComponent(d.del)}`, { method: 'DELETE' });
      A.flash = `Deleted “${p.title}”.`;
      await loadPages();
    } else if ('cancel' in d) {
      A.editing = null;
      render();
    }
  });

  app.addEventListener('input', (e) => {
    // Suggest a link name from the title on new pages, until the link name is edited by hand.
    const f = e.target.form;
    if (!f || f.id !== 'editor') return;
    if (e.target.name === 'slug') f.dataset.slugTouched = '1';
    if (e.target.name === 'title' && !A.editing.originalSlug && !f.dataset.slugTouched) f.elements.slug.value = slugify(e.target.value);
  });

  app.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (e.target.id === 'editor') {
      const { page, home } = readEditor();
      const button = e.target.querySelector('button[type=submit]');
      button.disabled = true;
      const r = await api('/api/pages', { method: 'PUT', body: { page, home, originalSlug: A.editing.originalSlug } });
      if (r._status !== 200) {
        A.errors = r.errors || [r.message || 'Something went wrong saving that.'];
        A.editing = { ...A.editing, page: { ...A.editing.page, ...page, hosts: parseLines(page.hosts), cc: parseLines(page.cc) }, home };
        render();
        window.scrollTo({ top: 0 });
        return;
      }
      A.editing = null;
      A.errors = [];
      A.flash = `Saved “${r.page.title}”.`;
      await loadPages();
      window.scrollTo({ top: 0 });
    } else if (e.target.id === 'extras') {
      const r = await api('/api/settings', { method: 'PUT', body: { extraCalendars: e.target.elements.extra.value } });
      if (r._status !== 200) {
        alert((r.errors || ['Could not save those calendars.']).join('\n'));
        return;
      }
      A.me.extraCalendars = r.extraCalendars;
      A.flash = 'Saved your calendars.';
      await loadPages();
    }
  });

  // Keeps what was typed when the server sends the form back with a problem.
  function parseLines(text) {
    return String(text || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/);
      return m ? { email: m[0].toLowerCase(), name: s.replace(m[0], '').replace(/[<>"]/g, '').trim() } : { email: s, name: '' };
    });
  }

  boot();
})();
