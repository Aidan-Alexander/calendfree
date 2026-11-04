// The admin page: sign in, your settings, and your booking pages.
(() => {
  const app = document.getElementById('app');
  const A = {
    me: null, pages: [], home: '', statuses: {}, editing: null, errors: [], flash: '',
    open: { hours: false, rules: false, calendars: false, person: null }, // settings sections being changed
    feedback: null, // { enabled, ideas, bugs } when this copy hosts the feedback board
  };
  const DAYS = DAY_KEYS.map(([d, , full]) => [d, full]);
  const browserTz = browserZone;
  const appUrl = location.origin + BASE;
  const pageUrl = (slug) => `${appUrl}/${slug}`;
  const shortUrl = (u) => u.replace(/^https?:\/\//, '');
  const connectUrl = (slug) => `${appUrl}/connect/?p=${encodeURIComponent(slug)}`;
  const first = (name) => String(name || '').trim().split(/\s+/)[0];
  const minutesList = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : String(list[0] || ''));

  const SIGN_IN_ERRORS = {
    not_allowed: (email) => `${email} isn't on the list of people who can make booking pages. Add it to ADMIN_EMAILS in your Netlify settings, then try again.`,
    scopes: () => 'Google asked which calendar permissions to give, and one was unticked. Calendfree needs both: one to check free times, one to add bookings to your calendar. Please sign in again and leave them ticked.',
    expired: () => 'That sign-in took too long. Please try again.',
    cancelled: () => 'Sign-in was cancelled.',
    no_email: () => "Google didn't share an email address. Please try again.",
    no_refresh: () => "Google didn't give Calendfree lasting access. Remove Calendfree at myaccount.google.com/permissions, then sign in again.",
    setup: () => "Google sign-in isn't set up yet.",
    gmail_scope: () => 'Email notifications need the "Send email" box ticked on Google\'s screen. Try switching them on again.',
  };

  const params = new URLSearchParams(location.search);
  const signInError = params.get('error') ? (SIGN_IN_ERRORS[params.get('error')] || (() => 'Sign-in failed. Please try again.'))(params.get('email') || 'That account') : '';
  const emailsJustOn = params.get('emails') === 'on';
  if (location.search) history.replaceState(null, '', location.pathname);

  async function boot() {
    const me = await api('/api/me');
    if (me._status === 200) {
      A.me = me;
      A.home = me.homeSlug;
      if (emailsJustOn) A.flash = "Email notifications are on. You'll get one from your own Gmail whenever someone books or cancels.";
      if (signInError) A.flash = signInError;
      await loadPages();
    } else {
      signInView(await api('/api/public/status'));
    }
  }

  async function loadPages() {
    const r = await api(`/api/pages?tz=${encodeURIComponent(browserTz)}`);
    A.pages = r.pages || [];
    A.home = r.homeSlug || '';
    render();
    await Promise.all([...A.pages.map((p) => loadStatus(p.slug)), loadFeedback()]);
  }

  async function loadFeedback() {
    const r = await api('/api/feedback');
    A.feedback = r.enabled ? r : null;
    if (!A.editing && !A.open.hours && !A.open.rules && !A.open.calendars && !A.open.person) render();
  }

  async function loadStatus(slug) {
    const r = await api(`/api/hosts?slug=${encodeURIComponent(slug)}`);
    A.statuses[slug] = r.hosts || [];
    if (!A.editing && !A.open.hours && !A.open.rules && !A.open.calendars && !A.open.person) render();
  }

  // ---------- Signed out ----------

  function signInView(status) {
    if (status.missing?.length) {
      app.innerHTML = `
        <section class="card"><span class="tape"></span>
          <h1>Almost there</h1>
          <p class="lede">Calendfree needs a Google sign-in set up before it can read calendars.</p>
          <p>These settings are missing from Netlify: <strong>${status.missing.map(esc).join(', ')}</strong>.</p>
          <p>When Google asks for an "authorised redirect URI", use this:</p>
          <p class="linkrow"><code>${esc(status.redirectUri)}</code> <button class="btn sm" data-copy="${esc(status.redirectUri)}">Copy</button></p>
          <p class="muted">The steps are in the <a href="https://github.com/Aidan-Alexander/calendfree#set-it-up">set-up guide</a>.</p>
        </section>`;
      return;
    }
    app.innerHTML = `
      <section class="card"><span class="tape"></span>
        <h1>Your booking pages</h1>
        <p class="lede">Sign in with the Google account whose calendar you book meetings from.</p>
        ${signInError ? `<p class="error">${esc(signInError)}</p>` : ''}
        <p><a class="btn green big" href="${BASE}/auth/login">Sign in with Google</a></p>
        <p class="muted small">Calendfree asks to see when you're busy and to add bookings to your calendar. It never reads what your events are.</p>
      </section>`;
  }

  // ---------- Signed in ----------

  function render() {
    if (!A.me) return;
    const top = `
      <header class="topbar">
        <span class="brand">Calendfree</span>
        <span class="muted small grow">${esc(A.me.email)}</span>
        <a class="btn sm" href="${BASE}/auth/logout">Sign out</a>
      </header>
      ${A.me.connected ? '' : `<p class="error">Calendfree can't reach your Google Calendar any more. <a href="${BASE}/auth/login?consent=1">Sign in again</a> to fix it.</p>`}
      ${A.flash ? `<p class="notice">${esc(A.flash)}</p>` : ''}`;
    if (A.editing) {
      app.innerHTML = top + editor();
      fillEditor();
      return;
    }
    app.innerHTML = `${top}
      <h1 class="section-title">Your settings</h1>
      ${settingsCard()}
      <div class="dash-head"><h1>Your booking pages</h1><button class="btn green" data-new>New page</button></div>
      ${A.pages.map(card).join('') || '<section class="card"><p>No booking pages yet.</p></section>'}
      ${peopleTip()}
      ${feedbackSection()}
      <footer class="foot">Ideas or problems with Calendfree? <a href="{{FEEDBACK_URL}}" target="_blank" rel="noopener">Send feedback</a></footer>`;
  }

  // ----- Settings: working hours, email notifications, other calendars -----

  function settingsCard() {
    const m = A.me;
    const hoursNow = m.hours
      ? `${describeHours(m.hours, m.timezone)}${m.travel?.length ? ` · ${m.travel.length} trip${m.travel.length > 1 ? 's' : ''} coming up` : ''}`
      : `Not set yet, so you're treated as Mon–Fri 09:00–17:30 in each page's time zone.`;
    return `
      <section class="card settings">
        <div class="setting">
          <h2>Working hours</h2>
          <p class="muted">Bookings only land inside working hours, on every page. To use other hours on one page, choose "Different hours" when editing it.</p>
          ${A.open.hours
            ? `<div data-hours-for="${esc(m.email)}" class="form wide">
                ${hoursForm(m.hours, m.timezone || browserTz, m.travel)}
                <div class="actions"><button class="btn green" type="button" data-hours-save>Save working hours</button>
                  <button class="btn" type="button" data-open="hours">Cancel</button></div>
              </div>`
            : `<div class="setting-row"><strong>You</strong><span>${esc(hoursNow)}</span><button class="btn sm" type="button" data-open="hours">Change</button></div>`}
          ${colleagues().length ? `<span class="label colleagues-label">Other people on your pages</span>
            <p class="hint">They're here because they're in People on one of your pages. They can set their own hours when they share their calendar, or you can set them here.</p>
            ${colleagues().map(personHours).join('')}` : ''}
        </div>

        <div class="setting">
          <h2>Booking rules</h2>
          <p class="muted">Used by all your pages, unless a page sets its own.</p>
          ${A.open.rules
            ? `<form id="rules" class="form wide">${rulesFields(m.rules)}
                <div class="actions"><button class="btn green" type="submit">Save booking rules</button>
                  <button class="btn" type="button" data-open="rules">Cancel</button></div></form>`
            : `<div class="setting-row"><span>${esc(rulesText(m.rules).replace(/^./, (c) => c.toUpperCase()))}.</span>
                <button class="btn sm" type="button" data-open="rules">Change</button></div>`}
        </div>

        <div class="setting">
          <h2>Email notifications</h2>
          <p class="muted">An email from your own Gmail whenever someone books or cancels one of your pages.</p>
          ${m.emailError ? `<p class="error">The last email didn't send. Google said: “${esc(m.emailError)}”</p>` : ''}
          <div class="setting-row">
            ${m.canEmail
              ? `<label class="check"><input type="checkbox" data-notify${m.notify ? ' checked' : ''}> <span>Email me about bookings</span></label>
                 <button class="btn sm" type="button" data-test-email>Send a test email</button>`
              : `<span>Off</span><a class="btn sm" href="${BASE}/auth/login?consent=1&gmail=1">Switch on</a>
                 <span class="hint">Google asks once if Calendfree may send email as you. It only ever emails you.</span>`}
          </div>
        </div>

        <div class="setting">
          <h2>Your other calendars</h2>
          <p class="muted">Calendfree checks your main calendar. If you keep another one (a personal Gmail calendar, say), add it and its busy times count too. Share it with ${esc(m.email)} first, at least as "See only free/busy".</p>
          ${A.open.calendars
            ? `<form id="extras" class="form">
                <label class="field">Calendar addresses <span class="hint">One per line, e.g. you@gmail.com</span>
                  <textarea name="extra">${esc((m.extraCalendars || []).join('\n'))}</textarea></label>
                <div class="actions"><button class="btn green" type="submit">Save calendars</button>
                  <button class="btn" type="button" data-open="calendars">Cancel</button></div>
              </form>`
            : `<div class="setting-row"><span>${m.extraCalendars?.length ? esc(m.extraCalendars.join(', ')) : 'None'}</span>
                <button class="btn sm" type="button" data-open="calendars">${m.extraCalendars?.length ? 'Change' : 'Add one'}</button></div>`}
        </div>
      </section>`;
  }

  // Everyone on your pages apart from you, from the calendar checks (which include their hours).
  function colleagues() {
    const seen = new Map();
    for (const p of A.pages) for (const h of A.statuses[p.slug] || []) if (h.email !== A.me.email && !seen.has(h.email)) seen.set(h.email, h);
    return [...seen.values()];
  }

  function personHours(h) {
    const editing = A.open.person === h.email;
    const now = h.hours ? describeHours(h.hours, h.timezone) : 'Not set: Mon–Fri 09:00–17:30';
    return `<div class="person" data-hours-for="${esc(h.email)}">
        <div class="setting-row"><strong>${esc(h.name || h.email)}</strong><span class="muted">${esc(now)}</span>
          ${editing ? '' : `<button class="btn sm" type="button" data-person="${esc(h.email)}">Change</button>`}</div>
        ${editing ? `${hoursForm(h.hours, h.timezone || A.me.timezone || browserTz, h.travel)}
          <div class="actions"><button class="btn sm green" type="button" data-hours-save>Save</button>
            ${h.hours ? '<button class="btn sm" type="button" data-hours-clear>Use the default</button>' : ''}
            <button class="btn sm" type="button" data-person="">Cancel</button></div>` : ''}
      </div>`;
  }

  // ----- Feedback board (only on the copy that hosts it) -----

  function feedbackSection() {
    const fb = A.feedback;
    if (!fb) return '';
    const when = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const open = fb.bugs.filter((b) => !b.done).length;
    return `
      <div class="dash-head"><h1>Feedback</h1><a class="btn sm" href="${BASE}/feedback/" target="_blank" rel="noopener">Open the public board</a></div>
      <section class="card">
        <h2>Problems reported${open ? ` (${open} open)` : ''}</h2>
        <p class="muted">Private: only admins see these.</p>
        ${fb.bugs.length ? fb.bugs.map((b) => `
          <div class="fb-item${b.done ? ' done' : ''}">
            <p>${esc(b.text)}</p>
            <p class="hint">${esc(when(b.createdAt))} · ${b.contact ? esc(b.contact) : 'no email given'}${b.page ? ` · from ${esc(b.page)}` : ''}</p>
            <div class="actions"><button class="btn sm" data-fb-done="${esc(b.id)}" data-now="${b.done ? '' : '1'}">${b.done ? 'Reopen' : 'Mark as dealt with'}</button>
              <button class="btn sm danger" data-fb-del="bug" data-id="${esc(b.id)}">Delete</button></div>
          </div>`).join('') : '<p>None yet.</p>'}

        <h2 class="fb-ideas">Ideas, most wanted first</h2>
        ${fb.ideas.length ? fb.ideas.map((i) => `
          <div class="fb-item${i.hidden ? ' done' : ''}">
            <p><strong>▲ ${i.votes}</strong> · ${esc(i.title)}${i.hidden ? ' <span class="chip">Hidden</span>' : ''}</p>
            ${i.details ? `<p class="hint">${esc(i.details)}</p>` : ''}
            <div class="actions">
              <select class="input fb-status" data-fb-status="${esc(i.id)}" aria-label="Status">
                ${[['', 'No status'], ['planned', 'Planned'], ['done', 'Done']].map(([v, l]) => `<option value="${v}"${i.status === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select>
              <button class="btn sm" data-fb-hide="${esc(i.id)}" data-now="${i.hidden ? '' : '1'}">${i.hidden ? 'Show on the board' : 'Hide from the board'}</button>
              <button class="btn sm danger" data-fb-del="idea" data-id="${esc(i.id)}">Delete</button>
            </div>
          </div>`).join('') : '<p>None yet.</p>'}
      </section>`;
  }

  // ----- Booking page cards -----

  function hostTag(h) {
    if (!h) return '';
    const you = h.email === A.me.email;
    const name = esc(you ? `${first(h.name) || 'You'} (you)` : h.name || h.email);
    if (!h.ok) return `<span class="chip pink" title="Calendfree can't see this calendar">! ${name}</span>`;
    const how = h.via === 'connected' ? 'Shared their calendar with Calendfree' : h.via === 'shared' ? 'Visible through your Google account' : 'Your calendar';
    return `<span class="chip green" title="${esc(how)}">✓ ${name}</span>`;
  }

  function inviteMessage(page, host) {
    return `Hi ${first(host.name) || 'there'}, I book meetings with a scheduler that only offers times when everyone who needs to be there is free, ` +
      `and I've added you to one of my booking pages. Could you click this link so it can see when you're busy? ` +
      `It only sees busy and free times, never what your meetings are, and you can switch it off any time. ` +
      `If you'd rather not connect anything, the page also explains how to share your free/busy with me from Google Calendar instead: ${connectUrl(page.slug)}`;
  }

  // After saving a page with people Calendfree can't see yet: say so straight away, with a message to send each of them.
  function letThemKnow(slug) {
    const page = A.pages.find((p) => p.slug === slug);
    const unseen = (A.statuses[slug] || []).filter((h) => !h.ok && h.email !== A.me.email);
    if (!page || !unseen.length) return;
    const names = unseen.map((h) => esc(first(h.name) || h.email));
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    const d = document.createElement('dialog');
    d.className = 'confirm';
    d.innerHTML = `<h3>One more step</h3>
      <p>Calendfree can't see ${unseen.length > 1 ? `the calendars of ${list}` : `${list}'s calendar`} yet, so this page won't offer any times until it can.</p>
      <p>Send ${unseen.length > 1 ? 'each of them' : list} a message with a link. They click it and share their busy times in two clicks,
        or share their free/busy with you from Google Calendar. Calendfree only ever sees when they're busy, never what their meetings are.</p>
      <div class="invite-list">${unseen.map((h) => `<div class="setting-row"><strong>${esc(h.name || h.email)}</strong>
        <button class="btn sm green" data-copy="${esc(inviteMessage(page, h))}">Copy a message for ${esc(first(h.name) || 'them')}</button></div>`).join('')}</div>
      <p class="hint">The page's card keeps these messages until Calendfree can see their calendar.
        <a href="${esc(connectUrl(slug))}" target="_blank" rel="noopener">See the page they'll get</a></p>
      <div class="actions"><button class="btn" value="close">Done</button></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.copy) return copyText(b.dataset.copy, b);
      d.close();
      d.remove();
    });
    d.addEventListener('cancel', () => d.remove());
    d.showModal();
  }

  // Until someone has a page with other people on it, say that they can, with a button that starts one.
  function peopleTip() {
    if (A.pages.some((p) => p.hosts.some((h) => h.email !== A.me.email)) || local.get('calendfree.peopleTip')) return '';
    return `<section class="card tip-card">
        <h2>Meetings with other people</h2>
        <p>A booking page can need other people to be free too: a co-interviewer, a colleague, or anyone else with a Google calendar.
          Calendfree then only offers times when you're all free, and invites everyone.</p>
        <div class="actions"><button class="btn green" data-new-others>Make a page with other people</button>
          <button class="btn" data-tip-hide>Not now</button></div>
      </section>`;
  }

  function card(p) {
    const isHome = !A.me.shared && A.home === p.slug;
    const url = pageUrl(p.slug);
    const shown = isHome ? `${appUrl}/` : url;
    const st = A.statuses[p.slug];
    const tags = st ? st.map(hostTag).join('') : p.hosts.map((h) => `<span class="chip">${esc(h.name || h.email)}</span>`).join('');
    const help = (st || []).filter((h) => !h.ok).map((h) =>
      h.email === A.me.email
        ? `<p class="notice small">Calendfree can't read your own calendar, so this page offers no times.
            ${String(h.reason || '').length > 20 ? `Google said: “${esc(h.reason)}”` : `<a href="${BASE}/auth/login?consent=1">Sign in again</a>.`}</p>`
        : `<div class="notice small"><p><strong>Calendfree can't see ${esc(h.name || h.email)}'s calendar yet,</strong> so this page won't offer any times.
            Send ${esc(first(h.name) || 'them')} this message. They click the link and share their busy times in two clicks, or share their free/busy with you from Google Calendar.</p>
            <div class="actions"><button class="btn sm" data-copy="${esc(inviteMessage(p, h))}">Copy a message for ${esc(first(h.name) || 'them')}</button>
            <button class="btn sm" data-copy="${esc(connectUrl(p.slug))}">Copy just the link</button>
            <a class="linkish small" href="${esc(connectUrl(p.slug))}" target="_blank" rel="noopener">See the page they'll get</a></div></div>`,
    ).join('');
    const warnings = (st || []).flatMap((h) => h.warnings || []);
    // "Must be free: you" goes without saying, so only list people when there's someone else.
    const justMe = p.hosts.length === 1 && p.hosts[0].email === A.me.email;
    const summary = [
      p.mode === 'any' ? 'Round robin: one of them per booking' : '',
      p.hours ? 'Different hours' : '',
      p.rules ? 'Own booking rules' : '',
      p.preferred ? `Preferred ${p.preferred[0]}–${p.preferred[1]}` : '',
      p.dailyCap ? `Up to ${p.dailyCap} a day` : '',
    ].filter(Boolean);
    return `
      <article class="card page-card${isHome ? ' main' : ''}">
        <span class="tape left" aria-hidden="true"></span>
        ${isHome ? '<span class="chip yellow corner">Main link</span>' : ''}
        <div class="page-top${isHome ? ' has-corner' : ''}"><h2>${esc(p.title)}</h2></div>
        ${summary.length ? `<p class="summary">${summary.map(esc).join(' · ')}</p>` : ''}
        <div class="linkrow">
          <a class="url" href="${esc(shown)}" target="_blank" rel="noopener">${esc(shortUrl(shown))}</a>
          <button class="btn sm" data-copy="${esc(shown)}">Copy link</button>
        </div>
        <p class="len-line"><strong>${p.defaultDuration} min</strong> by default${p.durations?.length ? ` · guests can choose ${minutesList(p.durations)} min` : ''}</p>
        <p class="hint">For another length, add # and the minutes to the end of the link, like ${esc(shortUrl(url))}#75.</p>
        ${justMe && !p.cc.length ? '' : `<div class="people">
          ${justMe ? '' : `<div><span class="label">${p.mode === 'any' ? 'Any one of these' : 'Must be free'}</span><div class="chips">${tags}</div></div>`}
          ${p.cc.length ? `<div><span class="label">CC'd</span><p class="plain">${p.cc.map((c) => esc(c.name || c.email)).join(', ')}</p></div>` : ''}
        </div>`}
        ${help}
        ${warnings.length ? `<p class="hint">${warnings.map(esc).join('. ')}.</p>` : ''}
        <div class="actions">
          <button class="btn sm" data-edit="${esc(p.slug)}">Edit</button>
          <button class="btn sm" data-dup="${esc(p.slug)}">Duplicate</button>
          <button class="btn sm danger" data-del="${esc(p.slug)}">Delete</button>
        </div>
      </article>`;
  }



  // ---------- Editor ----------

  function blankPage() {
    return {
      slug: '', title: '', description: '', eventTitle: '{name} <> {hosts}',
      hosts: [{ email: A.me.email, name: A.me.name }], cc: [],
      defaultDuration: A.me.defaultDuration || 30, timezone: A.me.timezone || browserTz,
      hoursMode: 'working', hours: null, rules: null,
      location: 'meet', locationText: '', allowGuests: true, preferred: null,
      mode: 'all', durations: [], dailyCap: 0,
    };
  }

  const personLine = (p) => (p.name ? `${p.name} <${p.email}>` : p.email);

  function editor() {
    const { originalSlug, page: p } = A.editing;
    return `
      <section class="card editor-card"><span class="tape" aria-hidden="true"></span>
        <button type="button" class="btn round close-x" data-cancel aria-label="Close without saving" title="Close without saving">×</button>
        <h2>${originalSlug ? `Edit “${esc(p.title)}”` : 'New booking page'}</h2>
        ${A.errors.length ? `<div class="error">${A.errors.map(esc).join('<br>')}</div>` : ''}
        <form id="editor" class="form wide" novalidate>
          <div class="grid2">
            <label class="field">Title <span class="hint">Shown at the top of the page.</span><input type="text" name="title" maxlength="120" required></label>
            <label class="field">Link name <span class="hint">${esc(shortUrl(appUrl))}/<b>this-bit</b></span><input type="text" name="slug" maxlength="49" required></label>
          </div>
          <label class="check"${A.me.shared ? ' hidden' : ''}><input type="checkbox" name="home"> <span>Make this my main link <span class="hint">${esc(shortUrl(appUrl))}/ opens this page.</span></span></label>
          <label class="field">Description <span class="hint">Optional. A line or two for the person booking.</span><textarea name="description" maxlength="2000"></textarea></label>

          <fieldset><legend>Who's at the meeting</legend>
            <div class="seg" role="radiogroup" aria-label="Who's at the meeting">
              <label><input type="radio" name="who" value="me"><span>Just me</span></label>
              <label><input type="radio" name="who" value="others"><span>Others</span></label>
            </div>
            <p class="hint who-me-hint">Need someone else there too? Choose Others and add them: a colleague, or anyone else with a Google calendar. Calendfree then only offers times when you're all free.</p>
            <div class="who-others">
              <div class="people-box">
                <span class="label">People</span>
                <p class="hint">Colleagues, or anyone else with a Google calendar. You're on the list; remove yourself if you won't be there.</p>
                <div class="people-rows"></div>
                <button type="button" class="linkish" data-row-add>+ Add a person</button>
                <details class="how-people"${p.hosts.some((h) => h.email !== A.me.email) ? '' : ' open'}><summary>How adding someone works</summary>
                  <ol>
                    <li>Add their name and email, then save the page.</li>
                    <li>Calendfree checks whether it can see their calendar. People in the same Google Workspace as you usually work straight away.</li>
                    <li>If it can't, you get a short message with a link to send them. They click it and share their busy times, or share their free/busy with you from Google Calendar. Until then, the page offers no times.</li>
                  </ol>
                  <p>Calendfree only ever sees when people are busy, never what their meetings are.</p>
                </details>
              </div>
              <div class="who-mode">
                <label class="check"><input type="radio" name="mode" value="all"> <span>Everyone listed <span class="hint">Times only show when they're all free, and they're all invited.</span></span></label>
                <label class="check"><input type="radio" name="mode" value="any"> <span>Any one of them (round robin) <span class="hint">Times show when at least one is free. Each booking goes to whoever's free and has had the fewest, and only they're invited.</span></span></label>
              </div>
            </div>
            <label class="field cc-box">Add someone as CC (so they know you have a call booked) <span class="hint">They're invited whatever their availability, marked as optional. One per line.</span><textarea name="cc"></textarea></label>
            <button type="button" class="linkish cc-add" data-cc-add>+ Add someone as CC</button>
          </fieldset>

          <fieldset><legend>Length</legend>
            <div class="len-boxes">
              ${[0, 1, 2, 3, 4].map((i) => `<input type="number" name="len${i}" min="5" max="240" placeholder="${i ? '' : '30'}" aria-label="${i ? `Another length to offer, in minutes` : 'Length, in minutes'}">`).join('')}
              <span class="muted">minutes</span>
            </div>
            <p class="hint">Fill in one length, or a few to let people choose (the first is the default).
              You can always override this and send a link to book an X minute meeting by adding #X to the URL, e.g. ${esc(shortUrl(pageUrl(p.slug || 'your-link')))}#75</p>
          </fieldset>

          <fieldset><legend>When</legend>
            <span class="label">Hours</span>
            <div class="seg" role="radiogroup" aria-label="Hours">
              <label><input type="radio" name="hoursMode" value="working"><span>Your default hours</span></label>
              <label><input type="radio" name="hoursMode" value="replace"><span>Different hours</span></label>
            </div>
            <p class="hint hours-hint"></p>
            <div class="hours page-hours">
              <p class="hint">In your time zone. They follow you when you travel.</p>
              ${DAYS.map(([d, label]) => `
              <div class="hour-row">
                <label class="check"><input type="checkbox" name="on-${d}"> <span>${label}</span></label>
                <input type="time" name="from-${d}" aria-label="${label} from"> <span class="muted">to</span>
                <input type="time" name="to-${d}" aria-label="${label} to">
              </div>`).join('')}
            </div>

            <span class="label">Booking rules</span>
            <div class="setting-row rules-usual"><span>Your usual rules: ${esc(rulesText(A.me.rules))}.</span>
              <button type="button" class="btn sm" data-rules-own>Change for this page</button></div>
            <div class="rules-own">
              ${rulesFields(p.rules || A.me.rules)}
              <button type="button" class="linkish" data-rules-usual>Use my usual rules instead</button>
            </div>
            <input type="hidden" name="rulesOwn">

            <span class="label">Extras</span>
            <label class="check"><input type="checkbox" name="prefOn"> <span>Show preferred times first <span class="hint">People see these first, with a button to see the rest. Great if you'd rather have afternoon meetings but don't want to make it a hard rule.</span></span></label>
            <div class="pref-times hm-times">
              <input type="time" name="prefFrom" aria-label="Preferred from"> <span class="muted">to</span>
              <input type="time" name="prefTo" aria-label="Preferred to">
            </div>
            <label class="field narrow-field">Most bookings a day from this page <span class="hint">Leave empty for no limit.</span><input type="number" name="dailyCap" min="1" max="50" placeholder="No limit"></label>
          </fieldset>

          <fieldset><legend>Where</legend>
            <label class="check"><input type="radio" name="location" value="meet"> <span>Google Meet <span class="hint">A link is added to every booking.</span></span></label>
            <label class="check"><input type="radio" name="location" value="custom"> <span>Somewhere else</span></label>
            <input type="text" name="locationText" class="location-text" placeholder="An address, a Zoom link or a phone number" maxlength="300">
            <label class="check"><input type="radio" name="location" value="none"> <span>I'll add a call link later if I need one</span></label>
          </fieldset>

          <details class="more"${A.editing.moreOpen ? ' open' : ''}><summary>More options</summary>
            <div class="form wide">
              <label class="check"><input type="checkbox" name="allowGuests"> <span>Let people add guests</span></label>
              <label class="field">Calendar event title
                <span class="hint">{name} is the person booking, {hosts} the people at the meeting, {purpose} what they say it's for.</span>
                <input type="text" name="eventTitle" maxlength="150"></label>
            </div>
          </details>

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
    for (const r of f.querySelectorAll('input[name=mode]')) r.checked = r.value === (p.mode || 'all');
    const others = A.editing.others || p.hosts.some((h) => h.email !== A.me.email);
    for (const r of f.querySelectorAll('input[name=who]')) r.checked = r.value === (others ? 'others' : 'me');
    const people = p.hosts.length ? p.hosts : [{ email: A.me.email, name: A.me.name }];
    // A page that's just you starts "Others" with an empty row to fill in.
    setRows(f, people.some((h) => h.email !== A.me.email) ? people : [...people, {}]);
    set('cc', p.cc.map(personLine).join('\n'));
    const lengths = [p.defaultDuration, ...(p.durations || []).filter((n) => n !== p.defaultDuration)].slice(0, 5);
    for (let i = 0; i < 5; i++) set(`len${i}`, lengths[i] ?? '');
    // Pages saved before booking rules went global kept them on the page: treat changed ones as this page's own.
    const legacy = p.rules === undefined && RULE_KEYS.some((k) => p[k] != null && p[k] !== RULE_DEFAULTS[k]);
    const own = p.rules || (legacy ? Object.fromEntries(RULE_KEYS.map((k) => [k, p[k] ?? RULE_DEFAULTS[k]])) : null);
    f.elements.rulesOwn.value = own ? '1' : '';
    if (own) for (const k of RULE_KEYS) set(k, own[k]);
    set('dailyCap', p.dailyCap || '');
    f.elements.prefOn.checked = Boolean(p.preferred);
    set('prefFrom', p.preferred?.[0] || '12:00');
    set('prefTo', p.preferred?.[1] || '17:30');
    const mode = p.hours ? 'replace' : 'working';
    for (const r of f.querySelectorAll('input[name=hoursMode]')) r.checked = r.value === mode;
    const hours = p.hours || DEFAULT_WEEK;
    for (const [d] of DAYS) {
      f.elements[`on-${d}`].checked = Boolean(hours[d]);
      set(`from-${d}`, hours[d] ? hours[d][0] : '09:00');
      set(`to-${d}`, hours[d] ? hours[d][1] : '17:30');
    }
    showWho(f);
    showWhen(f);
    showExtras(f);
    for (const r of f.querySelectorAll('input[name=location]')) r.checked = r.value === p.location;
    set('locationText', p.locationText);
    set('eventTitle', p.eventTitle);
    f.elements.allowGuests.checked = p.allowGuests;
    f.elements.home.checked = A.editing.home ?? (originalSlug ? A.home === originalSlug : !A.home);
  }

  function readEditor() {
    const f = document.getElementById('editor');
    const v = (name) => f.elements[name].value;
    const lengths = [0, 1, 2, 3, 4].map((i) => Math.round(Number(v(`len${i}`)))).filter((n) => n >= 5);
    const hoursMode = f.querySelector('input[name=hoursMode]:checked')?.value || 'working';
    let hours = null;
    if (hoursMode !== 'working') {
      hours = {};
      for (const [d] of DAYS) hours[d] = f.elements[`on-${d}`].checked ? [v(`from-${d}`), v(`to-${d}`)] : null;
    }
    const justMe = f.querySelector('input[name=who]:checked')?.value !== 'others';
    const hosts = justMe ? myLine() : rowsToText(f);
    return {
      page: {
        title: v('title'), slug: v('slug').trim().toLowerCase(), description: v('description'),
        mode: justMe ? 'all' : f.querySelector('input[name=mode]:checked')?.value || 'all',
        hosts, cc: v('cc'),
        defaultDuration: lengths[0] || 30,
        durations: lengths.length > 1 ? lengths.join(',') : '',
        hoursMode, hours, timezone: A.me.timezone || browserTz,
        rules: f.elements.rulesOwn.value ? Object.fromEntries(RULE_KEYS.map((k) => [k, Number(v(k))])) : null,
        dailyCap: Number(v('dailyCap')) || 0,
        preferred: f.elements.prefOn.checked ? [v('prefFrom'), v('prefTo')] : null,
        location: f.querySelector('input[name=location]:checked')?.value || 'meet', locationText: v('locationText'),
        eventTitle: v('eventTitle'), allowGuests: f.elements.allowGuests.checked,
      },
      home: f.elements.home.checked,
    };
  }

  const RULE_KEYS = ['bufferMinutes', 'minNoticeHours', 'daysAhead'];
  const RULE_DEFAULTS = { bufferMinutes: 0, minNoticeHours: 4, daysAhead: 21 };

  function rulesText(r = RULE_DEFAULTS) {
    const gap = r.bufferMinutes ? `a ${r.bufferMinutes}-minute gap around other meetings` : 'no gap around other meetings';
    const notice = r.minNoticeHours ? `at least ${r.minNoticeHours} hour${r.minNoticeHours === 1 ? '' : 's'}' notice` : 'no minimum notice';
    return `${gap}, ${notice}, bookable up to ${r.daysAhead} days ahead`;
  }

  function rulesFields(r = RULE_DEFAULTS) {
    return `<div class="grid-rules">
        <label class="field">Gap around other meetings <span class="hint">minutes</span><input type="number" name="bufferMinutes" min="0" max="120" value="${r.bufferMinutes}"></label>
        <label class="field">Minimum notice <span class="hint">hours</span><input type="number" name="minNoticeHours" min="0" max="720" value="${r.minNoticeHours}"></label>
        <label class="field">Bookable up to <span class="hint">days ahead</span><input type="number" name="daysAhead" min="1" max="90" value="${r.daysAhead}"></label>
      </div>`;
  }

  // Preferred times only when ticked; the "somewhere else" box only when that's picked.
  function showExtras(f) {
    f.querySelector('.pref-times').hidden = !f.elements.prefOn.checked;
    f.querySelector('.location-text').hidden = f.querySelector('input[name=location]:checked')?.value !== 'custom';
  }

  // Page hours show only for "Only some" and "Different"; the page's own rules only after "Change for this page".
  function showWhen(f) {
    const mode = f.querySelector('input[name=hoursMode]:checked')?.value || 'working';
    f.querySelector('.page-hours').hidden = mode === 'working';
    f.querySelector('.hours-hint').textContent = {
      working: "Your working hours, set under Your settings.",
      replace: "Instead of your working hours on this page: afternoons only, say, or an evening link you only give to some people. Colleagues' own working hours still apply, and calendars are always checked.",
    }[mode];
    const own = Boolean(f.elements.rulesOwn.value);
    f.querySelector('.rules-own').hidden = !own;
    f.querySelector('.rules-usual').hidden = own;
  }

  const myLine = () => (A.me.name ? `${A.me.name} <${A.me.email}>` : A.me.email);

  // People are rows of name + email, sent to the server as "Name <email>" lines.
  const personRow = (h = {}) => `<div class="person-row">
      <input type="text" class="p-name" placeholder="Name" aria-label="Name" maxlength="80" value="${esc(h.name || '')}">
      <input type="email" class="p-email" placeholder="name@example.org" aria-label="Email address" value="${esc(h.email || '')}">
      <button type="button" class="btn round sm" data-row-del aria-label="Remove this person" title="Remove">×</button>
    </div>`;
  const setRows = (f, people) => {
    f.querySelector('.people-rows').innerHTML = people.map(personRow).join('');
  };
  function rowsToText(f) {
    return [...f.querySelectorAll('.person-row')].map((r) => {
      const name = r.querySelector('.p-name').value.trim();
      const email = r.querySelector('.p-email').value.trim();
      return name && email ? `${name} <${email}>` : email || name;
    }).filter(Boolean).join('\n');
  }
  // Pasting "Jo Smith <jo@example.org>", or several addresses, into an email box fills in rows for them.
  function splitPasted(input) {
    const found = parseLines(input.value).filter((x) => x.email.includes('@'));
    if (!found.length || (found.length === 1 && !found[0].name && found[0].email === input.value.trim())) return;
    const row = input.closest('.person-row');
    input.value = found[0].email;
    if (found[0].name && !row.querySelector('.p-name').value.trim()) row.querySelector('.p-name').value = found[0].name;
    row.insertAdjacentHTML('afterend', found.slice(1).map(personRow).join(''));
  }

  // Saving a page without yourself in People: make sure that's on purpose.
  function confirmNotAttending(inCc) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'confirm';
      d.innerHTML = `<h3>You're not in People</h3>
        <p>${inCc ? "You'll be invited as CC, whatever your availability." : "You won't be invited to these meetings, and your calendar won't be checked."}</p>
        <div class="actions"><button class="btn green" value="save">Save anyway</button><button class="btn" value="back">Go back and change it</button></div>`;
      document.body.appendChild(d);
      d.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        d.close();
        d.remove();
        resolve(b.value === 'save');
      });
      d.addEventListener('cancel', () => {
        d.remove();
        resolve(false);
      });
      d.showModal();
    });
  }

  // "Just me" hides everything about other people (CC stays one click away); "Others" shows it all.
  function showWho(f, ccOpen = false) {
    const others = f.querySelector('input[name=who]:checked')?.value === 'others';
    f.querySelector('.who-others').hidden = !others;
    f.querySelector('.who-me-hint').hidden = others;
    const showCc = others || ccOpen || Boolean(f.elements.cc.value.trim());
    f.querySelector('.cc-box').hidden = !showCc;
    f.querySelector('.cc-add').hidden = showCc;
  }

  const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  // Keeps what was typed when the server sends the form back with a problem.
  function parseLines(text) {
    return String(text || '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/);
      return m ? { email: m[0].toLowerCase(), name: s.replace(m[0], '').replace(/[<>"]/g, '').trim() } : { email: s, name: '' };
    });
  }

  async function saveHours(box) {
    const target = box.dataset.hoursFor;
    const body = box.querySelector('.hours-mini') ? readHoursForm(box) : { hours: null, timezone: '', travel: [] };
    const r = target === A.me.email
      ? await api('/api/settings', { method: 'PUT', body })
      : await api('/api/hours', { method: 'PUT', body: { email: target, ...body } });
    if (r._status !== 200) return alert((r.errors || ['Could not save those hours.']).join('\n'));
    if (target === A.me.email) Object.assign(A.me, { hours: r.hours, timezone: r.timezone, travel: r.travel });
    A.flash = r.hours ? `Saved working hours: ${describeHours(r.hours, r.timezone)}.` : 'Back to the default working hours.';
    A.open.hours = false;
    A.open.person = null;
    await loadPages();
  }

  // ---------- Events ----------

  app.addEventListener('click', async (e) => {
    const el = e.target.closest('button, a');
    if (!el) return;
    const d = el.dataset;
    if (d.copy) return copyText(d.copy, el);
    if (d.open) {
      A.open[d.open] = !A.open[d.open];
      A.flash = '';
      render();
      return;
    }
    if ('person' in d) {
      A.open.person = d.person || null;
      render();
      return;
    }
    if ('rulesOwn' in d || 'rulesUsual' in d) {
      el.form.elements.rulesOwn.value = 'rulesOwn' in d ? '1' : '';
      showWhen(el.form);
      return;
    }
    if ('ccAdd' in d) {
      showWho(el.form, true);
      el.form.elements.cc.focus();
      return;
    }
    if ('rowAdd' in d) {
      const rows = el.form.querySelector('.people-rows');
      rows.insertAdjacentHTML('beforeend', personRow());
      rows.lastElementChild.querySelector('.p-name').focus();
      return;
    }
    if ('rowDel' in d) {
      const rows = el.closest('.people-rows');
      el.closest('.person-row').remove();
      if (!rows.children.length) rows.insertAdjacentHTML('beforeend', personRow());
      return;
    }
    if ('tipHide' in d) {
      local.set('calendfree.peopleTip', '1');
      render();
      return;
    }
    if ('hoursSave' in d) return saveHours(el.closest('[data-hours-for]'));
    if ('hoursClear' in d) {
      const box = el.closest('[data-hours-for]');
      box.querySelector('.hours-mini')?.remove();
      return saveHours(box);
    }
    if (d.fbDone || d.fbHide || d.fbDel) {
      const kind = d.fbDel || (d.fbDone ? 'bug' : 'idea');
      const id = d.id || d.fbDone || d.fbHide;
      if (d.fbDel && !confirm('Delete this for good?')) return;
      await api(`/api/feedback?kind=${kind}&id=${encodeURIComponent(id)}`, d.fbDel
        ? { method: 'DELETE' }
        : { method: 'PUT', body: d.fbDone ? { done: Boolean(d.now) } : { hidden: Boolean(d.now) } });
      await loadFeedback();
      return;
    }
    if ('testEmail' in d) {
      el.disabled = true;
      const r = await api('/api/settings/test-email', { method: 'POST', body: {} });
      A.me.emailError = r.ok ? '' : (r.errors || ['It did not send.'])[0];
      A.flash = r.ok ? `Sent a test email to ${A.me.email}.` : '';
      render();
      return;
    }
    if ('new' in d || 'newOthers' in d) {
      A.editing = { page: blankPage(), originalSlug: null, others: 'newOthers' in d };
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

  app.addEventListener('change', async (e) => {
    if (e.target.dataset.fbStatus) {
      await api(`/api/feedback?kind=idea&id=${encodeURIComponent(e.target.dataset.fbStatus)}`, { method: 'PUT', body: { status: e.target.value } });
      await loadFeedback();
      return;
    }
    if (e.target.name === 'who') {
      const f = e.target.form;
      if (e.target.value === 'others' && !f.querySelector('.person-row')) setRows(f, [{ email: A.me.email, name: A.me.name }, {}]);
      showWho(f);
      return;
    }
    if (e.target.classList.contains('p-email')) {
      splitPasted(e.target);
      return;
    }
    if (e.target.name === 'hoursMode') {
      showWhen(e.target.form);
      return;
    }
    if (e.target.name === 'prefOn' || e.target.name === 'location') {
      showExtras(e.target.form);
      return;
    }
    if (!('notify' in e.target.dataset)) return;
    const r = await api('/api/settings', { method: 'PUT', body: { notify: e.target.checked } });
    A.me.notify = Boolean(r.notify);
    A.flash = A.me.notify ? 'Email notifications are on.' : 'Email notifications are off.';
    render();
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
      const mine = (text) => parseLines(text).some((x) => x.email === A.me.email);
      if (!mine(page.hosts) && !(await confirmNotAttending(mine(page.cc)))) return;
      e.target.querySelector('button[type=submit]').disabled = true;
      const r = await api('/api/pages', { method: 'PUT', body: { page, home, originalSlug: A.editing.originalSlug } });
      if (r._status !== 200) {
        A.errors = r.errors || [r.message || 'Something went wrong saving that.'];
        A.editing = { ...A.editing, page: { ...A.editing.page, ...page, hosts: parseLines(page.hosts), cc: parseLines(page.cc), durations: String(page.durations).split(/[\s,]+/).map(Number).filter(Boolean) }, home };
        render();
        window.scrollTo({ top: 0 });
        return;
      }
      A.editing = null;
      A.errors = [];
      A.flash = `Saved “${r.page.title}”.`;
      await loadPages();
      window.scrollTo({ top: 0 });
      letThemKnow(r.page.slug);
    } else if (e.target.id === 'rules') {
      const body = { rules: Object.fromEntries(RULE_KEYS.map((k) => [k, Number(e.target.elements[k].value)])) };
      const r = await api('/api/settings', { method: 'PUT', body });
      if (r._status !== 200) return alert((r.errors || ['Could not save those rules.']).join('\n'));
      A.me.rules = r.rules;
      A.open.rules = false;
      A.flash = 'Saved your booking rules.';
      await loadPages();
    } else if (e.target.id === 'extras') {
      const r = await api('/api/settings', { method: 'PUT', body: { extraCalendars: e.target.elements.extra.value } });
      if (r._status !== 200) return alert((r.errors || ['Could not save those calendars.']).join('\n'));
      A.me.extraCalendars = r.extraCalendars;
      A.open.calendars = false;
      A.flash = 'Saved your calendars.';
      await loadPages();
    }
  });

  boot();
})();
