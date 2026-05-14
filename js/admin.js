/* ════════════════════════════════════════
   NEXORA — Admin portal
   Read/write access to every table for admins.
   100% Supabase-backed.
═══════════════════════════════════════════ */
(function () {
  const Auth = window.NexoraAuth;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function onReady(fn) {
    if (!document.body.classList.contains('auth-pending')) return fn();
    const obs = new MutationObserver(() => {
      if (!document.body.classList.contains('auth-pending')) { obs.disconnect(); fn(); }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  onReady(boot);

  /* ════════════════════════════════════════
     STATE
  ════════════════════════════════════════ */
  let sb, me, state;
  const VIEW_TITLES = {
    overview:      'Overview',
    users:         'Users',
    rfqs:          'Requests for Quotation',
    quotes:        'Quotes',
    threads:       'Conversations',
    notifications: 'Notifications'
  };

  /* ════════════════════════════════════════
     BOOT
  ════════════════════════════════════════ */
  async function boot() {
    sb = Auth.client();
    me = window.NEXORA_USER || (await Auth.getCurrentUser());
    if (!me || !me.user) {
      Auth.toast('Session expired. Please sign in again.', 'error');
      setTimeout(() => location.replace('auth.html'), 600);
      return;
    }

    state = {
      view: 'overview',
      stats: null,
      users: [],
      rfqs: [],
      quotes: [],
      threads: [],
      notifications: [],
      filter: { users: 'all', rfqs: 'all', quotes: 'all' },
      search: ''
    };

    wireUI();
    setView('overview');                 // show overview synchronously

    if (!sb) {
      Auth.toast('Connect Supabase in js/config.js to load admin data.', 'warn', { timeout: 6000 });
      return;
    }
    await loadEverything();
    rerenderAll();
    subscribeRealtime();
  }

  /* User-id lookup map, populated once profiles load.
     Used to attach minimal "who is this" info to rfqs/quotes/threads/notifs
     client-side, since rfqs.posted_by etc. FK to auth.users (not profiles)
     so PostgREST can't embed profiles directly. */
  let usersById = new Map();
  function buildUsersIndex() {
    usersById = new Map(state.users.map(u => [u.id, u]));
  }
  function userBlurb(id) {
    const u = usersById.get(id);
    if (!u) return { company: '', full_name: '', email: '' };
    return { company: u.company, full_name: u.full_name, email: u.email };
  }

  /* RFQ-id lookup so quotes can show their RFQ's product name */
  let rfqsById = new Map();
  function buildRfqsIndex() {
    rfqsById = new Map(state.rfqs.map(r => [r.id, r]));
  }

  async function loadEverything() {
    /* Stats + users first so the indexes are ready for the others */
    await Promise.allSettled([loadStats(), loadUsers()]);
    buildUsersIndex();
    await Promise.allSettled([loadRfqs(), loadQuotes(), loadThreads(), loadNotifications()]);
    buildRfqsIndex();
    /* Now decorate quotes with their rfq + manufacturer profile */
    state.quotes = state.quotes.map(q => ({
      ...q,
      profiles: userBlurb(q.manufacturer_id),
      rfqs:     rfqsById.get(q.rfq_id) || null
    }));
    state.rfqs = state.rfqs.map(r => ({
      ...r,
      profiles: userBlurb(r.posted_by)
    }));
    state.threads = state.threads.map(t => ({
      ...t,
      exporter: userBlurb(t.exporter_id),
      mfg:      userBlurb(t.manufacturer_id),
      rfqs:     rfqsById.get(t.rfq_id) || null
    }));
    state.notifications = state.notifications.map(n => ({
      ...n,
      profiles: userBlurb(n.user_id)
    }));
  }

  /* ════════════════════════════════════════
     DATA LAYER
  ════════════════════════════════════════ */
  async function loadStats() {
    const { data, error } = await sb.rpc('nexora_admin_stats');
    if (error) { console.warn('loadStats', error); return; }
    state.stats = data;
  }
  async function loadUsers() {
    const { data, error } = await sb.from('profiles')
      .select('*').order('created_at', { ascending: false });
    if (error) { console.warn('loadUsers', error); return; }
    state.users = data || [];
  }
  async function loadRfqs() {
    const { data, error } = await sb.from('rfqs')
      .select('*').order('created_at', { ascending: false }).limit(500);
    if (error) { console.warn('loadRfqs', error); return; }
    state.rfqs = data || [];
  }
  async function loadQuotes() {
    const { data, error } = await sb.from('quotes')
      .select('*').order('created_at', { ascending: false }).limit(500);
    if (error) { console.warn('loadQuotes', error); return; }
    state.quotes = data || [];
  }
  async function loadThreads() {
    const { data, error } = await sb.from('threads')
      .select('*').order('last_at', { ascending: false }).limit(500);
    if (error) { console.warn('loadThreads', error); return; }
    state.threads = data || [];
  }
  async function loadNotifications() {
    const { data, error } = await sb.from('notifications')
      .select('*').order('created_at', { ascending: false }).limit(500);
    if (error) { console.warn('loadNotifications', error); return; }
    state.notifications = data || [];
  }

  /* ════════════════════════════════════════
     REALTIME — keep the portal live
  ════════════════════════════════════════ */
  function subscribeRealtime() {
    const refresh = debounce(async () => { await loadEverything(); rerenderAll(); }, 600);
    sb.channel('admin-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' },     refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rfqs' },         refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' },       refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' },      refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' },refresh)
      .subscribe();
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /* ════════════════════════════════════════
     UI WIRING
  ════════════════════════════════════════ */
  function wireUI() {
    $$('.nav-item[data-section]').forEach(n =>
      n.addEventListener('click', e => { e.preventDefault(); setView(n.dataset.section); })
    );

    /* Filter pills (each view has its own) */
    $$('.pill[data-user-filter]').forEach(b => b.addEventListener('click', () => {
      $$('.pill[data-user-filter]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.filter.users = b.dataset.userFilter;
      renderUsers();
    }));
    $$('.pill[data-rfq-filter]').forEach(b => b.addEventListener('click', () => {
      $$('.pill[data-rfq-filter]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.filter.rfqs = b.dataset.rfqFilter;
      renderRfqs();
    }));
    $$('.pill[data-quote-filter]').forEach(b => b.addEventListener('click', () => {
      $$('.pill[data-quote-filter]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.filter.quotes = b.dataset.quoteFilter;
      renderQuotes();
    }));

    /* Search */
    const search = $('#admin-search-input');
    const clearBtn = $('#admin-search-clear');
    search.addEventListener('input', e => {
      state.search = e.target.value.trim().toLowerCase();
      search.parentElement.classList.toggle('has-value', !!state.search);
      rerenderCurrent();
    });
    clearBtn.addEventListener('click', () => {
      search.value = ''; state.search = '';
      search.parentElement.classList.remove('has-value');
      rerenderCurrent();
    });

    /* Refresh */
    $('#admin-refresh').addEventListener('click', async () => {
      $('#admin-refresh').disabled = true;
      await loadEverything();
      rerenderAll();
      $('#admin-refresh').disabled = false;
      Auth.toast('Refreshed.', 'info');
    });

    /* Confirm modal close */
    $$('[data-close-modal]').forEach(b => b.addEventListener('click', closeConfirm));
    $('#admin-confirm-modal').addEventListener('click', e => {
      if (e.target.id === 'admin-confirm-modal') closeConfirm();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeConfirm(); });
  }

  /* ════════════════════════════════════════
     VIEW SWITCHING
  ════════════════════════════════════════ */
  function setView(name) {
    state.view = name;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === name));
    $$('.view').forEach(v => {
      const isActive = v.dataset.view === name;
      v.classList.toggle('active', isActive);
    });
    const title = $('#topbar-section-title');
    if (title) title.textContent = VIEW_TITLES[name] || '';
    const search = $('#admin-search-input');
    if (search) search.placeholder = `Search ${VIEW_TITLES[name]?.toLowerCase() || 'this view'}…`;
    rerenderCurrent();
  }

  function rerenderAll() {
    renderOverview();
    renderUsers();
    renderRfqs();
    renderQuotes();
    renderThreads();
    renderNotifications();
    updateBadges();
  }
  function rerenderCurrent() {
    if (state.view === 'overview')      renderOverview();
    if (state.view === 'users')         renderUsers();
    if (state.view === 'rfqs')          renderRfqs();
    if (state.view === 'quotes')        renderQuotes();
    if (state.view === 'threads')       renderThreads();
    if (state.view === 'notifications') renderNotifications();
  }
  function updateBadges() {
    setText('#bd-users',   state.users.length);
    setText('#bd-rfqs',    state.rfqs.length);
    setText('#bd-quotes',  state.quotes.length);
    setText('#bd-threads', state.threads.length);
  }

  /* ════════════════════════════════════════
     RENDER — Overview
  ════════════════════════════════════════ */
  function renderOverview() {
    const s = state.stats || {};
    const grid = $('#overview-stats');
    grid.innerHTML = [
      stat('Total users',         s.users_total,         `${s.signups_24h || 0} new in 24h`),
      stat('Manufacturers',       s.users_manufacturer),
      stat('Exporters',           s.users_exporter),
      stat('Pending verification',s.users_pending,       null, s.users_pending > 0 ? 'danger' : ''),
      stat('Admins',              s.users_admins),

      stat('RFQs',                s.rfqs_total,          `${s.rfqs_24h || 0} new in 24h`),
      stat('Open RFQs',           s.rfqs_open),
      stat('Quoted RFQs',         s.rfqs_quoted),
      stat('Won RFQs',            s.rfqs_won,            null, 'success'),

      stat('Quotes',              s.quotes_total,        `${s.quotes_24h || 0} new in 24h`),
      stat('Quotes accepted',     s.quotes_accepted,     null, 'success'),

      stat('Conversations',       s.threads_total),
      stat('Messages',            s.messages_total),
      stat('Notifications',       s.notifications_total),
    ].join('');

    /* Recent activity = newest of (rfqs, quotes, users) */
    const activity = [
      ...state.rfqs.slice(0, 8).map(r => ({
        kind: 'rfq',
        text: `New RFQ — <strong>${esc(r.product)}</strong> by ${esc((r.profiles||{}).company || (r.profiles||{}).email || 'someone')} → ${esc(r.destination)}`,
        when: r.created_at
      })),
      ...state.quotes.slice(0, 8).map(q => ({
        kind: 'quote',
        text: `Quote on <strong>${esc((q.rfqs||{}).product || 'RFQ')}</strong> by ${esc((q.profiles||{}).company || (q.profiles||{}).email || 'someone')} — ${fmtMoney(q.unit_price)}`,
        when: q.created_at
      })),
      ...state.users.slice(0, 8).map(u => ({
        kind: 'signup',
        text: `New ${esc(u.role || 'user')} signed up — ${esc(u.company || u.full_name || u.email)}`,
        when: u.created_at
      }))
    ].sort((a, b) => (b.when || '').localeCompare(a.when || '')).slice(0, 12);

    const ae = $('#overview-activity');
    if (!activity.length) {
      ae.innerHTML = '<div class="admin-activity-empty">No activity yet. New events will appear here in real time.</div>';
    } else {
      ae.innerHTML = activity.map(a => `
        <div class="admin-activity-row">
          <span class="dot" aria-hidden="true"></span>
          <span>${a.text}</span>
          <span class="when">${fmtAgo(a.when)}</span>
        </div>`).join('');
    }
  }

  function stat(label, value, sub, mod = '') {
    return `
      <div class="admin-stat ${mod}">
        <span class="admin-stat-label">${esc(label)}</span>
        <span class="admin-stat-value">${value == null ? '—' : fmtNum(value)}</span>
        ${sub ? `<span class="admin-stat-sub">${esc(sub)}</span>` : ''}
      </div>`;
  }

  /* ════════════════════════════════════════
     RENDER — Users
  ════════════════════════════════════════ */
  function renderUsers() {
    const tbody = $('#users-tbody');
    if (!tbody) return;
    const q = state.search;
    const f = state.filter.users;
    let rows = state.users;
    if (f === 'manufacturer') rows = rows.filter(u => u.role === 'manufacturer');
    if (f === 'exporter')     rows = rows.filter(u => u.role === 'exporter');
    if (f === 'pending')      rows = rows.filter(u => u.role === 'manufacturer' && !u.verified_status);
    if (f === 'admin')        rows = rows.filter(u => u.is_admin);
    if (q) rows = rows.filter(u =>
      (u.email || '').toLowerCase().includes(q) ||
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.company || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q) ||
      (u.location || '').toLowerCase().includes(q));

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="empty-row" colspan="6">No users match.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(u => userRow(u)).join('');
    bindRowActions(tbody);
  }

  function userRow(u) {
    const display = u.company || u.full_name || u.email || '—';
    const status = u.is_admin ? 'admin' : (u.verified_status ? 'verified' : 'pending');
    const isMe = me && u.id === me.user.id;
    return `
      <tr data-id="${esc(u.id)}">
        <td>
          <span class="cell-name">${esc(display)}</span>
          <span class="cell-sub">${esc(u.email)}${isMe ? ' · <em>you</em>' : ''}</span>
        </td>
        <td><span class="role-pill ${esc(u.role || '')}">${esc(u.role || '—')}</span></td>
        <td>${u.industry ? esc(u.industry) : '<span class="cell-sub">—</span>'}</td>
        <td><span class="status-pill ${status}">${cap(status)}</span></td>
        <td>${fmtAgo(u.created_at)}</td>
        <td class="ta-right">
          <div class="row-actions">
            ${u.role === 'manufacturer' && !u.verified_status
              ? `<button class="row-action is-primary" data-action="verify"      data-id="${esc(u.id)}">Verify</button>`
              : u.verified_status
                ? `<button class="row-action"          data-action="unverify"    data-id="${esc(u.id)}">Unverify</button>`
                : ''}
            ${u.is_admin
              ? `<button class="row-action"          data-action="demote"      data-id="${esc(u.id)}" ${isMe ? 'disabled title="You can\'t demote yourself"' : ''}>Demote</button>`
              : `<button class="row-action"          data-action="promote"     data-id="${esc(u.id)}">Make admin</button>`}
            <button class="row-action is-danger"   data-action="delete-user" data-id="${esc(u.id)}" ${isMe ? 'disabled title="Use the profile page to delete your own account"' : ''}>Delete</button>
          </div>
        </td>
      </tr>`;
  }

  /* ════════════════════════════════════════
     RENDER — RFQs
  ════════════════════════════════════════ */
  function renderRfqs() {
    const tbody = $('#rfqs-tbody');
    if (!tbody) return;
    const q = state.search;
    const f = state.filter.rfqs;
    let rows = state.rfqs;
    if (f !== 'all') rows = rows.filter(r => r.status === f);
    if (q) rows = rows.filter(r =>
      (r.product || '').toLowerCase().includes(q) ||
      (r.destination || '').toLowerCase().includes(q) ||
      (r.industry || '').toLowerCase().includes(q) ||
      ((r.profiles||{}).email || '').toLowerCase().includes(q) ||
      ((r.profiles||{}).company || '').toLowerCase().includes(q));

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="empty-row" colspan="8">No RFQs match.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr data-id="${esc(r.id)}">
        <td>
          <span class="cell-name truncate">${esc(r.product)}</span>
          <span class="cell-sub cell-id">${esc((r.id||'').slice(0, 8))}</span>
        </td>
        <td>
          <span class="truncate">${esc((r.profiles||{}).company || (r.profiles||{}).full_name || '—')}</span>
          <span class="cell-sub">${esc((r.profiles||{}).email || '')}</span>
        </td>
        <td>${esc(r.industry || '—')}</td>
        <td>${esc(r.destination || '—')}</td>
        <td>${fmtNum(r.quantity)} ${esc(r.unit || '')}</td>
        <td><span class="status-pill ${esc(r.status || 'open')}">${cap(r.status || 'open')}</span></td>
        <td>${fmtAgo(r.created_at)}</td>
        <td class="ta-right">
          <div class="row-actions">
            <button class="row-action is-danger" data-action="delete-rfq" data-id="${esc(r.id)}">Delete</button>
          </div>
        </td>
      </tr>`).join('');
    bindRowActions(tbody);
  }

  /* ════════════════════════════════════════
     RENDER — Quotes
  ════════════════════════════════════════ */
  function renderQuotes() {
    const tbody = $('#quotes-tbody');
    if (!tbody) return;
    const q = state.search;
    const f = state.filter.quotes;
    let rows = state.quotes;
    if (f !== 'all') rows = rows.filter(x => x.status === f);
    if (q) rows = rows.filter(x =>
      ((x.rfqs||{}).product || '').toLowerCase().includes(q) ||
      ((x.profiles||{}).company || '').toLowerCase().includes(q) ||
      ((x.profiles||{}).email || '').toLowerCase().includes(q) ||
      (x.id || '').toLowerCase().includes(q));

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="empty-row" colspan="7">No quotes match.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(x => `
      <tr data-id="${esc(x.id)}">
        <td>
          <span class="cell-name truncate">${esc((x.rfqs||{}).product || '—')}</span>
          <span class="cell-sub cell-id">${esc((x.rfq_id||'').slice(0, 8))}</span>
        </td>
        <td>
          <span class="truncate">${esc((x.profiles||{}).company || (x.profiles||{}).full_name || '—')}</span>
          <span class="cell-sub">${esc((x.profiles||{}).email || '')}</span>
        </td>
        <td>${fmtMoney(x.unit_price)}</td>
        <td>${esc(x.lead_time || '—')}</td>
        <td><span class="status-pill ${esc(x.status || 'sent')}">${cap(x.status || 'sent')}</span></td>
        <td>${fmtAgo(x.created_at)}</td>
        <td class="ta-right">
          <div class="row-actions">
            <button class="row-action is-danger" data-action="delete-quote" data-id="${esc(x.id)}">Delete</button>
          </div>
        </td>
      </tr>`).join('');
    bindRowActions(tbody);
  }

  /* ════════════════════════════════════════
     RENDER — Threads
  ════════════════════════════════════════ */
  function renderThreads() {
    const tbody = $('#threads-tbody');
    if (!tbody) return;
    const q = state.search;
    let rows = state.threads;
    if (q) rows = rows.filter(t =>
      ((t.exporter||{}).email || '').toLowerCase().includes(q) ||
      ((t.mfg||{}).email || '').toLowerCase().includes(q) ||
      ((t.rfqs||{}).product || '').toLowerCase().includes(q) ||
      (t.last_preview || '').toLowerCase().includes(q));

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="empty-row" colspan="7">No conversations.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(t => `
      <tr data-id="${esc(t.id)}">
        <td><span class="cell-id">${esc((t.id||'').slice(0, 8))}</span></td>
        <td><span class="truncate">${esc((t.exporter||{}).company || (t.exporter||{}).email || '—')}</span></td>
        <td><span class="truncate">${esc((t.mfg||{}).company || (t.mfg||{}).email || '—')}</span></td>
        <td><span class="truncate">${esc((t.rfqs||{}).product || '—')}</span></td>
        <td><span class="truncate">${esc(t.last_preview || '—')}</span></td>
        <td>${fmtAgo(t.last_at)}</td>
        <td class="ta-right">
          <div class="row-actions">
            <button class="row-action is-danger" data-action="delete-thread" data-id="${esc(t.id)}">Delete</button>
          </div>
        </td>
      </tr>`).join('');
    bindRowActions(tbody);
  }

  /* ════════════════════════════════════════
     RENDER — Notifications
  ════════════════════════════════════════ */
  function renderNotifications() {
    const tbody = $('#notifications-tbody');
    if (!tbody) return;
    const q = state.search;
    let rows = state.notifications;
    if (q) rows = rows.filter(n =>
      ((n.profiles||{}).email || '').toLowerCase().includes(q) ||
      (n.kind || '').toLowerCase().includes(q) ||
      (n.body_html || '').toLowerCase().includes(q));

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="empty-row" colspan="6">No notifications.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(n => `
      <tr data-id="${esc(n.id)}">
        <td>
          <span class="cell-name truncate">${esc((n.profiles||{}).company || (n.profiles||{}).email || '—')}</span>
        </td>
        <td><span class="status-pill ${esc(n.kind)}">${esc(n.kind)}</span></td>
        <td><span class="truncate">${n.body_html /* trusted DB-generated */ || esc(n.body || '')}</span></td>
        <td><span class="status-pill ${n.read_at ? 'verified' : 'pending'}">${n.read_at ? 'Read' : 'Unread'}</span></td>
        <td>${fmtAgo(n.created_at)}</td>
        <td class="ta-right">
          <div class="row-actions">
            <button class="row-action is-danger" data-action="delete-notif" data-id="${esc(n.id)}">Delete</button>
          </div>
        </td>
      </tr>`).join('');
    bindRowActions(tbody);
  }

  /* ════════════════════════════════════════
     ROW ACTIONS — bind & dispatch
  ════════════════════════════════════════ */
  function bindRowActions(scope) {
    scope.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.id, btn));
    });
  }

  async function handleAction(action, id, btn) {
    if (!id) return;
    const target = findTargetByAction(action, id);
    const label  = describeTarget(action, target);

    switch (action) {
      case 'verify':       return confirmAndRun('Verify this manufacturer?', label, () => updateProfile(id, { verified_status: true }));
      case 'unverify':     return confirmAndRun('Revoke verification?',      label, () => updateProfile(id, { verified_status: false }));
      case 'promote':      return confirmAndRun('Promote to admin?',         label, () => updateProfile(id, { is_admin: true }));
      case 'demote':       return confirmAndRun('Revoke admin status?',      label, () => updateProfile(id, { is_admin: false }));
      case 'delete-user':  return confirmAndRun('Permanently delete this user?', label, () => deleteUser(id), { danger: true });
      case 'delete-rfq':   return confirmAndRun('Delete this RFQ?', label, () => deleteRow('rfqs', id),   { danger: true });
      case 'delete-quote': return confirmAndRun('Delete this quote?', label, () => deleteRow('quotes', id), { danger: true });
      case 'delete-thread':return confirmAndRun('Delete this conversation?', label, () => deleteRow('threads', id), { danger: true });
      case 'delete-notif': return confirmAndRun('Delete this notification?', label, () => deleteRow('notifications', id), { danger: false });
    }
  }

  function findTargetByAction(action, id) {
    if (action === 'verify' || action === 'unverify' || action === 'promote' || action === 'demote' || action === 'delete-user')
      return state.users.find(u => u.id === id);
    if (action === 'delete-rfq')   return state.rfqs.find(r => r.id === id);
    if (action === 'delete-quote') return state.quotes.find(q => q.id === id);
    if (action === 'delete-thread')return state.threads.find(t => t.id === id);
    if (action === 'delete-notif') return state.notifications.find(n => n.id === id);
    return null;
  }
  function describeTarget(action, t) {
    if (!t) return '';
    if (action === 'verify' || action === 'unverify' || action === 'promote' || action === 'demote' || action === 'delete-user')
      return t.company || t.full_name || t.email || '';
    if (action === 'delete-rfq')   return `RFQ — ${t.product}`;
    if (action === 'delete-quote') return `Quote on ${(t.rfqs||{}).product || 'RFQ'}`;
    if (action === 'delete-thread')return `Conversation ${(t.id||'').slice(0,8)}`;
    if (action === 'delete-notif') return 'Notification';
    return '';
  }

  /* ════════════════════════════════════════
     CONFIRM MODAL
  ════════════════════════════════════════ */
  function confirmAndRun(title, sub, runner, opts = {}) {
    $('#ac-title').textContent = title;
    $('#ac-sub').textContent   = sub || '';
    const go = $('#ac-go');
    go.textContent = opts.danger ? 'Delete' : 'Confirm';
    go.className   = 'btn-danger';
    go.onclick = async () => {
      go.disabled = true;
      try {
        await runner();
        Auth.toast('Done.', 'success');
        closeConfirm();
        await loadEverything();
        rerenderAll();
      } catch (err) {
        console.warn('admin action failed', err);
        Auth.toast(err.message || 'Action failed.', 'error');
        go.disabled = false;
      }
    };
    openConfirm();
  }
  function openConfirm()  { $('#admin-confirm-modal').classList.add('show'); document.body.style.overflow = 'hidden'; }
  function closeConfirm() {
    $('#admin-confirm-modal').classList.remove('show');
    document.body.style.overflow = '';
    const go = $('#ac-go');
    if (go) { go.disabled = false; go.onclick = null; }
  }

  /* ════════════════════════════════════════
     WRITES — use the admin RLS override + RPC
  ════════════════════════════════════════ */
  async function updateProfile(id, patch) {
    const { error } = await sb.from('profiles').update(patch).eq('id', id);
    if (error) throw error;
  }
  async function deleteRow(table, id) {
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) throw error;
  }
  async function deleteUser(id) {
    const { error } = await sb.rpc('nexora_admin_delete_user', { target: id });
    if (error) throw error;
  }

  /* ════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════ */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function fmtNum(n)   { return Number(n ?? 0).toLocaleString('en-US'); }
  function fmtMoney(n) { return n == null ? '—' : '$' + Number(n).toFixed(2); }
  function fmtAgo(iso) {
    if (!iso) return '—';
    const min = (Date.now() - new Date(iso).getTime()) / 60_000;
    if (min < 1)   return 'just now';
    if (min < 60)  return Math.floor(min) + 'm ago';
    const h = min / 60;
    if (h < 24)    return Math.floor(h) + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
  function cap(s) { return String(s || '').replace(/^./, c => c.toUpperCase()); }
  function setText(sel, v) { const el = $(sel); if (el) el.textContent = v; }
})();
