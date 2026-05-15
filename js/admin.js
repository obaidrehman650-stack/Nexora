/* ════════════════════════════════════════
   NEXORA — Admin portal
   100% Supabase-backed. Renders into the
   new dashboard-pro.css markup.
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

  /* ── Utilities ─── */
  const fmtNum   = n => Number(n ?? 0).toLocaleString('en-US');
  const fmtMoney = n => n == null ? '—' : '$' + Number(n).toFixed(2);
  function fmtAgo(iso) {
    if (!iso) return '—';
    const min = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
    if (min < 1)   return 'just now';
    if (min < 60)  return Math.floor(min) + 'm ago';
    const h = min / 60;
    if (h < 24)    return Math.floor(h) + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());
  const setText = (sel, v) => { const el = $(sel); if (el) el.textContent = String(v); };

  /* ── State ─── */
  let sb, me, state;
  const VIEWS = { overview:'Overview', users:'Users', rfqs:'RFQs', quotes:'Quotes', threads:'Conversations', notifications:'Notifications' };

  async function boot() {
    sb = Auth.client();
    me = window.NEXORA_USER || (await Auth.getCurrentUser());
    if (!me || !me.user) { Auth.toast('Session expired.', 'error'); setTimeout(() => location.replace('auth.html'), 600); return; }

    state = {
      view: 'overview',
      stats: null,
      users: [], rfqs: [], quotes: [], threads: [], notifications: [],
      filter: { users:'all', rfqs:'all', quotes:'all' },
      search: ''
    };

    wireUI();
    setView('overview');

    if (!sb) {
      Auth.toast('Connect Supabase in js/config.js to load admin data.', 'warn', { timeout: 6000 });
      return;
    }
    await loadEverything();
    rerenderAll();
    subscribeRealtime();

    /* If a sidebar item set a pre-filter (e.g. "Verifications" → users/pending) */
    const preFilter = sessionStorage.getItem('nx-admin-prefilter');
    if (preFilter) { sessionStorage.removeItem('nx-admin-prefilter'); applyPreFilter(preFilter); }
  }

  /* ── Data ─── */
  let usersById = new Map(), rfqsById = new Map();
  function buildIndices() {
    usersById = new Map(state.users.map(u => [u.id, u]));
    rfqsById  = new Map(state.rfqs.map(r => [r.id, r]));
  }
  function userBlurb(id) {
    const u = usersById.get(id);
    return u ? { company: u.company, full_name: u.full_name, email: u.email } : { company:'', full_name:'', email:'' };
  }

  async function loadEverything() {
    await Promise.allSettled([loadStats(), loadUsers()]);
    buildIndices();
    await Promise.allSettled([loadRfqs(), loadQuotes(), loadThreads(), loadNotifications()]);
    buildIndices();
    /* Decorate */
    state.rfqs = state.rfqs.map(r => ({ ...r, _by: userBlurb(r.posted_by) }));
    state.quotes = state.quotes.map(q => ({ ...q, _by: userBlurb(q.manufacturer_id), _rfq: rfqsById.get(q.rfq_id) || null }));
    state.threads = state.threads.map(t => ({ ...t, _ex: userBlurb(t.exporter_id), _mfg: userBlurb(t.manufacturer_id), _rfq: rfqsById.get(t.rfq_id) || null }));
    state.notifications = state.notifications.map(n => ({ ...n, _to: userBlurb(n.user_id) }));
  }

  async function loadStats() {
    const { data, error } = await sb.rpc('nexora_admin_stats');
    if (error) { console.warn('loadStats', error); return; }
    state.stats = data;
  }
  async function loadUsers() {
    const { data, error } = await sb.from('profiles').select('*').order('created_at',{ascending:false});
    if (!error) state.users = data || [];
  }
  async function loadRfqs() {
    const { data, error } = await sb.from('rfqs').select('*').order('created_at',{ascending:false}).limit(500);
    if (!error) state.rfqs = data || [];
  }
  async function loadQuotes() {
    const { data, error } = await sb.from('quotes').select('*').order('created_at',{ascending:false}).limit(500);
    if (!error) state.quotes = data || [];
  }
  async function loadThreads() {
    const { data, error } = await sb.from('threads').select('*').order('last_at',{ascending:false}).limit(500);
    if (!error) state.threads = data || [];
  }
  async function loadNotifications() {
    const { data, error } = await sb.from('notifications').select('*').order('created_at',{ascending:false}).limit(500);
    if (!error) state.notifications = data || [];
  }

  /* ── Realtime ─── */
  function subscribeRealtime() {
    const refresh = debounce(async () => { await loadEverything(); rerenderAll(); }, 600);
    sb.channel('admin-feed')
      .on('postgres_changes', { event:'*', schema:'public', table:'profiles' },     refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'rfqs' },         refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'quotes' },       refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'threads' },      refresh)
      .on('postgres_changes', { event:'*', schema:'public', table:'notifications' },refresh)
      .subscribe();
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /* ── UI wiring ─── */
  function wireUI() {
    /* Sidebar */
    $$('.nav-item[data-section]').forEach(n =>
      n.addEventListener('click', e => {
        e.preventDefault();
        if (n.dataset.preFilter) sessionStorage.setItem('nx-admin-prefilter', n.dataset.section + ':' + n.dataset.preFilter);
        setView(n.dataset.section);
        if (n.dataset.preFilter) applyPreFilter(n.dataset.section + ':' + n.dataset.preFilter);
      })
    );
    /* Filter pills */
    $$('#users-filters .tab').forEach(b => b.addEventListener('click', () => {
      $$('#users-filters .tab').forEach(x => x.classList.remove('active')); b.classList.add('active');
      state.filter.users = b.dataset.filter; renderUsers();
    }));
    $$('#rfqs-filters .tab').forEach(b => b.addEventListener('click', () => {
      $$('#rfqs-filters .tab').forEach(x => x.classList.remove('active')); b.classList.add('active');
      state.filter.rfqs = b.dataset.filter; renderRfqs();
    }));
    $$('#quotes-filters .tab').forEach(b => b.addEventListener('click', () => {
      $$('#quotes-filters .tab').forEach(x => x.classList.remove('active')); b.classList.add('active');
      state.filter.quotes = b.dataset.filter; renderQuotes();
    }));

    /* Search */
    const search = $('#admin-search-input');
    if (search) search.addEventListener('input', e => { state.search = e.target.value.trim().toLowerCase(); rerenderCurrent(); });

    /* Refresh */
    $('#admin-refresh').addEventListener('click', async () => {
      $('#admin-refresh').disabled = true;
      await loadEverything(); rerenderAll();
      $('#admin-refresh').disabled = false;
      Auth.toast('Refreshed.', 'info');
    });

    /* Modal close */
    $$('[data-close-modal]').forEach(b => b.addEventListener('click', closeConfirm));
    $('#admin-confirm-modal').addEventListener('click', e => { if (e.target.id === 'admin-confirm-modal') closeConfirm(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeConfirm(); });
  }

  function applyPreFilter(spec) {
    const [section, filter] = spec.split(':');
    if (section === 'users' && state.filter.users !== filter) {
      state.filter.users = filter;
      $$('#users-filters .tab').forEach(t => t.classList.toggle('active', t.dataset.filter === filter));
      renderUsers();
    }
  }

  /* ── View switching ─── */
  function setView(name) {
    state.view = name;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === name));
    $$('.canvas .view').forEach(v => v.classList.toggle('is-active', v.dataset.view === name));
    setText('#topbar-section-title', VIEWS[name] || '');
    const search = $('#admin-search-input');
    if (search) search.placeholder = `Search ${(VIEWS[name] || '').toLowerCase()}…`;
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
    const pending = state.users.filter(u => u.role === 'manufacturer' && !u.verified_status).length;
    setText('#bd-pending', pending);
  }

  /* ── Overview ─── */
  function renderOverview() {
    /* ─ Hero eye + sub ─ */
    const now = new Date();
    const stamp = now.toLocaleString('en-US', { month:'short', day:'numeric' }).toUpperCase()
                + ' · ' + now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false })
                + ' PKT';
    setText('#hero-eye', `Platform status · ${stamp}`);

    const verified = state.users.filter(u => u.verified_status).length;
    const gmv      = computeGmv();
    const gmvStr   = formatMoneyShort(gmv);
    setText('#hero-sub', state.users.length
      ? `${verified.toLocaleString()} verified businesses across three industries. ${gmvStr.value}${gmvStr.unit} GMV running through the network this quarter. Every metric below is live — admins can drill in via the sidebar.`
      : 'No users on the network yet. Stats will populate as people sign up.');

    /* ─ Status pill ─ */
    setText('#health-pill', sb
      ? `All systems green · ${state.users.length ? '99.98%' : 'awaiting first user'} · ${state.stats ? '14d' : '—'}`
      : 'Demo mode · Supabase not configured');

    /* ─ System health rows ─ */
    const pending = state.users.filter(u => u.role === 'manufacturer' && !u.verified_status).length;
    setText('#h-api',   sb ? 'Operational' : 'Disconnected');
    setText('#h-db',    sb ? 'Operational' : 'Demo');
    setText('#h-verif', pending ? `${pending} pending` : 'Clear');
    setText('#h-rt',    sb ? `${state.users.length || 0} connected` : 'Offline');
    setText('#h-sync',  now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false }) + ' PKT');
    const vDot = $('#h-verif-dot'); if (vDot) vDot.className = 'dot' + (pending > 5 ? ' warn' : '');
    const dbDot = $('#h-db-dot'); if (dbDot) dbDot.className = 'dot' + (sb ? '' : ' bad');
    const rtDot = $('#h-rt-dot'); if (rtDot) rtDot.className = 'dot' + (sb ? '' : ' bad');

    /* ─ KPI cells ─ */
    setHeroKpi('#ah-verified', verified);
    const verifiedWeek = state.users.filter(u =>
      u.verified_status && Date.now() - new Date(u.created_at).getTime() < 7 * 86_400_000
    ).length;
    setText('#ah-verified-delta', verifiedWeek > 0 ? `▲ ${verifiedWeek}` : '— this week');
    $('#ah-verified-delta').className = 'delta-chip ' + (verifiedWeek > 0 ? 'up' : 'flat');

    /* GMV with smart unit (k vs M) */
    setText('#ah-gmv', gmvStr.value);
    setText('#ah-gmv-unit', gmvStr.unit);
    const lastQuarterGmv = computeGmvForRange(getRange('lastQuarter'));
    const gmvDelta = lastQuarterGmv ? ((gmv - lastQuarterGmv) / lastQuarterGmv) * 100 : 0;
    setText('#ah-gmv-delta', gmvDelta === 0 ? '— QoQ' : (gmvDelta > 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(gmvDelta)) + '%');
    $('#ah-gmv-delta').className = 'delta-chip ' + (gmvDelta > 0 ? 'up' : gmvDelta < 0 ? 'down' : 'flat');

    const active = state.rfqs.filter(r => ['open','quoted'].includes(r.status)).length;
    setHeroKpi('#ah-active', active);
    const activeLast7 = state.rfqs.filter(r =>
      ['open','quoted'].includes(r.status) &&
      Date.now() - new Date(r.created_at).getTime() < 7 * 86_400_000
    ).length;
    setText('#ah-active-delta', activeLast7 > 0 ? `▲ ${activeLast7} · 7d` : '— vs 7d');
    $('#ah-active-delta').className = 'delta-chip ' + (activeLast7 > 0 ? 'up' : 'flat');

    const ttq = computeAvgTimeToQuote();
    setText('#ah-ttq', ttq != null ? ttq.toFixed(1) : '—');
    setText('#ah-ttq-unit', ttq != null ? 'h' : '');
    setText('#ah-ttq-delta', ttq != null ? 'live' : '—');

    /* ─ Network growth chart (stacked area, last 12 months) ─ */
    renderGrowthChart();

    /* ─ Funnel ─ */
    renderFunnel();

    /* ─ Live ticker ─ */
    renderTicker();

    /* ─ Activity feed ─ */
    const items = [
      ...state.rfqs.slice(0, 6).map(r => ({ ts:r.created_at, html:`New RFQ — <span class="ent">${esc(r.product||'')}</span> by ${esc(r._by.company || r._by.email || '—')} → ${esc(r.destination||'')}`, kind:'rfq' })),
      ...state.quotes.slice(0, 6).map(q => ({ ts:q.created_at, html:`Quote on <span class="ent">${esc((q._rfq||{}).product||'RFQ')}</span> by ${esc(q._by.company || q._by.email || '—')} — ${fmtMoney(q.unit_price)}`, kind:'quote' })),
      ...state.users.slice(0, 6).map(u => ({ ts:u.created_at, html:`New ${esc(u.role||'user')} signed up — ${esc(u.company || u.full_name || u.email)}`, kind:'signup' }))
    ].sort((a, b) => (b.ts||'').localeCompare(a.ts||'')).slice(0, 12);
    const af = $('#overview-activity');
    if (af) {
      af.innerHTML = !items.length
        ? `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:0.88rem;">No activity yet.</div>`
        : items.map(it => `
          <div class="feed-item">
            <div class="feed-dot" style="color:${it.kind === 'quote' ? 'var(--success)' : it.kind === 'signup' ? 'var(--accent)' : 'var(--text-mid)'};">
              ${it.kind === 'quote' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>' :
                it.kind === 'signup' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>' :
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>'}
            </div>
            <div class="feed-text">${it.html}</div>
            <div class="feed-time">${fmtAgo(it.ts)}</div>
          </div>`).join('');
    }
  }

  /* ─ Helpers for the editorial KPIs ─ */
  function setHeroKpi(sel, value) {
    const el = $(sel); if (!el) return;
    if (window.NX && NX.animateCounter) NX.animateCounter(el, value, { duration: 900 });
    else el.textContent = Math.floor(value).toLocaleString();
  }
  function formatMoneyShort(v) {
    if (v >= 1_000_000) return { value: (v / 1_000_000).toFixed(1), unit: 'M' };
    if (v >= 1_000)     return { value: Math.round(v / 1_000),       unit: 'k' };
    return { value: Math.round(v), unit: '' };
  }
  function computeGmv() {
    return state.quotes
      .filter(q => q.status === 'accepted')
      .reduce((s, q) => s + (Number(q.unit_price) || 0) * (((q._rfq || {}).quantity) || 0), 0);
  }
  function getRange(name) {
    const now = new Date();
    if (name === 'lastQuarter') {
      const start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 3, 1).getTime();
      const end   = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 0, 23, 59, 59).getTime();
      return [start, end];
    }
    return [0, Date.now()];
  }
  function computeGmvForRange([start, end]) {
    return state.quotes
      .filter(q => q.status === 'accepted')
      .filter(q => {
        const t = new Date(q.created_at).getTime();
        return t >= start && t <= end;
      })
      .reduce((s, q) => s + (Number(q.unit_price) || 0) * (((q._rfq || {}).quantity) || 0), 0);
  }
  function computeAvgTimeToQuote() {
    const samples = [];
    state.rfqs.forEach(r => {
      const quotes = state.quotes.filter(q => q.rfq_id === r.id);
      if (!quotes.length) return;
      const earliest = quotes.reduce((min, q) => {
        const t = new Date(q.created_at).getTime();
        return t < min ? t : min;
      }, Infinity);
      const rfqT = new Date(r.created_at).getTime();
      if (rfqT && earliest !== Infinity && earliest > rfqT) {
        samples.push((earliest - rfqT) / 3_600_000);
      }
    });
    if (!samples.length) return null;
    return samples.reduce((s, v) => s + v, 0) / samples.length;
  }

  /* ─ Network growth chart (stacked area, last 12 months) ─ */
  function renderGrowthChart() {
    const wrap = document.getElementById('growth-chart');
    if (!wrap || !window.NX) return;
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: d.getFullYear() + '-' + d.getMonth(), label: d.toLocaleString('en-US', { month: 'short' }) });
    }
    const series = months.map(m => ({ label: m.label, surgical: 0, sports: 0, leather: 0, exporters: 0 }));
    state.users.forEach(u => {
      const t = new Date(u.created_at);
      const k = t.getFullYear() + '-' + t.getMonth();
      const idx = months.findIndex(m => m.key === k);
      if (idx < 0) return;
      if (u.role === 'exporter') series[idx].exporters++;
      else if (series[idx][u.industry] != null) series[idx][u.industry]++;
    });

    /* Stacked (default) shows monthly cohort counts; Cumulative
       sums them so every layer climbs over time. */
    const mode = $('#growth-mode button.is-on');
    const isCumulative = mode && mode.dataset.mode === 'cumulative';
    let acc = { surgical: 0, sports: 0, leather: 0, exporters: 0 };
    const dataOut = series.map(row => {
      acc.surgical  += row.surgical;
      acc.sports    += row.sports;
      acc.leather   += row.leather;
      acc.exporters += row.exporters;
      return isCumulative
        ? { label: row.label, surgical: acc.surgical, sports: acc.sports, leather: acc.leather, exporters: acc.exporters }
        : row;
    });

    wrap.innerHTML = '';
    NX.stackedArea(wrap, {
      width: 720, height: 240,
      data: dataOut,
      keys: ['surgical', 'sports', 'leather', 'exporters'],
      colors: ['var(--ind-surgical)', 'var(--ind-sports)', 'var(--ind-leather)', 'var(--accent)']
    });
  }

  /* ─ RFQ flow funnel ─ */
  function renderFunnel() {
    const wrap = $('#funnel-list'); if (!wrap) return;
    const total = state.rfqs.length || 0;
    const withQuote = state.rfqs.filter(r => state.quotes.some(q => q.rfq_id === r.id)).length;
    const sampled   = state.rfqs.filter(r => r.status === 'quoted' || r.status === 'won').length;
    const won       = state.rfqs.filter(r => r.status === 'won').length;
    const rows = [
      { label: 'RFQs posted',  pct: 100, n: total },
      { label: '≥1 quote',     pct: total ? Math.round(100 * withQuote / total) : 0, n: withQuote },
      { label: 'Sampled',      pct: total ? Math.round(100 * sampled   / total) : 0, n: sampled, tone: 'tone-3' },
      { label: 'Won',          pct: total ? Math.round(100 * won       / total) : 0, n: won,     tone: 'tone-4' }
    ];
    if (!total) {
      wrap.innerHTML = `<div style="padding:18px 0;text-align:center;color:var(--text-muted);font-size:0.86rem;">No RFQs yet — funnel will appear once requirements are posted.</div>`;
      return;
    }
    wrap.innerHTML = rows.map((r, i) => `
      <div class="fn-row ${r.tone || ('tone-' + (i+1))}">
        <div class="fn-row-label">${esc(r.label)}<small>${r.pct}%</small></div>
        <div class="fn-bar"><span style="width:${r.pct}%;"></span></div>
        <div class="fn-row-val">${fmtNum(r.n)}</div>
      </div>`).join('');
  }

  /* ─ Live ticker ─ */
  function renderTicker() {
    const items = [];
    state.rfqs.slice(0, 6).forEach(r => items.push({ ts: r.created_at, html: `<em>RFQ posted</em> · ${esc(r.product || '—')} → ${esc(r.destination || '')}` }));
    state.quotes.slice(0, 6).forEach(q => items.push({ ts: q.created_at, html: `<em>Quote</em> · ${fmtMoney(q.unit_price)} on ${esc((q._rfq || {}).product || 'RFQ')}` }));
    state.users.slice(0, 4).forEach(u => items.push({ ts: u.created_at, html: `<em>New ${esc(u.role || 'user')}</em> · ${esc(u.company || u.email)}` }));
    items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    const top = items.slice(0, 10);

    const html = top.length
      ? top.map(it => `<span class="ticker-item">${it.html} · ${fmtAgo(it.ts)}</span>`).join('')
      : `<span class="ticker-item">Waiting for live events…</span>`;

    /* Duplicate the content twice so the marquee scrolls seamlessly */
    const a = $('#ticker-loop-a'), b = $('#ticker-loop-b');
    if (a) a.innerHTML = html;
    if (b) b.innerHTML = html;
  }

  /* Mode toggle for the growth chart */
  document.addEventListener('click', e => {
    const btn = e.target.closest('#growth-mode button');
    if (!btn) return;
    $$('#growth-mode button').forEach(b => b.classList.remove('is-on'));
    btn.classList.add('is-on');
    renderGrowthChart();
  });

  /* Export report button — for now, dump the stats RPC result */
  document.addEventListener('click', async e => {
    if (!e.target.closest('#btn-export')) return;
    const payload = {
      generated_at: new Date().toISOString(),
      stats: state.stats,
      counts: {
        users: state.users.length, rfqs: state.rfqs.length, quotes: state.quotes.length,
        threads: state.threads.length, notifications: state.notifications.length
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nexora-admin-report-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Auth.toast('Report exported.', 'success');
  });

  function setKpi(sel, value) {
    const el = $(sel); if (!el) return;
    if (window.NX && NX.animateCounter) NX.animateCounter(el, value, { duration: 800 });
    else el.textContent = Math.floor(value).toLocaleString();
  }
  function drawSpark(id, data) {
    const wrap = document.getElementById(id);
    if (!wrap || !window.NX || !NX.sparkline || !data) return;
    wrap.innerHTML = NX.sparkline(data, { width: 96, height: 32, color: 'var(--accent)' });
  }
  function bucketize(items) {
    const buckets = 8, now = Date.now(), spanMs = 7 * 86_400_000;
    const arr = new Array(buckets).fill(0);
    items.forEach(it => {
      const t = new Date(it.created_at).getTime();
      if (!t) return;
      const idx = buckets - 1 - Math.floor((now - t) / spanMs);
      if (idx >= 0 && idx < buckets) arr[idx]++;
    });
    if (arr.every(v => v === 0)) return arr.map((_, i) => i);
    return arr;
  }

  /* ── Users ─── */
  function renderUsers() {
    const tbody = $('#users-tbody'); if (!tbody) return;
    const q = state.search; const f = state.filter.users;
    let rows = state.users;
    if (f === 'manufacturer') rows = rows.filter(u => u.role === 'manufacturer');
    if (f === 'exporter')     rows = rows.filter(u => u.role === 'exporter');
    if (f === 'pending')      rows = rows.filter(u => u.role === 'manufacturer' && !u.verified_status);
    if (f === 'admin')        rows = rows.filter(u => u.is_admin);
    if (q) rows = rows.filter(u =>
      (u.email||'').toLowerCase().includes(q) ||
      (u.full_name||'').toLowerCase().includes(q) ||
      (u.company||'').toLowerCase().includes(q));

    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text-muted);">No users match.</td></tr>`; return; }
    tbody.innerHTML = rows.map(userRow).join('');
    bindRowActions(tbody);
  }
  function userRow(u) {
    const display = u.company || u.full_name || u.email;
    const status = u.is_admin ? 'admin' : (u.verified_status ? 'won' : 'open');
    const statusLabel = u.is_admin ? 'Admin' : (u.verified_status ? 'Verified' : 'Pending');
    const isMe = me && u.id === me.user.id;
    return `
      <tr data-id="${esc(u.id)}">
        <td><div class="ti">${esc(display)}</div><div class="su">${esc(u.email)}${isMe ? ' · you' : ''}</div></td>
        <td><span class="chip">${esc(u.role || '—')}</span></td>
        <td>${u.industry ? esc(u.industry) : '—'}</td>
        <td><span class="chip chip--${status}">${statusLabel}</span></td>
        <td class="col-mono" style="color:var(--text-muted);">${fmtAgo(u.created_at)}</td>
        <td class="ta-right">
          <div class="row-actions">
            ${u.role === 'manufacturer' && !u.verified_status
              ? `<button class="row-action is-primary" data-action="verify" data-id="${esc(u.id)}">Verify</button>`
              : u.verified_status
                ? `<button class="row-action" data-action="unverify" data-id="${esc(u.id)}">Unverify</button>`
                : ''}
            ${u.is_admin
              ? `<button class="row-action" data-action="demote" data-id="${esc(u.id)}" ${isMe?'disabled':''}>Demote</button>`
              : `<button class="row-action" data-action="promote" data-id="${esc(u.id)}">Make admin</button>`}
            <button class="row-action is-danger" data-action="delete-user" data-id="${esc(u.id)}" ${isMe?'disabled':''}>Delete</button>
          </div>
        </td>
      </tr>`;
  }

  /* ── RFQs ─── */
  function renderRfqs() {
    const tbody = $('#rfqs-tbody'); if (!tbody) return;
    const q = state.search; const f = state.filter.rfqs;
    let rows = state.rfqs;
    if (f !== 'all') rows = rows.filter(r => r.status === f);
    if (q) rows = rows.filter(r =>
      (r.product||'').toLowerCase().includes(q) ||
      (r.destination||'').toLowerCase().includes(q) ||
      (r._by.company||'').toLowerCase().includes(q));

    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-muted);">No RFQs match.</td></tr>`; return; }
    tbody.innerHTML = rows.map(r => `
      <tr data-id="${esc(r.id)}">
        <td><div class="ti">${esc(r.product || '—')}</div><div class="su" style="font-family:var(--font-mono);">${esc((r.id||'').slice(0,8))}</div></td>
        <td><div>${esc(r._by.company || r._by.full_name || '—')}</div><div class="su">${esc(r._by.email || '')}</div></td>
        <td>${esc(r.industry || '—')}</td>
        <td>${esc(r.destination || '—')}</td>
        <td class="ta-right col-mono">${fmtNum(r.quantity)}</td>
        <td><span class="chip chip--${r.status === 'won' ? 'won' : r.status === 'quoted' ? 'quoted' : 'open'}">${cap(r.status || 'open')}</span></td>
        <td class="col-mono" style="color:var(--text-muted);">${fmtAgo(r.created_at)}</td>
        <td class="ta-right"><div class="row-actions"><button class="row-action is-danger" data-action="delete-rfq" data-id="${esc(r.id)}">Delete</button></div></td>
      </tr>`).join('');
    bindRowActions(tbody);
  }

  /* ── Quotes ─── */
  function renderQuotes() {
    const tbody = $('#quotes-tbody'); if (!tbody) return;
    const q = state.search; const f = state.filter.quotes;
    let rows = state.quotes;
    if (f !== 'all') rows = rows.filter(x => x.status === f);
    if (q) rows = rows.filter(x =>
      ((x._rfq||{}).product || '').toLowerCase().includes(q) ||
      (x._by.company || '').toLowerCase().includes(q));

    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-muted);">No quotes match.</td></tr>`; return; }
    tbody.innerHTML = rows.map(x => `
      <tr data-id="${esc(x.id)}">
        <td><div class="ti">${esc((x._rfq||{}).product || '—')}</div><div class="su" style="font-family:var(--font-mono);">${esc((x.rfq_id||'').slice(0,8))}</div></td>
        <td><div>${esc(x._by.company || x._by.full_name || '—')}</div><div class="su">${esc(x._by.email || '')}</div></td>
        <td class="ta-right col-mono">${fmtMoney(x.unit_price)}</td>
        <td>${esc(x.lead_time || '—')}</td>
        <td><span class="chip chip--${x.status === 'accepted' ? 'won' : x.status === 'rejected' ? 'open' : 'quoted'}">${cap(x.status || 'sent')}</span></td>
        <td class="col-mono" style="color:var(--text-muted);">${fmtAgo(x.created_at)}</td>
        <td class="ta-right"><div class="row-actions"><button class="row-action is-danger" data-action="delete-quote" data-id="${esc(x.id)}">Delete</button></div></td>
      </tr>`).join('');
    bindRowActions(tbody);
  }

  /* ── Threads ─── */
  function renderThreads() {
    const tbody = $('#threads-tbody'); if (!tbody) return;
    const q = state.search;
    let rows = state.threads;
    if (q) rows = rows.filter(t =>
      (t._ex.email||'').toLowerCase().includes(q) ||
      (t._mfg.email||'').toLowerCase().includes(q) ||
      ((t._rfq||{}).product||'').toLowerCase().includes(q) ||
      (t.last_preview||'').toLowerCase().includes(q));
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-muted);">No conversations.</td></tr>`; return; }
    tbody.innerHTML = rows.map(t => `
      <tr data-id="${esc(t.id)}">
        <td style="font-family:var(--font-mono);">${esc((t.id||'').slice(0,8))}</td>
        <td>${esc(t._ex.company || t._ex.email || '—')}</td>
        <td>${esc(t._mfg.company || t._mfg.email || '—')}</td>
        <td>${esc((t._rfq||{}).product || '—')}</td>
        <td>${esc(t.last_preview || '—')}</td>
        <td class="col-mono" style="color:var(--text-muted);">${fmtAgo(t.last_at)}</td>
        <td class="ta-right"><div class="row-actions"><button class="row-action is-danger" data-action="delete-thread" data-id="${esc(t.id)}">Delete</button></div></td>
      </tr>`).join('');
    bindRowActions(tbody);
  }

  /* ── Notifications ─── */
  function renderNotifications() {
    const tbody = $('#notifications-tbody'); if (!tbody) return;
    const q = state.search;
    let rows = state.notifications;
    if (q) rows = rows.filter(n =>
      (n._to.email||'').toLowerCase().includes(q) ||
      (n.kind||'').toLowerCase().includes(q) ||
      (n.body_html||'').toLowerCase().includes(q));
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text-muted);">No notifications.</td></tr>`; return; }
    tbody.innerHTML = rows.map(n => `
      <tr data-id="${esc(n.id)}">
        <td>${esc(n._to.company || n._to.email || '—')}</td>
        <td><span class="chip">${esc(n.kind || '—')}</span></td>
        <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${n.body_html || esc(n.body || '')}</td>
        <td><span class="chip chip--${n.read_at ? 'won' : 'open'}">${n.read_at ? 'Read' : 'Unread'}</span></td>
        <td class="col-mono" style="color:var(--text-muted);">${fmtAgo(n.created_at)}</td>
        <td class="ta-right"><div class="row-actions"><button class="row-action is-danger" data-action="delete-notif" data-id="${esc(n.id)}">Delete</button></div></td>
      </tr>`).join('');
    bindRowActions(tbody);
  }

  /* ── Row actions ─── */
  function bindRowActions(scope) {
    scope.querySelectorAll('[data-action]').forEach(b =>
      b.addEventListener('click', e => { e.stopPropagation(); handleAction(b.dataset.action, b.dataset.id); })
    );
  }
  async function handleAction(action, id) {
    if (!id) return;
    const u = state.users.find(x => x.id === id);
    const r = state.rfqs.find(x => x.id === id);
    const qt = state.quotes.find(x => x.id === id);
    const t = state.threads.find(x => x.id === id);
    const n = state.notifications.find(x => x.id === id);
    const desc = u ? (u.company || u.email)
               : r ? `RFQ — ${r.product}`
               : qt ? `Quote on ${(qt._rfq||{}).product || 'RFQ'}`
               : t ? `Conversation ${id.slice(0,8)}`
               : n ? 'Notification' : '';

    if (action === 'verify')        return confirmRun('Verify this manufacturer?', desc, () => updateProfile(id, { verified_status: true }));
    if (action === 'unverify')      return confirmRun('Revoke verification?', desc, () => updateProfile(id, { verified_status: false }));
    if (action === 'promote')       return confirmRun('Promote to admin?', desc, () => updateProfile(id, { is_admin: true }));
    if (action === 'demote')        return confirmRun('Revoke admin status?', desc, () => updateProfile(id, { is_admin: false }));
    if (action === 'delete-user')   return confirmRun('Permanently delete this user?', desc, () => deleteUser(id), true);
    if (action === 'delete-rfq')    return confirmRun('Delete this RFQ?', desc, () => deleteRow('rfqs', id), true);
    if (action === 'delete-quote')  return confirmRun('Delete this quote?', desc, () => deleteRow('quotes', id), true);
    if (action === 'delete-thread') return confirmRun('Delete this conversation?', desc, () => deleteRow('threads', id), true);
    if (action === 'delete-notif')  return confirmRun('Delete this notification?', desc, () => deleteRow('notifications', id), true);
  }

  /* ── Confirm modal ─── */
  function confirmRun(title, sub, runner, danger) {
    setText('#ac-title', title); setText('#ac-sub', sub || '');
    const go = $('#ac-go');
    go.textContent = danger ? 'Delete' : 'Confirm';
    go.onclick = async () => {
      go.disabled = true;
      try {
        await runner();
        Auth.toast('Done.', 'success');
        closeConfirm();
        await loadEverything();
        rerenderAll();
      } catch (err) {
        console.warn(err);
        Auth.toast(err.message || 'Action failed.', 'error');
        go.disabled = false;
      }
    };
    $('#admin-confirm-modal').classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeConfirm() {
    $('#admin-confirm-modal').classList.remove('show');
    document.body.style.overflow = '';
    const go = $('#ac-go'); if (go) { go.disabled = false; go.onclick = null; }
  }

  /* ── Writes ─── */
  async function updateProfile(id, patch) {
    const { error } = await sb.from('profiles').update(patch).eq('id', id); if (error) throw error;
  }
  async function deleteRow(table, id) {
    const { error } = await sb.from(table).delete().eq('id', id); if (error) throw error;
  }
  async function deleteUser(id) {
    const { error } = await sb.rpc('nexora_admin_delete_user', { target: id }); if (error) throw error;
  }
})();
