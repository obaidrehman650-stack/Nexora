/* ════════════════════════════════════════
   NEXORA — Dashboard
   100% Supabase-backed. No hardcoded sample data.
   Realtime subscriptions keep the UI in sync.
═══════════════════════════════════════════ */
(function () {
  const Auth = window.NexoraAuth;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* Declared up here so onReady's sync path (no auth-pending body class)
     can't hit a Temporal Dead Zone when boot() runs inline. */
  let sb, me, state;

  /* Wait for the Nexora Guard to verify auth + hydrate the user pill. */
  function onReady(fn) {
    if (!document.body.classList.contains('auth-pending')) return setTimeout(fn, 0);
    const obs = new MutationObserver(() => {
      if (!document.body.classList.contains('auth-pending')) {
        obs.disconnect();
        fn();
      }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  onReady(boot);

  /* ════════════════════════════════════════
     UTILITIES
  ════════════════════════════════════════ */
  function fmtNum(n)   { return Number(n ?? 0).toLocaleString('en-US'); }
  function fmtMoney(n) { return '$' + Number(n ?? 0).toFixed(2); }
  function fmtAgo(iso) {
    if (!iso) return '—';
    const min = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1)   return 'Just now';
    if (min < 60)  return Math.floor(min) + 'm ago';
    const h = min / 60;
    if (h < 24)    return Math.floor(h) + 'h ago';
    const d = h / 24;
    if (d < 30)    return Math.floor(d) + 'd ago';
    return Math.floor(d / 30) + 'mo ago';
  }
  function fmtClock(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Date.now() - d.getTime() < 86_400_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function initials(name) {
    return (name || '··').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  }
  function cap(s) { return String(s || '').replace(/^./, c => c.toUpperCase()); }

  /* ════════════════════════════════════════
     BOOT  (sb, me, state declared near top to dodge TDZ)
  ════════════════════════════════════════ */

  async function boot() {
    sb = Auth.client();
    me = window.NEXORA_USER || (await Auth.getCurrentUser());

    if (!me || !me.user) {
      // Guard should have redirected already; defensive bail-out.
      Auth.toast('Session expired. Please sign in again.', 'error');
      setTimeout(() => location.replace('auth.html'), 600);
      return;
    }

    state = {
      view: 'dashboard',
      filter: 'all',
      search: '',
      leads: [],
      quotedIds: new Set(),
      quoteByLead: {},
      myQuotes: [],
      notifs: [],
      threads: [],
      activeThreadId: null,
      activeThreadMessages: [],
      openPopover: null,
      profile: me.profile || {}
    };

    wireUI();
    closeSidebar();

    if (sb) {
      await Promise.all([
        loadLeads(),
        loadMyQuotes(),
        loadNotifications(),
        loadThreads()
      ]);
      subscribeRealtime();
    } else {
      // Demo mode (no Supabase configured) — everything stays empty.
      Auth.toast('Connect Supabase in js/config.js to load live data.', 'warn', { timeout: 6000 });
    }

    renderLeads();
    renderNotifs();
    renderThreads();
    renderRfqs();
    bootProfile();
    updateLiveCount();
  }

  /* ════════════════════════════════════════
     DATA LAYER
     Every fetch returns plain arrays / objects.
     RLS policies on Supabase do the access control.
  ════════════════════════════════════════ */
  async function loadLeads() {
    const industry = state.profile.industry;
    /* For un-industry-assigned profiles (mixed / null) we still show
       everything they're allowed to see by RLS. */
    let q = sb.from('rfqs').select('*').in('status', ['open', 'quoted']).order('created_at', { ascending: false });
    if (industry && industry !== 'mixed') q = q.eq('industry', industry);
    const { data, error } = await q;
    if (error) { console.warn('loadLeads', error); Auth.toast('Could not load the leads feed.', 'error'); return; }
    state.leads = data || [];
  }

  async function loadMyQuotes() {
    const { data, error } = await sb.from('quotes')
      .select('*, rfqs(*)')
      .eq('manufacturer_id', me.user.id)
      .order('created_at', { ascending: false });
    if (error) { console.warn('loadMyQuotes', error); return; }
    state.myQuotes = data || [];
    state.quotedIds = new Set(state.myQuotes.map(q => q.rfq_id));
    state.quoteByLead = Object.fromEntries(state.myQuotes.map(q => [q.rfq_id, q]));
  }

  async function loadNotifications() {
    const { data, error } = await sb.from('notifications')
      .select('*').eq('user_id', me.user.id)
      .order('created_at', { ascending: false }).limit(50);
    if (error) { console.warn('loadNotifications', error); return; }
    state.notifs = data || [];
  }

  async function loadThreads() {
    const { data, error } = await sb.from('threads')
      .select('*')
      .eq('manufacturer_id', me.user.id)
      .order('last_at', { ascending: false });
    if (error) { console.warn('loadThreads', error); return; }
    state.threads = data || [];
  }

  async function loadThreadMessages(threadId) {
    const { data, error } = await sb.from('messages')
      .select('*').eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (error) { console.warn('loadThreadMessages', error); return; }
    state.activeThreadMessages = data || [];
  }

  /* ════════════════════════════════════════
     REALTIME — postgres_changes
     ─ rfqs: new lead in my industry appears live
     ─ quotes: my quote status changes live
     ─ notifications: bell updates live
     ─ messages: open thread updates live
  ════════════════════════════════════════ */
  function subscribeRealtime() {
    sb.channel('nx-rfqs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rfqs' }, p => {
        const r = p.new;
        if (state.profile.industry && state.profile.industry !== 'mixed' && r.industry !== state.profile.industry) return;
        state.leads.unshift(r);
        if (state.view === 'dashboard') renderLeads();
        if (state.view === 'rfqs')      renderRfqs();
        updateLiveCount();
        toast(`New ${cap(r.industry)} lead · ${r.product}`);
      })
      .subscribe();

    sb.channel('nx-notif').on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.user.id}` },
      p => { state.notifs.unshift(p.new); renderNotifs(); }
    ).subscribe();

    sb.channel('nx-msgs').on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      p => {
        const m = p.new;
        if (state.activeThreadId && m.thread_id === state.activeThreadId) {
          state.activeThreadMessages.push(m);
          if (state.view === 'messages') renderActiveThread();
        }
        const t = state.threads.find(x => x.id === m.thread_id);
        if (t) {
          t.last_preview = m.body;
          t.last_at = m.created_at;
          if (state.view === 'messages') renderThreads();
        }
      }
    ).subscribe();
  }

  /* ════════════════════════════════════════
     UI WIRING
  ════════════════════════════════════════ */
  function wireUI() {
    /* View nav */
    $$('.nav-item[data-section]').forEach(n =>
      n.addEventListener('click', e => { e.preventDefault(); setView(n.dataset.section); })
    );
    /* Filter pills (legacy + RFQs view) */
    $$('.pill[data-filter]').forEach(pill =>
      pill.addEventListener('click', () => {
        $$('.pill[data-filter]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.filter = pill.dataset.filter;
        renderLeads();
      })
    );
    /* New: Bench industry filter (tab style) */
    $$('#bench-filter .tab[data-filter]').forEach(tab =>
      tab.addEventListener('click', e => {
        e.preventDefault();
        $$('#bench-filter .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.filter = tab.dataset.filter;
        renderBenchTable();
      })
    );
    /* New: Bench scope tabs (today / week / month) — visual only */
    $$('#bench-scope .tab[data-scope]').forEach(tab =>
      tab.addEventListener('click', e => {
        e.preventDefault();
        $$('#bench-scope .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.benchScope = tab.dataset.scope;
        renderHero();
      })
    );
    /* "View all" → RFQs view */
    document.addEventListener('click', e => {
      const j = e.target.closest('[data-jump-rfqs]');
      if (j) { e.preventDefault(); setView('rfqs'); return; }
      const p = e.target.closest('[data-jump-profile]');
      if (p) { e.preventDefault(); setView('profile'); return; }
    });
    /* Search */
    const searchInput = $('#search-input');
    const searchClear = $('#search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        state.search = e.target.value.trim().toLowerCase();
        searchInput.parentElement.classList.toggle('has-value', !!state.search);
        rerenderActiveView();
      });
    }
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        state.search = '';
        searchInput.parentElement.classList.remove('has-value');
        searchInput.focus();
        rerenderActiveView();
      });
    }

    /* Sidebar (mobile) */
    const scrim = $('.sidebar-scrim');
    const menuBtn = $('.menu-toggle');
    if (menuBtn) menuBtn.addEventListener('click', openSidebar);
    if (scrim)   scrim.addEventListener('click', closeSidebar);
    window.addEventListener('resize', () => { if (window.innerWidth > 880) closeSidebar(); });

    /* Popovers */
    const notifBtn = $('#btn-notifs');
    if (notifBtn) notifBtn.addEventListener('click', e => {
      e.stopPropagation();
      togglePopover('notifs', e.currentTarget);
    });
    const settingsBtn = $('#btn-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', e => {
      e.stopPropagation();
      togglePopover('settings', e.currentTarget);
    });
    $$('.popover').forEach(p => p.addEventListener('click', e => e.stopPropagation()));
    document.addEventListener('click', closeAllPopovers);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAllPopovers(); closeModals(); } });

    const clearBtn = $('#notif-clear');
    if (clearBtn) clearBtn.addEventListener('click', markAllRead);

    /* Settings menu */
    $$('#popover-settings .menu-item').forEach(item =>
      item.addEventListener('click', async () => {
        const action = item.dataset.action;
        closeAllPopovers();
        if (action === 'logout') {
          await Auth.signOut();
          location.replace('auth.html');
        }
      })
    );

    /* Modals */
    $$('[data-close-modal]').forEach(b => b.addEventListener('click', closeModals));
    $$('.modal-backdrop').forEach(bd =>
      bd.addEventListener('click', e => { if (e.target === bd) closeModals(); })
    );

    /* Quote submit */
    const qSubmit = $('#q-submit');
    if (qSubmit) qSubmit.addEventListener('click', submitQuote);

    /* Profile form */
    const pSave = $('#profile-save');
    const pCancel = $('#profile-cancel');
    if (pSave)   pSave.addEventListener('click', saveProfile);
    if (pCancel) pCancel.addEventListener('click', e => { e.preventDefault(); bootProfile(); toast('Changes discarded.'); });

    /* Composer */
    const composer = $('#thread-composer-form');
    if (composer) composer.addEventListener('submit', sendMessage);

    /* User pill → profile view */
    const pill = $('.user-pill');
    if (pill) pill.addEventListener('click', () => setView('profile'));
  }

  function rerenderActiveView() {
    if (state.view === 'dashboard') renderLeads();
    if (state.view === 'rfqs')      renderRfqs();
    if (state.view === 'messages')  renderThreads();
  }

  /* ════════════════════════════════════════
     VIEW SWITCHING
  ════════════════════════════════════════ */
  function setView(name) {
    state.view = name;
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === name));
    closeAllPopovers();
    closeSidebar();
    const search = $('#search-input');
    if (search) {
      search.placeholder = {
        dashboard: 'Search leads, buyers, products…',
        rfqs:      'Search RFQ history…',
        profile:   'Search profile fields…',
        messages:  'Search conversations…'
      }[name] || 'Search…';
    }
    if (name === 'rfqs')     renderRfqs();
    if (name === 'messages') renderThreads();
  }

  function openSidebar()  { $('.sidebar').classList.add('open');    $('.sidebar-scrim').classList.add('show'); }
  function closeSidebar() { const s = $('.sidebar'); if (!s) return; s.classList.remove('open'); $('.sidebar-scrim') && $('.sidebar-scrim').classList.remove('show'); }

  /* ════════════════════════════════════════
     LEADS / DASHBOARD VIEW — editorial overview
  ════════════════════════════════════════ */
  const liveCt = $('#live-count');           /* legacy id (gone), still safe */
  state = state || {};                       /* defensive */

  function filteredLeads() {
    let leads = state.filter === 'all' || !state.filter
      ? state.leads
      : state.leads.filter(l => l.industry === state.filter);
    if (state.search) {
      const q = state.search;
      leads = leads.filter(l =>
        (l.product || '').toLowerCase().includes(q) ||
        (l.destination || '').toLowerCase().includes(q) ||
        (l.id || '').toLowerCase().includes(q) ||
        (l.industry || '').toLowerCase().includes(q)
      );
    }
    return leads;
  }

  function setText(sel, v) { const el = $(sel); if (el) el.textContent = String(v); }
  function fmtMoneyShort(v) {
    v = Number(v) || 0;
    if (v >= 1_000_000) return { value: (v / 1_000_000).toFixed(1), unit: 'M' };
    if (v >= 1_000)     return { value: Math.round(v / 1_000),       unit: 'k' };
    return { value: Math.round(v), unit: '' };
  }
  const FLAG = {
    us:'🇺🇸',usa:'🇺🇸','united states':'🇺🇸', de:'🇩🇪',germany:'🇩🇪',
    uk:'🇬🇧',gb:'🇬🇧','united kingdom':'🇬🇧',england:'🇬🇧',
    jp:'🇯🇵',japan:'🇯🇵', ae:'🇦🇪',uae:'🇦🇪','united arab emirates':'🇦🇪',
    br:'🇧🇷',brazil:'🇧🇷', fr:'🇫🇷',france:'🇫🇷', ca:'🇨🇦',canada:'🇨🇦',
    au:'🇦🇺',australia:'🇦🇺', in:'🇮🇳',india:'🇮🇳', cn:'🇨🇳',china:'🇨🇳',
    sa:'🇸🇦','saudi arabia':'🇸🇦', nl:'🇳🇱',netherlands:'🇳🇱',
    it:'🇮🇹',italy:'🇮🇹', es:'🇪🇸',spain:'🇪🇸', za:'🇿🇦','south africa':'🇿🇦'
  };
  function flagFor(name) {
    if (!name) return '🌐';
    const tail = String(name).split(',').pop().trim().toLowerCase();
    return FLAG[tail] || FLAG[String(name).toLowerCase()] || '🌐';
  }

  /* ── Entry point: renders the entire editorial overview ── */
  function renderLeads() {
    /* Reveal every .rev / .stagger block immediately — the design's
       intersection-observer reveal is overkill inside a SPA where the
       view is already on-screen and just got re-rendered. */
    document.querySelectorAll('.rev, .stagger').forEach(el => el.classList.add('in'));

    renderHero();
    renderKpis();
    renderRevenueChart();
    renderIndustryDonut();
    renderIndustryBars();
    renderDashFunnel();
    renderGeoList();
    renderBenchTable();
    renderDashFeed();
    renderCapacityGauge();
    renderRecommendedBuyers();
    updateLiveCount();
    setText('#dh-sync', new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false }));
  }

  /* ── Page-head greeting ── */
  function renderHero() {
    const name = (state.profile.full_name || '').split(' ')[0]
              || (state.profile.company    || '').split(' ')[0]
              || 'there';
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const today = state.leads.filter(l => sameDay(l.created_at)).length;
    const week  = state.leads.filter(l => withinDays(l.created_at, 7)).length;
    const month = state.leads.filter(l => withinDays(l.created_at, 30)).length;
    setText('#dh-open', today);
    setText('#dh-today', today);
    setText('#dh-week',  week);
    setText('#dh-month', month);
    setText('#dh-greeting', '');
    const h = $('#dh-greeting');
    if (h) h.innerHTML = `${greet}${name ? ', ' + escapeHtml(name) : ''}. <em>${today}</em> new on the bench.`;
    const dests = new Set(state.leads.map(l => l.destination).filter(Boolean));
    setText('#dh-sub', '');
    const sub = $('#dh-sub');
    if (sub) {
      if (state.leads.length) {
        sub.innerHTML = `Open requirements from verified buyers across ${dests.size} market${dests.size === 1 ? '' : 's'}. Average response window today: <strong style="color:var(--text)" id="dh-window">${state.profile.verified_status ? 'live' : 'awaiting verification'}</strong>.`;
      } else {
        sub.innerHTML = state.profile.verified_status
          ? `No open requirements yet — new RFQs from verified buyers will appear here in real time.`
          : `Your account is awaiting verification — once approved, leads in your industry will appear here.`;
      }
    }
  }
  function sameDay(iso) {
    if (!iso) return false;
    const d = new Date(iso), n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }
  function withinDays(iso, n) {
    return iso && (Date.now() - new Date(iso).getTime()) < n * 86_400_000;
  }

  /* ── KPI tiles ── */
  function renderKpis() {
    const open = state.leads.length;
    const lastWeek = state.leads.filter(l => withinDays(l.created_at, 7)).length;
    setText('#kpi-rfqs', open);
    const rEl = $('#kpi-rfqs-delta');
    if (rEl) { rEl.textContent = lastWeek ? `▲ ${lastWeek}` : '—'; rEl.className = 'delta ' + (lastWeek ? 'up' : 'flat'); }
    if (window.NX && NX.animateCounter) NX.animateCounter($('#kpi-rfqs'), open, { duration: 800 });

    const monthQuotes = state.myQuotes.filter(q => withinDays(q.created_at, 30)).length;
    setText('#kpi-quotes', state.myQuotes.length);
    const qEl = $('#kpi-quotes-delta');
    if (qEl) { qEl.textContent = monthQuotes ? `▲ ${monthQuotes}` : '—'; qEl.className = 'delta ' + (monthQuotes ? 'up' : 'flat'); }

    const pipelineDollars = state.myQuotes
      .filter(q => q.status === 'sent' || q.status === 'quoted')
      .reduce((s, q) => s + (Number(q.unit_price) || 0) * (((q.rfqs || {}).quantity) || 0), 0);
    const pip = fmtMoneyShort(pipelineDollars);
    setText('#kpi-pipeline', pip.value);
    setText('#kpi-pipeline-unit', pip.unit);
    const pEl = $('#kpi-pipeline-delta');
    if (pEl) { pEl.textContent = pipelineDollars ? 'open quotes' : '—'; pEl.className = 'delta ' + (pipelineDollars ? 'up' : 'flat'); }

    const last30 = state.myQuotes.filter(q => withinDays(q.created_at, 30));
    const won30  = last30.filter(q => q.status === 'accepted').length;
    const rate   = last30.length ? Math.round(100 * won30 / last30.length) : null;
    setText('#kpi-win', rate != null ? rate : '—');
    const wEl = $('#kpi-win-delta');
    if (wEl) { wEl.textContent = rate != null ? (won30 + '/' + last30.length) : '—'; wEl.className = 'delta flat'; }

    /* sparklines */
    drawSpark('spark-rfqs',     bucketize(state.leads,    7,  4));
    drawSpark('spark-quotes',   bucketize(state.myQuotes, 30, 8));
    drawSpark('spark-pipeline', bucketizePipeline());
    drawSpark('spark-win',      bucketizeWinRate());
  }
  function drawSpark(id, data) {
    const el = document.getElementById(id);
    if (!el || !window.NX || !NX.sparkline) return;
    el.innerHTML = NX.sparkline(data, { width: 96, height: 32, color: 'var(--accent)' });
  }
  function bucketize(items, days, buckets) {
    const arr = new Array(buckets).fill(0);
    const span = days * 86_400_000;
    items.forEach(it => {
      const t = new Date(it.created_at).getTime();
      if (!t) return;
      const idx = buckets - 1 - Math.floor((Date.now() - t) / (span / buckets));
      if (idx >= 0 && idx < buckets) arr[idx]++;
    });
    if (arr.every(v => v === 0)) return arr.map((_, i) => i + 1);
    return arr;
  }
  function bucketizePipeline() {
    const buckets = 8, span = 30 * 86_400_000;
    const arr = new Array(buckets).fill(0);
    state.myQuotes.forEach(q => {
      const t = new Date(q.created_at).getTime();
      if (!t) return;
      const idx = buckets - 1 - Math.floor((Date.now() - t) / (span / buckets));
      if (idx >= 0 && idx < buckets) {
        arr[idx] += (Number(q.unit_price) || 0) * (((q.rfqs || {}).quantity) || 0);
      }
    });
    if (arr.every(v => v === 0)) return arr.map((_, i) => i + 1);
    return arr;
  }
  function bucketizeWinRate() {
    const buckets = 8, span = 90 * 86_400_000;
    const total = new Array(buckets).fill(0);
    const wins  = new Array(buckets).fill(0);
    state.myQuotes.forEach(q => {
      const t = new Date(q.created_at).getTime();
      if (!t) return;
      const idx = buckets - 1 - Math.floor((Date.now() - t) / (span / buckets));
      if (idx >= 0 && idx < buckets) {
        total[idx] += 1;
        if (q.status === 'accepted') wins[idx] += 1;
      }
    });
    const out = total.map((t, i) => t ? Math.round(100 * wins[i] / t) : 0);
    if (out.every(v => v === 0)) return out.map((_, i) => i + 1);
    return out;
  }

  /* ── Revenue chart: 8-month confirmed orders ── */
  function renderRevenueChart() {
    const wrap = $('#revenue-chart'); if (!wrap || !window.NX) return;
    const now = new Date();
    const months = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: d.getFullYear() + '-' + d.getMonth(), label: d.toLocaleString('en-US', { month:'short' }), value: 0 });
    }
    state.myQuotes
      .filter(q => q.status === 'accepted')
      .forEach(q => {
        const t = new Date(q.created_at);
        const k = t.getFullYear() + '-' + t.getMonth();
        const idx = months.findIndex(m => m.key === k);
        if (idx >= 0) months[idx].value += (Number(q.unit_price) || 0) * (((q.rfqs || {}).quantity) || 0);
      });
    wrap.innerHTML = '';
    NX.areaChart(wrap, {
      width: 760, height: 260,
      data: months.map(m => ({ label: m.label, value: m.value })),
      color: 'var(--accent)', smooth: true
    });
    const total = months.reduce((s, m) => s + m.value, 0);
    const t = fmtMoneyShort(total);
    setText('#lg-revenue', '$' + t.value + t.unit);
  }

  /* ── Industry donut ── */
  function renderIndustryDonut() {
    const wrap = $('#industry-donut'); if (!wrap || !window.NX) return;
    const counts = { surgical: 0, sports: 0, leather: 0 };
    state.leads.forEach(l => { if (counts[l.industry] != null) counts[l.industry]++; });
    const total = counts.surgical + counts.sports + counts.leather;
    wrap.innerHTML = '';
    NX.donut(wrap, {
      size: 200,
      data: [
        { label: 'Surgical', value: counts.surgical || 0.001, color: 'var(--ind-surgical)' },
        { label: 'Sports',   value: counts.sports   || 0.001, color: 'var(--ind-sports)' },
        { label: 'Leather',  value: counts.leather  || 0.001, color: 'var(--ind-leather)' }
      ],
      centerValue: String(total),
      centerLabel: 'RFQs'
    });
  }
  function renderIndustryBars() {
    const wrap = $('#industry-bars'); if (!wrap) return;
    const counts = { surgical: 0, sports: 0, leather: 0 };
    state.leads.forEach(l => { if (counts[l.industry] != null) counts[l.industry]++; });
    const total = counts.surgical + counts.sports + counts.leather;
    const items = [
      { key:'surgical', label:'Surgical', pip:'pip--surg',  ind:'I',   color:'var(--ind-surgical)' },
      { key:'sports',   label:'Sports',   pip:'pip--sport', ind:'II',  color:'var(--ind-sports)' },
      { key:'leather',  label:'Leather',  pip:'pip--leath', ind:'III', color:'var(--ind-leather)' }
    ];
    wrap.innerHTML = items.map(it => {
      const n = counts[it.key];
      const pct = total ? Math.round(100 * n / total) : 0;
      const p = total ? n / total : 0;
      const quoted = state.leads.filter(l => l.industry === it.key && state.quotedIds.has(l.id)).length;
      return `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:0.85rem;">
            <span style="display:inline-flex;align-items:center;gap:8px;color:var(--text);"><span class="pip ${it.pip}">${it.ind}</span>${it.label}</span>
            <span style="font-family:var(--font-mono);color:var(--text);">${pct}%</span>
          </div>
          <div class="bar-cell in" style="width:100%;margin-top:6px;--p:${p.toFixed(3)};"><div class="bar-cell-fill" style="background:${it.color};"></div></div>
          <div style="font-size:0.74rem;color:var(--text-muted);margin-top:4px;font-family:var(--font-mono);">${n} RFQs · ${quoted} quoted</div>
        </div>`;
    }).join('');
  }

  /* ── Conversion funnel ── */
  function renderDashFunnel() {
    const wrap = $('#funnel-list'); if (!wrap) return;
    const leads     = state.leads.length + state.myQuotes.length; /* leads received = open + already quoted */
    const quoted    = state.myQuotes.length;
    const accepted  = state.myQuotes.filter(q => q.status === 'accepted').length;
    const sampled   = state.myQuotes.filter(q => q.status === 'accepted' || q.status === 'sampled').length;
    const shipped   = accepted;
    const rows = [
      { label:'Leads received', n: leads,    tone:'tone-1' },
      { label:'Quoted',         n: quoted,   tone:'tone-2' },
      { label:'Sampled',        n: sampled,  tone:'tone-3' },
      { label:'Confirmed',      n: accepted, tone:'tone-4' },
      { label:'Shipped',        n: shipped,  tone:'tone-5' }
    ];
    setText('#funnel-sub', `${leads} lead${leads === 1 ? '' : 's'} on the bench this quarter`);
    if (!leads) {
      wrap.innerHTML = `<div style="padding:18px 0;text-align:center;color:var(--text-muted);font-size:0.86rem;">No leads yet — funnel will populate once requirements land.</div>`;
      setText('#funnel-q2s', '—'); setText('#funnel-ticket', '—'); setText('#funnel-cycle', '—');
      return;
    }
    wrap.innerHTML = rows.map(r => {
      const pct = leads ? Math.round(100 * r.n / leads) : 0;
      const p   = leads ? r.n / leads : 0;
      return `<div class="funnel-step in" style="--p:${p.toFixed(3)};">
        <div class="lbl">${escapeHtml(r.label)}<span class="pct">${pct}%</span></div>
        <div class="funnel-bar"><span class="${r.tone}" style="width:100%;"></span></div>
        <div class="vl">${fmtNum(r.n)}</div>
      </div>`;
    }).join('');

    const q2s = quoted ? Math.round(100 * sampled / quoted) : 0;
    setText('#funnel-q2s', q2s);
    const tickets = state.myQuotes.filter(q => q.status === 'accepted')
      .map(q => (Number(q.unit_price) || 0) * (((q.rfqs || {}).quantity) || 0));
    const avg = tickets.length ? tickets.reduce((s, v) => s + v, 0) / tickets.length : 0;
    setText('#funnel-ticket', fmtNum(Math.round(avg)));
    const cycles = state.myQuotes
      .filter(q => q.status === 'accepted' && q.rfqs && q.rfqs.created_at)
      .map(q => (new Date(q.created_at).getTime() - new Date(q.rfqs.created_at).getTime()) / 86_400_000)
      .filter(v => v > 0)
      .sort((a, b) => a - b);
    setText('#funnel-cycle', cycles.length ? Math.round(cycles[Math.floor(cycles.length / 2)]) : '—');
  }

  /* ── Geo list ── */
  function countryOf(dest) {
    if (!dest) return '—';
    const parts = String(dest).split(',').map(s => s.trim()).filter(Boolean);
    return parts[parts.length - 1] || dest;
  }
  function renderGeoList() {
    const wrap = $('#geo-list'); if (!wrap) return;
    const buckets = new Map();
    state.leads.forEach(l => {
      if (!l.destination) return;
      const dest = String(l.destination);
      const b = buckets.get(dest) || { rfqs: 0 };
      b.rfqs += 1;
      buckets.set(dest, b);
    });
    const rows = [...buckets.entries()]
      .map(([dest, v]) => ({ dest, rfqs: v.rfqs }))
      .sort((a, b) => b.rfqs - a.rfqs)
      .slice(0, 5);
    setText('#geo-count', buckets.size);
    if (!rows.length) {
      wrap.innerHTML = `<div style="padding:18px 0;text-align:center;color:var(--text-muted);font-size:0.86rem;">No destinations yet — list will populate as RFQs come in.</div>`;
      return;
    }
    const top = rows[0].rfqs;
    wrap.innerHTML = rows.map(r => {
      const p = top ? Math.max(0.08, r.rfqs / top) : 0;
      return `<div class="geo-row in" style="--p:${p.toFixed(3)};">
        <span class="ct">${flagFor(countryOf(r.dest))}&nbsp;&nbsp;${escapeHtml(r.dest)}</span>
        <span class="bar"><span></span></span>
        <span class="vl">${fmtNum(r.rfqs)} RFQs</span>
      </div>`;
    }).join('');
  }

  /* ── Bench table ── */
  function renderBenchTable() {
    const tbody = $('#bench-tbody'); if (!tbody) return;
    const leads = filteredLeads();
    setText('#bench-count', state.leads.length);
    ['all','surgical','sports','leather'].forEach(k => {
      setText('#bench-cnt-' + k, k === 'all' ? state.leads.length : state.leads.filter(l => l.industry === k).length);
    });

    if (!leads.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-muted);">${state.search ? 'No leads match.' : 'No open RFQs yet — new requirements appear here in real time.'}</td></tr>`;
      setText('#bench-shown', `Showing 0 of ${state.leads.length} open RFQs`);
      return;
    }
    const shown = leads.slice(0, 7);
    tbody.innerHTML = shown.map(l => {
      const isQuoted = state.quotedIds.has(l.id);
      const indClass = l.industry === 'surgical' ? 'chip--surg'
                     : l.industry === 'sports'   ? 'chip--sport'
                     : l.industry === 'leather'  ? 'chip--leath'
                     : 'chip--quoted';
      const indPip   = l.industry === 'surgical' ? 'I'
                     : l.industry === 'sports'   ? 'II'
                     : l.industry === 'leather'  ? 'III' : '';
      const initials = (l.product || '').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('') || '··';
      const status = isQuoted ? { cls:'chip--quoted', label:'Quoted' } : { cls:'chip--open', label:'New' };
      const action = isQuoted
        ? `<button class="btn btn-ghost btn-xs" data-action="details" data-id="${escapeHtml(l.id)}">View</button>`
        : `<button class="btn btn-primary btn-xs" data-action="quote" data-id="${escapeHtml(l.id)}">Quote →</button>`;
      return `<tr data-lead-id="${escapeHtml(l.id)}">
        <td><div class="dt-cell-main"><div class="av">${escapeHtml(initials)}</div><div><div class="ti">${escapeHtml(l.product || '—')}</div><div class="su">${l.specs ? escapeHtml((l.specs || '').slice(0, 80)) : escapeHtml((l.id || '').slice(0, 8))}</div></div></div></td>
        <td><span class="chip ${indClass}">${indPip ? indPip + ' ' : ''}${escapeHtml(cap(l.industry || '—'))}</span></td>
        <td>${flagFor(countryOf(l.destination))} ${escapeHtml(l.destination || '—')}</td>
        <td class="ta-right col-mono">${fmtNum(l.quantity)} ${escapeHtml(l.unit || '')}</td>
        <td class="ta-right col-mono">${l.target_price != null ? fmtMoney(l.target_price) : '—'}</td>
        <td><span class="chip ${status.cls}">${status.label}</span></td>
        <td class="ta-right col-mono" style="color:var(--text-muted);">${fmtAgo(l.created_at)}</td>
        <td class="ta-right">${action}</td>
      </tr>`;
    }).join('');
    setText('#bench-shown', `Showing ${shown.length} of ${state.leads.length} open RFQs`);

    tbody.querySelectorAll('[data-action="quote"]').forEach(b =>
      b.addEventListener('click', () => openQuoteModal(b.dataset.id)));
    tbody.querySelectorAll('[data-action="details"]').forEach(b =>
      b.addEventListener('click', () => openDetailsModal(b.dataset.id)));
  }

  /* ── Activity feed ── */
  function renderDashFeed() {
    const wrap = $('#dash-feed'); if (!wrap) return;
    const items = [];
    state.myQuotes.slice(0, 6).forEach(q => {
      if (q.status === 'accepted') {
        items.push({ ts:q.created_at, kind:'won',
          html:`<span class="ent">${escapeHtml(((q.rfqs||{}).destination) || 'Buyer')}</span> confirmed your quote — <strong>${fmtNum((q.rfqs||{}).quantity || 0)} ${escapeHtml((q.rfqs||{}).unit || 'units')}</strong> at ${fmtMoney(q.unit_price)}/unit.<span class="sub">${escapeHtml(((q.rfqs||{}).product) || '')}</span>` });
      } else {
        items.push({ ts:q.created_at, kind:'quote',
          html:`Quote sent on <span class="ent">${escapeHtml(((q.rfqs||{}).product) || 'RFQ')}</span> — ${fmtMoney(q.unit_price)}/unit.<span class="sub">${escapeHtml(((q.rfqs||{}).destination) || '')} · lead ${escapeHtml(q.lead_time || '—')}</span>` });
      }
    });
    state.leads.slice(0, 6).forEach(l => {
      items.push({ ts:l.created_at, kind:'rfq',
        html:`New RFQ — <span class="ent">${escapeHtml(l.product || '')}</span> · <strong>${fmtNum(l.quantity)} ${escapeHtml(l.unit || '')}</strong> · ${escapeHtml(l.destination || '')}.<span class="sub">${escapeHtml(cap(l.industry || ''))}${l.target_price != null ? ' · target ' + fmtMoney(l.target_price) : ''}</span>` });
    });
    state.notifs.slice(0, 6).forEach(n => {
      items.push({ ts:n.created_at, kind:'note',
        html:`${n.body_html || escapeHtml(n.body || (n.kind || 'Notification'))}` });
    });
    items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    const top = items.slice(0, 8);
    if (!top.length) {
      wrap.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:0.88rem;">No activity yet — new events will appear here in real time.</div>`;
      return;
    }
    wrap.innerHTML = top.map(it => {
      const color = it.kind === 'won' ? 'var(--success)'
                  : it.kind === 'quote' ? 'var(--accent)'
                  : it.kind === 'rfq' ? 'var(--ind-surgical)'
                  : 'var(--text-mid)';
      const icon = it.kind === 'won'   ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>'
                 : it.kind === 'quote' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
                 : it.kind === 'rfq'   ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>'
                 : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>';
      return `<div class="feed-item">
        <div class="feed-dot" style="color:${color};">${icon}</div>
        <div class="feed-text">${it.html}</div>
        <div class="feed-time">${fmtAgo(it.ts)}</div>
      </div>`;
    }).join('');
  }

  /* ── Capacity gauge ── */
  function renderCapacityGauge() {
    const wrap = $('#capacity-gauge'); if (!wrap || !window.NX) return;
    const cap = Number((state.profile.capacity || '').toString().replace(/[^0-9.]/g, '')) || null;
    /* approximate booked = sum of accepted quote quantities for the next 90 days */
    const booked = state.myQuotes
      .filter(q => q.status === 'accepted')
      .reduce((s, q) => s + (((q.rfqs || {}).quantity) || 0), 0);
    const ratio = cap ? Math.min(1, booked / cap) : 0;
    wrap.innerHTML = '';
    NX.gauge(wrap, { size: 180, value: ratio || 0.001, color: 'var(--accent)', label: 'Capacity used' });
    const note = $('#capacity-note');
    if (note) {
      if (!cap) {
        note.innerHTML = `Capacity tracking is off — set monthly capacity in your <a href="#" data-jump-profile style="color:var(--accent);">profile</a> to enable.`;
      } else {
        const pct = Math.round(ratio * 100);
        note.innerHTML = `Booked at <strong style="color:var(--text);">${pct}% of stated capacity</strong>. You can still accept ~${fmtNum(Math.max(0, cap - booked))} units.`;
      }
    }
  }

  /* ── Recommended buyers — top exporters by recent RFQ volume in your industry ── */
  function renderRecommendedBuyers() {
    const wrap = $('#recommended-buyers'); if (!wrap) return;
    const myInd = state.profile.industry;
    const byBuyer = new Map();
    state.leads
      .filter(l => !myInd || myInd === 'mixed' || l.industry === myInd)
      .forEach(l => {
        const id = l.posted_by || l.exporter_id || 'anon';
        const b = byBuyer.get(id) || { id, dest: l.destination, count: 0, last: l.created_at };
        b.count += 1;
        if ((l.created_at || '') > (b.last || '')) b.last = l.created_at;
        if (l.destination) b.dest = l.destination;
        byBuyer.set(id, b);
      });
    const rows = [...byBuyer.values()].sort((a, b) => b.count - a.count).slice(0, 3);
    if (!rows.length) {
      wrap.innerHTML = `<div style="padding:14px 4px;color:var(--text-muted);font-size:0.86rem;">No buyer signals yet — recommendations will appear once leads land.</div>`;
      return;
    }
    wrap.innerHTML = rows.map(r => {
      const initials = String(r.id || 'NX').slice(0, 2).toUpperCase();
      const fit = Math.min(95, 60 + r.count * 5);
      return `<div class="feed-item" style="padding:10px 4px;">
        <div class="feed-dot" style="background:var(--accent-soft);color:var(--accent-dark);border-color:rgba(201,100,66,0.22);font-family:var(--font-display);font-size:0.74rem;font-weight:600;">${escapeHtml(initials)}</div>
        <div class="feed-text">
          <span class="ent">Buyer ${escapeHtml(initials)}</span>
          <span class="sub">${r.count} recent RFQ${r.count === 1 ? '' : 's'}${r.dest ? ' · ' + escapeHtml(r.dest) : ''}</span>
        </div>
        <div class="feed-time"><span class="chip chip--quoted" style="text-transform:none;letter-spacing:0;font-size:0.66rem;">${fit}% fit</span></div>
      </div>`;
    }).join('');
  }

  function updateLiveCount() {
    /* Sidebar badges (still present in dashboard.html) */
    const rfqBadge = $('.nav-item[data-section="rfqs"] .badge');
    if (rfqBadge) rfqBadge.textContent = state.myQuotes.length;
    const msgBadge = $('.nav-item[data-section="messages"] .badge');
    if (msgBadge) msgBadge.textContent = state.threads.length || 0;
    if (liveCt) liveCt.textContent = state.leads.length;
  }

  /* ════════════════════════════════════════
     QUOTE MODAL
  ════════════════════════════════════════ */
  let currentQuoteLead = null;

  function openQuoteModal(id) {
    const lead = state.leads.find(l => l.id === id);
    if (!lead) return;
    currentQuoteLead = lead;
    $('#q-eyebrow').textContent = `New Quote · ${(lead.id || '').slice(0, 8)}`;
    $('#q-title').textContent   = lead.product;
    $('#q-sub').textContent     = `${fmtNum(lead.quantity)} ${lead.unit} · ${lead.destination}`;
    $('#q-sum-qty').textContent    = `${fmtNum(lead.quantity)} ${lead.unit}`;
    $('#q-sum-target').textContent = lead.target_price != null ? fmtMoney(lead.target_price) : '—';
    $('#q-sum-dest').textContent   = lead.destination;
    $('#q-price').value     = lead.target_price ? Number(lead.target_price).toFixed(2) : '';
    $('#q-moq').value       = '';
    $('#q-lead-time').value = lead.lead_time || '45 days';
    $('#q-payment').value   = '';
    $('#q-incoterm').value  = lead.incoterm || 'FOB Karachi';
    $('#q-notes').value     = '';
    openModal($('#modal-quote'));
    setTimeout(() => $('#q-price').focus(), 200);
  }

  async function submitQuote() {
    if (!currentQuoteLead) return;
    const price = parseFloat($('#q-price').value);
    if (!price || price <= 0) {
      $('#q-price').focus();
      toast('Please enter a valid unit price.');
      return;
    }
    if (!sb) {
      toast('Connect Supabase to send real quotes.');
      return;
    }
    const payload = {
      rfq_id:          currentQuoteLead.id,
      manufacturer_id: me.user.id,
      unit_price:      price,
      lead_time:       $('#q-lead-time').value,
      payment_terms:   Auth.sanitize($('#q-payment').value),
      incoterm:        $('#q-incoterm').value,
      notes:           Auth.sanitize($('#q-notes').value)
    };
    const { data, error } = await sb.from('quotes').insert(payload).select('*, rfqs(*)').single();
    if (error) {
      console.warn('quote insert', error);
      toast(error.message || 'Could not send quote.');
      return;
    }
    state.myQuotes.unshift(data);
    state.quotedIds.add(data.rfq_id);
    state.quoteByLead[data.rfq_id] = data;
    toast(`Quote sent for ${currentQuoteLead.product} → ${currentQuoteLead.destination}.`);
    closeModals();
    renderLeads();
    renderRfqs();
    updateLiveCount();
  }

  /* ════════════════════════════════════════
     DETAILS MODAL
  ════════════════════════════════════════ */
  function openDetailsModal(id) {
    const lead = state.leads.find(l => l.id === id);
    if (!lead) return;
    const isQuoted = state.quotedIds.has(lead.id);
    const industryLabel = cap(lead.industry);

    $('#d-eyebrow').textContent = `Lead detail · ${(lead.id || '').slice(0, 8)}`;
    $('#d-title').textContent   = lead.product;
    $('#d-sub').textContent     = `${fmtNum(lead.quantity)} ${lead.unit} · ${lead.destination}`;

    $('#d-body').innerHTML = `
      <div class="detail-section">
        <h4>About this lead</h4>
        <div style="display:flex; gap:10px; align-items:center; margin-bottom: 12px;">
          <span class="industry-badge ${escapeHtml(lead.industry)}">${escapeHtml(industryLabel)}</span>
          <span class="lead-time">${fmtAgo(lead.created_at)}</span>
        </div>
        <p>${escapeHtml(lead.specs || '— no additional specifications provided —')}</p>
      </div>
      <div class="detail-section">
        <h4>Specifications</h4>
        <div class="detail-grid">
          <div class="meta-item"><span class="meta-label">Quantity</span><span class="meta-value"><strong>${fmtNum(lead.quantity)}</strong> ${escapeHtml(lead.unit)}</span></div>
          <div class="meta-item"><span class="meta-label">Destination</span><span class="meta-value">${escapeHtml(lead.destination)}</span></div>
          <div class="meta-item"><span class="meta-label">Lead time</span><span class="meta-value">${escapeHtml(lead.lead_time || '—')}</span></div>
          <div class="meta-item"><span class="meta-label">Incoterm</span><span class="meta-value">${escapeHtml(lead.incoterm || '—')}</span></div>
          <div class="meta-item"><span class="meta-label">Target price</span><span class="meta-value">${lead.target_price != null ? fmtMoney(lead.target_price) : '—'}</span></div>
          <div class="meta-item"><span class="meta-label">Reference</span><span class="meta-value">${escapeHtml(lead.id)}</span></div>
        </div>
      </div>
      <div class="detail-section">
        <h4>Status</h4>
        <p><span class="status-chip ${isQuoted ? 'quoted' : 'open'}">${isQuoted ? 'Quoted' : 'Open'}</span></p>
      </div>
    `;
    $('#d-cta').textContent = isQuoted ? 'Quote sent' : 'Send Quote';
    $('#d-cta').onclick = () => {
      closeModals();
      if (!isQuoted) setTimeout(() => openQuoteModal(lead.id), 280);
    };
    openModal($('#modal-details'));
  }

  /* ════════════════════════════════════════
     POPOVERS
  ════════════════════════════════════════ */
  function togglePopover(name, anchorBtn) {
    if (state.openPopover === name) { closeAllPopovers(); return; }
    closeAllPopovers();
    state.openPopover = name;
    const pop = $(`#popover-${name}`);
    if (pop) pop.classList.add('show');
    anchorBtn.classList.add('open');
  }
  function closeAllPopovers() {
    $$('.popover').forEach(p => p.classList.remove('show'));
    $$('.icon-btn').forEach(b => b.classList.remove('open'));
    state.openPopover = null;
  }

  function renderNotifs() {
    const list = $('#notif-list');
    const dot  = $('#notif-dot');
    const unread = state.notifs.filter(n => !n.read_at).length;
    if (dot) dot.style.display = unread ? 'block' : 'none';
    if (!list) return;
    if (!state.notifs.length) {
      list.innerHTML = '<div class="popover-empty">You\'re all caught up.</div>';
      return;
    }
    list.innerHTML = state.notifs.map((n, i) => `
      <div class="notif-item${!n.read_at ? ' unread' : ''}" data-id="${escapeHtml(n.id)}" style="--i:${i}">
        <span class="notif-dot-static"></span>
        <div class="notif-content">${n.body_html /* trusted DB-rendered HTML */ || escapeHtml(n.body || '')}</div>
        <span class="notif-time">${fmtAgo(n.created_at)}</span>
      </div>`).join('');
    list.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        const n = state.notifs.find(x => x.id === id);
        if (n && !n.read_at) {
          n.read_at = new Date().toISOString();
          renderNotifs();
          if (sb) await sb.from('notifications').update({ read_at: n.read_at }).eq('id', id);
        }
      });
    });
  }

  async function markAllRead() {
    const unread = state.notifs.filter(n => !n.read_at);
    if (!unread.length) return;
    const now = new Date().toISOString();
    unread.forEach(n => n.read_at = now);
    renderNotifs();
    if (sb) await sb.from('notifications').update({ read_at: now }).is('read_at', null).eq('user_id', me.user.id);
    toast('All notifications marked as read.');
  }

  /* ════════════════════════════════════════
     RFQs VIEW (the manufacturer's own quote history)
  ════════════════════════════════════════ */
  function renderRfqs() {
    const tbody = $('#rfq-tbody');
    if (!tbody) return;

    // Combine: open leads I haven't quoted + my sent quotes
    const openRows = state.leads
      .filter(l => !state.quotedIds.has(l.id))
      .map(l => ({
        id: l.id,
        product: l.product,
        industry: l.industry,
        destination: l.destination,
        quantity: l.quantity,
        unit: l.unit,
        status: 'open',
        created_at: l.created_at,
        sent_price: null
      }));
    const myQuoteRows = state.myQuotes.map(q => ({
      id: q.rfq_id,
      product:     q.rfqs ? q.rfqs.product : '—',
      industry:    q.rfqs ? q.rfqs.industry : '',
      destination: q.rfqs ? q.rfqs.destination : '',
      quantity:    q.rfqs ? q.rfqs.quantity : 0,
      unit:        q.rfqs ? q.rfqs.unit : '',
      status:      q.status === 'accepted' ? 'won'
                 : q.status === 'rejected' ? 'lost'
                 : 'quoted',
      created_at:  q.created_at,
      sent_price:  q.unit_price
    }));

    let rows = [...myQuoteRows, ...openRows];

    if (state.search) {
      const q = state.search;
      rows = rows.filter(r =>
        (r.product || '').toLowerCase().includes(q) ||
        (r.destination || '').toLowerCase().includes(q) ||
        (r.id || '').toLowerCase().includes(q)
      );
    }

    const counts = { all: rows.length, open: 0, quoted: 0, won: 0, lost: 0 };
    rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = v; };
    set('rfq-stat-all', counts.all); set('rfq-stat-open', counts.open);
    set('rfq-stat-quoted', counts.quoted); set('rfq-stat-won', counts.won);
    set('rfq-stat-lost', counts.lost);

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--text-muted);">
        ${state.search ? 'No RFQs match your search.' : 'No RFQs yet. They\'ll appear here as buyers post requirements.'}
      </td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((r, i) => `
      <tr data-id="${escapeHtml(r.id)}" style="--i:${i}">
        <td>
          <span class="rfq-product">${escapeHtml(r.product)}</span>
          <span class="rfq-meta">${escapeHtml((r.id || '').slice(0,8))} · ${escapeHtml(r.industry)}</span>
        </td>
        <td>${escapeHtml(r.destination)}</td>
        <td>${fmtNum(r.quantity)}</td>
        <td>${r.sent_price != null ? fmtMoney(r.sent_price) : '—'}</td>
        <td><span class="status-chip ${r.status}">${cap(r.status)}</span></td>
        <td>${fmtAgo(r.created_at)}</td>
      </tr>`).join('');

    tbody.querySelectorAll('tr').forEach(tr =>
      tr.addEventListener('click', () => openDetailsModal(tr.dataset.id))
    );
  }

  /* ════════════════════════════════════════
     PROFILE VIEW
  ════════════════════════════════════════ */
  function bootProfile() {
    const p = state.profile;
    const company = p.company || p.full_name || (me.user && me.user.email) || 'Your shop';
    const initialsTxt = initials(company);
    const setText = (id, v) => { const el = $('#' + id); if (el) el.textContent = v ?? ''; };
    const setVal  = (id, v) => { const el = $('#' + id); if (el) el.value = v ?? ''; };

    setText('p-avatar', initialsTxt);
    setText('p-name', company);
    setText('p-role', cap(p.role || 'Manufacturer'));
    setText('p-joined', p.verified_status ? 'Verified' : 'Awaiting verification');
    /* Verified badge — only shown for verified profiles */
    const vBadge = $('#p-verified');
    if (vBadge) vBadge.style.display = p.verified_status ? '' : 'none';
    setText('p-city',      p.location  || '—');
    setText('p-employees', p.employees || '—');
    setText('p-capacity',  p.capacity  || '—');
    setText('p-founded',   p.founded   || '—');

    setVal('pf-name',      p.company   || '');
    setVal('pf-type',      cap(p.role  || 'Manufacturer'));
    setVal('pf-city',      p.location  || '');
    setVal('pf-founded',   p.founded   || '');
    setVal('pf-employees', p.employees || '');
    setVal('pf-capacity',  p.capacity  || '');
    setVal('pf-about',     p.about     || '');

    /* Sidebar pill stays in sync (auth guard set it on first paint;
       here we update after profile edits). */
    const sideName = $('.user-pill .user-name');
    const sideRole = $('.user-pill .user-role');
    const sideAv   = $('.user-pill .user-avatar');
    if (sideName) sideName.textContent = company;
    if (sideRole) sideRole.textContent = cap(p.role || 'Manufacturer');
    if (sideAv)   sideAv.textContent   = initialsTxt;

    /* Certifications */
    const certGrid = $('#p-cert-grid');
    if (certGrid) {
      const certs = Array.isArray(p.certifications) ? p.certifications : [];
      if (!certs.length) {
        certGrid.innerHTML = `
          <div class="empty-state" style="grid-column: 1 / -1; padding: 24px; text-align: center;">
            <p style="font-size:0.88rem; color: var(--text-muted);">No certifications listed yet. Add ISO, FIFA Quality Pro, FDA, etc. once verified.</p>
          </div>`;
      } else {
        certGrid.innerHTML = certs.map(c => `
          <div class="cert-chip">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>
            </svg>
            <div>
              <strong>${escapeHtml(c.name || c)}</strong>
              ${c.body ? `<span>${escapeHtml(c.body)}${c.year ? ' · ' + escapeHtml(c.year) : ''}</span>` : ''}
            </div>
          </div>`).join('');
      }
    }
  }

  async function saveProfile(e) {
    e && e.preventDefault();
    const patch = {
      company:   Auth.sanitize($('#pf-name').value),
      location:  Auth.sanitize($('#pf-city').value),
      employees: Auth.sanitize($('#pf-employees').value),
      capacity:  Auth.sanitize($('#pf-capacity').value),
      founded:   parseInt($('#pf-founded').value, 10) || null,
      about:     Auth.sanitize($('#pf-about').value)
    };
    Object.assign(state.profile, patch);
    if (sb) {
      const { error } = await sb.from('profiles').update(patch).eq('id', me.user.id);
      if (error) { console.warn('profile save', error); toast('Could not save: ' + error.message); return; }
    }
    bootProfile();
    toast('Profile saved.');
  }

  /* ════════════════════════════════════════
     MESSAGES VIEW
  ════════════════════════════════════════ */
  async function renderThreads() {
    const list = $('#thread-list');
    if (!list) return;
    let threads = state.threads;
    if (state.search) {
      const q = state.search;
      threads = threads.filter(t => (t.last_preview || '').toLowerCase().includes(q));
    }
    if (!threads.length) {
      list.innerHTML = '<div class="popover-empty">' +
        (state.search ? 'No conversations match.' : 'No conversations yet. Send a quote to start one.') +
        '</div>';
      hideThreadPane();
      return;
    }
    list.innerHTML = threads.map((t, i) => threadHtml(t, i)).join('');
    list.querySelectorAll('.thread-item').forEach(item =>
      item.addEventListener('click', () => openThread(item.dataset.id))
    );
    /* Auto-open the first thread if none selected */
    if (!state.activeThreadId && threads[0]) openThread(threads[0].id);
  }

  function threadHtml(t, i) {
    const ini = initials(t.last_preview || 'Thread');
    return `
      <div class="thread-item${t.id === state.activeThreadId ? ' active' : ''}" data-id="${escapeHtml(t.id)}" style="--i:${i}">
        <div class="thread-avatar">${escapeHtml(ini)}</div>
        <div class="thread-body">
          <div class="thread-name">Thread · ${escapeHtml((t.id || '').slice(0,6))}</div>
          <div class="thread-preview">${escapeHtml(t.last_preview || '')}</div>
        </div>
        <div class="thread-meta">${fmtAgo(t.last_at)}</div>
      </div>`;
  }

  async function openThread(id) {
    state.activeThreadId = id;
    await loadThreadMessages(id);
    renderThreads();
    renderActiveThread();
  }

  function hideThreadPane() {
    const pane = $('#thread-messages');
    if (pane) pane.innerHTML = `
      <div class="empty-state" style="margin:auto; padding:32px; text-align:center;">
        <p style="color:var(--text-muted); font-size:0.92rem;">Select a conversation, or start one by sending a quote.</p>
      </div>`;
  }

  function renderActiveThread() {
    const t = state.threads.find(x => x.id === state.activeThreadId);
    if (!t) { hideThreadPane(); return; }
    const nameEl  = $('#thread-name');
    const subEl   = $('#thread-sub');
    const avEl    = $('#thread-avatar');
    const msgsEl  = $('#thread-messages');
    if (nameEl) nameEl.textContent = 'Conversation · ' + (t.id || '').slice(0,6);
    if (subEl)  subEl.textContent  = t.rfq_id ? 'Re: RFQ ' + (t.rfq_id || '').slice(0,6) : 'Direct message';
    if (avEl)   avEl.textContent   = initials(t.last_preview || 'Thread');
    if (msgsEl) {
      if (!state.activeThreadMessages.length) {
        msgsEl.innerHTML = '<div class="popover-empty">No messages yet — say hi.</div>';
      } else {
        msgsEl.innerHTML = state.activeThreadMessages.map(m => `
          <div class="msg ${m.sender_id === me.user.id ? 'me' : 'them'}">
            ${escapeHtml(m.body)}
            <span class="msg-time">${fmtClock(m.created_at)}</span>
          </div>`).join('');
        msgsEl.scrollTop = msgsEl.scrollHeight;
      }
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!state.activeThreadId) { toast('Open a conversation first.'); return; }
    const input = $('#thread-composer-input');
    const body = Auth.sanitize(input.value);
    if (!body) return;
    input.value = '';
    if (!sb) { toast('Connect Supabase to send real messages.'); return; }
    const { data, error } = await sb.from('messages').insert({
      thread_id: state.activeThreadId,
      sender_id: me.user.id,
      body
    }).select('*').single();
    if (error) { console.warn('send msg', error); toast(error.message || 'Could not send.'); return; }
    state.activeThreadMessages.push(data);
    const t = state.threads.find(x => x.id === state.activeThreadId);
    if (t) { t.last_preview = body; t.last_at = data.created_at; }
    renderActiveThread();
    renderThreads();
  }

  /* ════════════════════════════════════════
     MODAL CORE
  ════════════════════════════════════════ */
  function openModal(m) {
    if (!m) return;
    m.classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeModals() {
    $$('.modal-backdrop').forEach(m => m.classList.remove('show'));
    document.body.style.overflow = '';
    currentQuoteLead = null;
  }

  /* ════════════════════════════════════════
     TOAST
  ════════════════════════════════════════ */
  const toastStack = $('#toast-stack');
  function toast(msg) {
    if (!toastStack) return Auth.toast(msg, 'info');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/>
      </svg><span>${escapeHtml(msg)}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 260); }, 3400);
  }

  /* ════════════════════════════════════════
     Time tick — re-format relative times every minute
  ════════════════════════════════════════ */
  setInterval(() => {
    $$('.lead-time').forEach(el => {
      const card = el.closest('.lead-card');
      if (!card) return;
      const id = card.dataset.leadId;
      const l = state.leads.find(x => x.id === id);
      if (l) el.textContent = fmtAgo(l.created_at);
    });
  }, 60_000);
})();
