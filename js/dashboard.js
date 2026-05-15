/* ════════════════════════════════════════
   NEXORA — Manufacturer Dashboard ("The Bench")
   100% Supabase-backed. Renders into the
   new dashboard-pro.css markup with charts.js.
═══════════════════════════════════════════ */
(function () {
  const Auth = window.NexoraAuth;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* Wait for the Nexora Guard to release the body */
  function onReady(fn) {
    if (!document.body.classList.contains('auth-pending')) return fn();
    const obs = new MutationObserver(() => {
      if (!document.body.classList.contains('auth-pending')) { obs.disconnect(); fn(); }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }
  onReady(boot);

  /* ════════════════════════════════════════
     UTILITIES
  ════════════════════════════════════════ */
  const fmtNum   = n => Number(n ?? 0).toLocaleString('en-US');
  const fmtMoney = n => '$' + Number(n ?? 0).toFixed(2);
  const fmtKilo  = n => {
    const v = Number(n) || 0;
    return v >= 1000 ? Math.round(v / 1000) : v;
  };
  function fmtAgo(iso) {
    if (!iso) return '—';
    const min = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
    if (min < 1)   return 'just now';
    if (min < 60)  return Math.floor(min) + 'm ago';
    const h = min / 60;
    if (h < 24)    return Math.floor(h) + 'h ago';
    const d = h / 24;
    if (d < 7)     return Math.floor(d) + 'd ago';
    if (d < 30)    return 'last week';
    return Math.floor(d / 30) + 'mo ago';
  }
  function fmtClock(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Date.now() - d.getTime() < 86_400_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());
  const initials = name => (name || '··').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  };

  /* Country flag map for geo list */
  const FLAGS = {
    Germany: '🇩🇪', 'United Kingdom': '🇬🇧', UK: '🇬🇧', USA: '🇺🇸', 'United States': '🇺🇸',
    Italy: '🇮🇹', France: '🇫🇷', Netherlands: '🇳🇱', Spain: '🇪🇸', Australia: '🇦🇺',
    Japan: '🇯🇵', UAE: '🇦🇪', Canada: '🇨🇦', Brazil: '🇧🇷', Sweden: '🇸🇪',
    'South Africa': '🇿🇦', Pakistan: '🇵🇰', India: '🇮🇳', China: '🇨🇳'
  };
  const flagFor = c => FLAGS[c] || '🌐';

  const INDUSTRY_PIP = { surgical: 'I', sports: 'II', leather: 'III' };
  const INDUSTRY_CHIP_CLASS = { surgical: 'chip--surg', sports: 'chip--sport', leather: 'chip--leath' };
  const INDUSTRY_PIP_CLASS  = { surgical: 'pip--surg',  sports: 'pip--sport',  leather: 'pip--leath' };

  /* ════════════════════════════════════════
     STATE
  ════════════════════════════════════════ */
  let sb, me, state;

  async function boot() {
    sb = Auth.client();
    me = window.NEXORA_USER || (await Auth.getCurrentUser());
    if (!me || !me.user) {
      Auth.toast('Session expired. Please sign in again.', 'error');
      setTimeout(() => location.replace('auth.html'), 600);
      return;
    }

    state = {
      view: 'dashboard',
      benchFilter: 'all',
      rfqsFilter: 'all',
      window: 'today',
      leads: [],
      myQuotes: [],
      quotedIds: new Set(),
      quoteByLead: {},
      notifs: [],
      threads: [],
      activeThreadId: null,
      activeThreadMessages: [],
      profile: me.profile || {},
      popoverOpen: false
    };

    wireUI();

    if (sb) {
      await Promise.all([loadLeads(), loadMyQuotes(), loadNotifications(), loadThreads()]);
      subscribeRealtime();
    } else {
      Auth.toast('Connect Supabase in js/config.js to load live data.', 'warn', { timeout: 6000 });
    }

    renderEverything();
    bootProfile();
  }

  /* ════════════════════════════════════════
     DATA LAYER
  ════════════════════════════════════════ */
  async function loadLeads() {
    const industry = state.profile.industry;
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
      .select('*').eq('manufacturer_id', me.user.id)
      .order('last_at', { ascending: false });
    if (error) { console.warn('loadThreads', error); return; }
    state.threads = data || [];
  }
  async function loadThreadMessages(id) {
    const { data, error } = await sb.from('messages')
      .select('*').eq('thread_id', id).order('created_at', { ascending: true });
    if (error) { console.warn('loadThreadMessages', error); return; }
    state.activeThreadMessages = data || [];
  }

  /* ════════════════════════════════════════
     REALTIME
  ════════════════════════════════════════ */
  function subscribeRealtime() {
    sb.channel('nx-rfqs-mfg')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rfqs' }, p => {
        const r = p.new;
        if (state.profile.industry && state.profile.industry !== 'mixed' && r.industry !== state.profile.industry) return;
        state.leads.unshift(r);
        renderBenchSlice();
        renderRfqsSlice();
        renderKpis();
        renderActivityFromState();
        toastNew(`New ${cap(r.industry)} lead · ${r.product}`);
      })
      .subscribe();

    sb.channel('nx-notif-mfg').on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${me.user.id}` },
      p => { state.notifs.unshift(p.new); renderNotifs(); renderActivityFromState(); }
    ).subscribe();

    sb.channel('nx-msgs-mfg').on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      p => {
        const m = p.new;
        if (state.activeThreadId && m.thread_id === state.activeThreadId) {
          state.activeThreadMessages.push(m);
          if (state.view === 'messages') renderActiveThread();
        }
        const t = state.threads.find(x => x.id === m.thread_id);
        if (t) {
          t.last_preview = m.body; t.last_at = m.created_at;
          if (state.view === 'messages') renderThreadList();
        }
      }
    ).subscribe();
  }

  /* ════════════════════════════════════════
     UI WIRING
  ════════════════════════════════════════ */
  function wireUI() {
    /* Sidebar nav */
    $$('.nav-item[data-section]').forEach(n =>
      n.addEventListener('click', e => { e.preventDefault(); setView(n.dataset.section); })
    );
    /* Inline links that switch view */
    $$('[data-section-link]').forEach(a =>
      a.addEventListener('click', e => { e.preventDefault(); setView(a.dataset.sectionLink); })
    );

    /* Bench filters (dashboard view) */
    $$('#bench-filters .tab').forEach(t =>
      t.addEventListener('click', () => {
        $$('#bench-filters .tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        state.benchFilter = t.dataset.filter;
        renderBenchSlice();
      })
    );
    /* RFQs view filters */
    $$('#rfqs-filters .tab').forEach(t =>
      t.addEventListener('click', () => {
        $$('#rfqs-filters .tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        state.rfqsFilter = t.dataset.filter;
        renderRfqsSlice();
      })
    );

    /* Window tabs (today/week/month) */
    $$('.page-head-meta .tabs .tab[data-window]').forEach(t =>
      t.addEventListener('click', () => {
        $$('.page-head-meta .tabs .tab[data-window]').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        state.window = t.dataset.window;
        renderKpis();
      })
    );

    /* Search */
    const search = $('#topbar-search-input');
    if (search) search.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      if (state.view === 'rfqs')   renderRfqsSlice(q);
      if (state.view === 'quotes') renderQuotesSlice(q);
      if (state.view === 'messages') renderThreadList(q);
    });

    /* Notifications popover */
    const notifBtn = $('#btn-notifs');
    if (notifBtn) notifBtn.addEventListener('click', e => {
      e.stopPropagation();
      const pop = $('#popover-notifs');
      state.popoverOpen = !state.popoverOpen;
      pop.style.display = state.popoverOpen ? 'block' : 'none';
    });
    document.addEventListener('click', e => {
      if (e.target.closest('#popover-notifs') || e.target.closest('#btn-notifs')) return;
      const pop = $('#popover-notifs');
      if (pop) { pop.style.display = 'none'; state.popoverOpen = false; }
    });
    const clear = $('#notif-clear');
    if (clear) clear.addEventListener('click', e => { e.preventDefault(); markAllRead(); });

    /* Modals */
    $$('[data-close-modal]').forEach(b => b.addEventListener('click', closeModals));
    $$('.modal-backdrop').forEach(bd =>
      bd.addEventListener('click', e => { if (e.target === bd) closeModals(); })
    );
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });

    /* Quote submit */
    const qSubmit = $('#q-submit');
    if (qSubmit) qSubmit.addEventListener('click', submitQuote);

    /* Profile */
    const pSave = $('#profile-save'), pCancel = $('#profile-cancel');
    if (pSave)   pSave.addEventListener('click', saveProfile);
    if (pCancel) pCancel.addEventListener('click', e => { e.preventDefault(); bootProfile(); toastNew('Changes discarded.'); });

    /* Messages composer */
    const composer = $('#thread-composer-form');
    if (composer) composer.addEventListener('submit', sendMessage);

    /* User pill → profile */
    const pill = $('.user-pill');
    if (pill) pill.addEventListener('click', () => setView('profile'));
  }

  /* ════════════════════════════════════════
     VIEW SWITCHING
  ════════════════════════════════════════ */
  const VIEW_TITLES = {
    dashboard: 'Live workspace',
    rfqs:      'All open RFQs',
    quotes:    'My quotes',
    messages:  'Messages',
    profile:   'Account profile'
  };
  const VIEW_EYEBROWS = {
    dashboard: 'The Bench',
    rfqs:      'Live RFQs',
    quotes:    'My quotes',
    messages:  'Inbox',
    profile:   'Account'
  };
  function setView(name) {
    state.view = name;
    $$('.nav-item[data-section]').forEach(n =>
      n.classList.toggle('active', n.dataset.section === name)
    );
    $$('.canvas .view').forEach(v =>
      v.classList.toggle('is-active', v.dataset.view === name)
    );
    const title = $('#topbar-section-title');
    const eye   = $('#topbar-eyebrow');
    if (title) title.textContent = VIEW_TITLES[name]   || '';
    if (eye)   eye.textContent   = VIEW_EYEBROWS[name] || 'The Bench';
    if (name === 'rfqs')     renderRfqsSlice();
    if (name === 'quotes')   renderQuotesSlice();
    if (name === 'messages') { renderThreadList(); if (!state.activeThreadId && state.threads[0]) openThread(state.threads[0].id); }
    if (name === 'profile')  bootProfile();
  }

  /* ════════════════════════════════════════
     RENDER ORCHESTRATION
  ════════════════════════════════════════ */
  function renderEverything() {
    renderHeader();
    renderKpis();
    renderRevenueChart();
    renderIndustryDonut();
    renderFunnel();
    renderGeo();
    renderBenchSlice();
    renderRfqsSlice();
    renderQuotesSlice();
    renderActivityFromState();
    renderCapacity();
    renderVerifyCard();
    renderNotifs();
    renderBadges();
    renderSync();
  }

  function renderHeader() {
    const p = state.profile;
    const name = (p.full_name || p.company || 'there').split(/\s+/)[0];
    $('#ph-name').textContent  = name;
    $('#ph-count').textContent = state.leads.length;
    const dest = new Set(state.leads.map(l => l.destination)).size;
    $('#ph-sub').textContent = state.leads.length
      ? `Open requirements from verified buyers across ${dest} ${dest === 1 ? 'market' : 'markets'}, streaming live.`
      : 'No open RFQs yet — they\'ll appear here as buyers post requirements.';

    const today = state.leads.filter(l => isWithin(l.created_at, 1)).length;
    const week  = state.leads.filter(l => isWithin(l.created_at, 7)).length;
    const month = state.leads.filter(l => isWithin(l.created_at, 30)).length;
    $('#win-today').textContent = today;
    $('#win-week').textContent  = week;
    $('#win-month').textContent = month;
  }

  function isWithin(iso, days) {
    if (!iso) return false;
    return (Date.now() - new Date(iso).getTime()) <= days * 86_400_000;
  }

  /* ════════════════════════════════════════
     KPI ROW
  ════════════════════════════════════════ */
  function renderKpis() {
    const open = state.leads.length;
    const sent = state.myQuotes.length;
    const pipelineRaw = state.myQuotes.reduce((sum, q) => {
      const qty = (q.rfqs && q.rfqs.quantity) || 0;
      return sum + (Number(q.unit_price) || 0) * qty;
    }, 0);
    const pipelineK = Math.round(pipelineRaw / 1000);
    const won = state.myQuotes.filter(q => q.status === 'accepted').length;
    const winRate = sent ? (won / sent) * 100 : 0;

    setKpi('#kpi-open',     open,     0);
    setKpi('#kpi-quotes',   sent,     0);
    setKpi('#kpi-pipeline', pipelineK,0);
    setKpi('#kpi-winrate',  winRate,  1);

    $('#kpi-open-delta').textContent = state.profile.industry
      ? `▶ ${cap(state.profile.industry)}`
      : '▶ All industries';
    $('#kpi-open-delta').className = 'delta';

    $('#kpi-quotes-delta').textContent = sent ? `▲ ${won} won` : '—';
    $('#kpi-quotes-delta').className = sent && won ? 'delta up' : 'delta';

    /* Sparklines */
    const sparkSeries = computeSparklines();
    drawSpark('spark-rfqs',     sparkSeries.rfqs);
    drawSpark('spark-quotes',   sparkSeries.quotes);
    drawSpark('spark-pipeline', sparkSeries.pipeline);
    drawSpark('spark-win',      sparkSeries.win);
  }

  function setKpi(sel, value, decimals) {
    const el = $(sel);
    if (!el) return;
    el.dataset.target = String(value);
    if (decimals != null) el.dataset.decimals = String(decimals);
    if (window.NX && NX.animateCounter) {
      NX.animateCounter(el, value, { decimals: decimals || 0, duration: 800 });
    } else {
      el.textContent = decimals ? value.toFixed(decimals) : Math.floor(value).toLocaleString();
    }
  }

  function drawSpark(id, data) {
    const wrap = document.getElementById(id);
    if (!wrap || !window.NX || !NX.sparkline || !data || !data.length) return;
    const html = NX.sparkline(data, { width: 96, height: 32, color: 'var(--accent)' });
    /* The NX.sparkline returns an SVG string; replace the wrapper's inner content */
    wrap.innerHTML = html;
    wrap.id = id; // preserve the id
  }

  function computeSparklines() {
    /* Group by week-day buckets across last 8 buckets (~8 weeks) */
    const buckets = 8;
    const now = Date.now();
    const spanMs = 7 * 86_400_000;
    function bucketize(items, valueFn) {
      const arr = new Array(buckets).fill(0);
      items.forEach(item => {
        const t = new Date(item.created_at).getTime();
        if (!t) return;
        const age = now - t;
        const idx = buckets - 1 - Math.floor(age / spanMs);
        if (idx >= 0 && idx < buckets) arr[idx] += (valueFn ? valueFn(item) : 1);
      });
      /* If totally flat, give it one tiny value so the line draws */
      if (arr.every(v => v === 0)) return arr.map((_, i) => i);
      return arr;
    }
    return {
      rfqs:     bucketize(state.leads),
      quotes:   bucketize(state.myQuotes),
      pipeline: bucketize(state.myQuotes, q => ((q.rfqs && q.rfqs.quantity) || 0) * (Number(q.unit_price) || 0) / 1000),
      win:      bucketize(state.myQuotes.filter(q => q.status === 'accepted'))
    };
  }

  /* ════════════════════════════════════════
     REVENUE CHART (8-month area)
  ════════════════════════════════════════ */
  function renderRevenueChart() {
    const wrap = document.getElementById('revenue-chart');
    if (!wrap || !window.NX) return;
    const months = ['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'];
    const now = new Date();
    const last8 = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      last8.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: months[d.getMonth()] });
    }
    const sums = Object.fromEntries(last8.map(m => [m.key, 0]));
    state.myQuotes.forEach(q => {
      const t = new Date(q.created_at);
      const key = `${t.getFullYear()}-${t.getMonth()}`;
      if (sums[key] != null) {
        const qty = (q.rfqs && q.rfqs.quantity) || 0;
        sums[key] += (Number(q.unit_price) || 0) * qty;
      }
    });
    const data = last8.map(m => ({ label: m.label, value: sums[m.key] }));
    const total = data.reduce((s, d) => s + d.value, 0);
    $('#lg-quoted').textContent = '$' + Math.round(total / 1000).toLocaleString() + 'k';
    wrap.innerHTML = '';
    NX.areaChart(wrap, {
      width: 760, height: 260,
      data,
      color: 'var(--accent)',
      smooth: true
    });
  }

  /* ════════════════════════════════════════
     INDUSTRY DONUT + LEGEND
  ════════════════════════════════════════ */
  function renderIndustryDonut() {
    const wrap = document.getElementById('industry-donut');
    if (!wrap || !window.NX) return;
    const buckets = { surgical: 0, sports: 0, leather: 0 };
    state.leads.forEach(l => { if (buckets[l.industry] != null) buckets[l.industry]++; });
    const total = buckets.surgical + buckets.sports + buckets.leather;
    wrap.innerHTML = '';
    NX.donut(wrap, {
      size: 200,
      data: [
        { label: 'Surgical', value: buckets.surgical || 0.0001, color: 'var(--ind-surgical)' },
        { label: 'Sports',   value: buckets.sports   || 0.0001, color: 'var(--ind-sports)' },
        { label: 'Leather',  value: buckets.leather  || 0.0001, color: 'var(--ind-leather)' },
      ],
      centerValue: String(total || 0),
      centerLabel: 'RFQs'
    });

    const lg = $('#industry-legend');
    if (!lg) return;
    if (!total) {
      lg.innerHTML = `<div style="color:var(--text-muted);font-size:0.86rem;">No open RFQs yet — once buyers post, the mix will fill in here.</div>`;
      return;
    }
    const rows = ['surgical','sports','leather'].map(k => {
      const n = buckets[k]; const pct = Math.round(100 * n / total);
      return `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:0.85rem;">
            <span style="display:inline-flex;align-items:center;gap:8px;color:var(--text);"><span class="pip ${INDUSTRY_PIP_CLASS[k]}">${INDUSTRY_PIP[k]}</span>${cap(k)}</span>
            <span style="font-family:var(--font-mono);color:var(--text);">${pct}%</span>
          </div>
          <div class="bar-cell" style="width:100%;margin-top:6px;--p:${pct/100};"><div class="bar-cell-fill" style="background:var(--ind-${k});"></div></div>
          <div style="font-size:0.74rem;color:var(--text-muted);margin-top:4px;font-family:var(--font-mono);">${n} ${n===1?'RFQ':'RFQs'} open</div>
        </div>`;
    });
    lg.innerHTML = rows.join('');
  }

  /* ════════════════════════════════════════
     FUNNEL
  ════════════════════════════════════════ */
  function renderFunnel() {
    const wrap = document.getElementById('funnel-stack');
    if (!wrap) return;
    const sent     = state.myQuotes.length;
    const seen     = state.myQuotes.filter(q => ['seen','accepted','rejected'].includes(q.status)).length;
    const accepted = state.myQuotes.filter(q => q.status === 'accepted').length;
    const total    = Math.max(state.leads.length + sent, 1);

    const rows = [
      { lbl: 'Leads on bench', pct: state.leads.length / total, n: state.leads.length, tone: 'tone-1' },
      { lbl: 'Quoted',         pct: sent / total,     n: sent,     tone: 'tone-2' },
      { lbl: 'Seen by buyer',  pct: seen / total,     n: seen,     tone: 'tone-3' },
      { lbl: 'Accepted',       pct: accepted / total, n: accepted, tone: 'tone-5' },
    ];
    wrap.innerHTML = rows.map(r => `
      <div class="funnel-step" style="--p:${r.pct.toFixed(2)};">
        <div class="lbl">${esc(r.lbl)}<span class="pct">${Math.round(r.pct*100)}%</span></div>
        <div class="funnel-bar"><span class="${r.tone}" style="width:100%;"></span></div>
        <div class="vl">${r.n}</div>
      </div>`).join('');

    /* sub-stats */
    $('#funnel-conv').textContent  = sent ? Math.round(100 * accepted / sent) : 0;
    const avgTicket = state.myQuotes.length
      ? state.myQuotes.reduce((s, q) => s + (Number(q.unit_price) || 0) * ((q.rfqs && q.rfqs.quantity) || 0), 0) / state.myQuotes.length
      : 0;
    $('#funnel-ticket').textContent = Math.round(avgTicket).toLocaleString();
    $('#funnel-markets').textContent = new Set(state.leads.map(l => l.destination)).size;
  }

  /* ════════════════════════════════════════
     GEO LIST
  ════════════════════════════════════════ */
  function renderGeo() {
    const wrap = document.getElementById('geo-list');
    if (!wrap) return;
    const counts = {};
    state.leads.forEach(l => { counts[l.destination] = (counts[l.destination] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    $('#geo-count').textContent = Object.keys(counts).length;
    if (!sorted.length) {
      wrap.innerHTML = `<div style="padding:18px 4px;color:var(--text-muted);font-size:0.86rem;">No active markets yet.</div>`;
      return;
    }
    const max = sorted[0][1];
    wrap.innerHTML = sorted.map(([dest, n]) => {
      const pct = (n / max).toFixed(2);
      return `<div class="geo-row" style="--p:${pct};"><span class="ct">${flagFor(dest)}  ${esc(dest)}</span><span class="bar"><span></span></span><span class="vl">${n} RFQ${n===1?'':'s'}</span></div>`;
    }).join('');
  }

  /* ════════════════════════════════════════
     BENCH (dashboard view) — top 7 RFQs
  ════════════════════════════════════════ */
  function renderBenchSlice() {
    const tbody = $('#bench-tbody');
    if (!tbody) return;
    const all = state.leads;
    const filtered = state.benchFilter === 'all' ? all : all.filter(l => l.industry === state.benchFilter);

    /* Filter pill counts */
    setText('#ft-all',   all.length);
    setText('#ft-surg',  all.filter(l => l.industry === 'surgical').length);
    setText('#ft-sport', all.filter(l => l.industry === 'sports').length);
    setText('#ft-leath', all.filter(l => l.industry === 'leather').length);
    setText('#ot-count', all.length);

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-muted);">${
        all.length ? 'No matches in this filter.' : (state.profile.verified_status ? 'No live RFQs yet — new requirements appear here in real time.' : 'Awaiting verification — once approved, leads in your industry will appear here.')
      }</td></tr>`;
      $('#bench-foot').textContent = '—';
      return;
    }
    const top = filtered.slice(0, 7);
    tbody.innerHTML = top.map(rowHtml).join('');
    bindRowActions(tbody);
    $('#bench-foot').textContent = `Showing ${top.length} of ${filtered.length} open ${filtered.length === 1 ? 'RFQ' : 'RFQs'}`;
  }

  function renderRfqsSlice(searchOverride) {
    const tbody = $('#rfqs-tbody');
    if (!tbody) return;
    const all = state.leads;
    const filtered = state.rfqsFilter === 'all' ? all : all.filter(l => l.industry === state.rfqsFilter);
    const q = (searchOverride != null ? searchOverride : ($('#topbar-search-input') ? $('#topbar-search-input').value.trim().toLowerCase() : ''));
    const finalRows = q
      ? filtered.filter(l => (l.product||'').toLowerCase().includes(q) || (l.destination||'').toLowerCase().includes(q))
      : filtered;

    setText('#rf-all',   all.length);
    setText('#rf-surg',  all.filter(l => l.industry === 'surgical').length);
    setText('#rf-sport', all.filter(l => l.industry === 'sports').length);
    setText('#rf-leath', all.filter(l => l.industry === 'leather').length);

    if (!finalRows.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-muted);">No RFQs match.</td></tr>`;
      return;
    }
    tbody.innerHTML = finalRows.map(rowHtml).join('');
    bindRowActions(tbody);
  }

  function rowHtml(l) {
    const isQuoted = state.quotedIds.has(l.id);
    const av = initials((l.posted_by || '').slice(-2).toUpperCase()) || '··';
    return `
      <tr data-id="${esc(l.id)}">
        <td>
          <div class="dt-cell-main">
            <div class="av">${esc(av)}</div>
            <div>
              <div class="ti">Verified buyer · ${esc((l.id||'').slice(0,6))}</div>
              <div class="su">${esc((l.product || '—'))}${l.specs ? ' · ' + esc(l.specs.slice(0, 70)) : ''}</div>
            </div>
          </div>
        </td>
        <td><span class="chip ${INDUSTRY_CHIP_CLASS[l.industry] || ''}">${INDUSTRY_PIP[l.industry] || ''} ${cap(l.industry || '')}</span></td>
        <td>${flagFor(l.destination)} ${esc(l.destination || '—')}</td>
        <td class="ta-right col-mono">${fmtNum(l.quantity)} ${esc((l.unit||'').slice(0,4))}</td>
        <td class="ta-right col-mono">${l.target_price != null ? fmtMoney(l.target_price) : '—'}</td>
        <td><span class="chip ${isQuoted ? 'chip--quoted' : 'chip--open'}">${isQuoted ? 'Quoted' : 'New'}</span></td>
        <td class="ta-right col-mono" style="color:var(--text-muted);">${fmtAgo(l.created_at)}</td>
        <td class="ta-right">
          ${isQuoted
            ? `<button class="btn btn-ghost btn-xs" data-action="details" data-id="${esc(l.id)}">View</button>`
            : `<button class="btn btn-primary btn-xs" data-action="quote" data-id="${esc(l.id)}">Quote →</button>`}
        </td>
      </tr>`;
  }

  function bindRowActions(scope) {
    scope.querySelectorAll('[data-action="quote"]').forEach(b =>
      b.addEventListener('click', e => { e.stopPropagation(); openQuoteModal(b.dataset.id); })
    );
    scope.querySelectorAll('[data-action="details"]').forEach(b =>
      b.addEventListener('click', e => { e.stopPropagation(); openDetailsModal(b.dataset.id); })
    );
    scope.querySelectorAll('tr[data-id]').forEach(tr =>
      tr.addEventListener('click', () => openDetailsModal(tr.dataset.id))
    );
  }

  /* ════════════════════════════════════════
     MY QUOTES TABLE
  ════════════════════════════════════════ */
  function renderQuotesSlice(searchOverride) {
    const tbody = $('#quotes-tbody');
    if (!tbody) return;
    const q = searchOverride != null ? searchOverride : '';
    let rows = state.myQuotes;
    if (q) rows = rows.filter(x =>
      ((x.rfqs||{}).product || '').toLowerCase().includes(q) ||
      ((x.rfqs||{}).destination || '').toLowerCase().includes(q));

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--text-muted);">You haven't sent any quotes yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(qr => {
      const r = qr.rfqs || {};
      const status = qr.status === 'accepted' ? 'won' : qr.status === 'rejected' ? 'lost' : 'quoted';
      return `
        <tr data-id="${esc(qr.rfq_id)}">
          <td><div class="ti">${esc(r.product || '—')}</div><div class="su">${esc((qr.id||'').slice(0,8))}</div></td>
          <td><span class="chip ${INDUSTRY_CHIP_CLASS[r.industry] || ''}">${INDUSTRY_PIP[r.industry] || ''} ${cap(r.industry || '')}</span></td>
          <td>${flagFor(r.destination)} ${esc(r.destination || '—')}</td>
          <td class="ta-right col-mono">${fmtMoney(qr.unit_price)}</td>
          <td><span class="chip chip--${status === 'won' ? 'won' : status === 'lost' ? 'open' : 'quoted'}">${cap(status)}</span></td>
          <td class="ta-right col-mono" style="color:var(--text-muted);">${fmtAgo(qr.created_at)}</td>
        </tr>`;
    }).join('');
  }

  /* ════════════════════════════════════════
     ACTIVITY FEED
  ════════════════════════════════════════ */
  function renderActivityFromState() {
    const wrap = $('#activity-feed');
    if (!wrap) return;
    /* Combine: recent notifications + recent quotes + recent leads */
    const items = [
      ...state.notifs.slice(0, 6).map(n => ({
        ts: n.created_at,
        kind: n.kind || 'event',
        html: n.body_html || esc(n.body || ''),
      })),
      ...state.myQuotes.slice(0, 3).map(q => ({
        ts: q.created_at,
        kind: 'quote_sent',
        html: `Quote sent — <span class="ent">${esc(((q.rfqs||{}).product) || 'RFQ')}</span> · ${fmtMoney(q.unit_price)}/unit`
      })),
      ...state.leads.slice(0, 3).map(l => ({
        ts: l.created_at,
        kind: 'rfq_new',
        html: `New RFQ — <span class="ent">${esc(l.product)}</span> · ${esc(l.destination || '')}`
      }))
    ].sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 8);

    if (!items.length) {
      wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.88rem;">No activity yet. New RFQs and messages will appear here in real time.</div>`;
      return;
    }
    wrap.innerHTML = items.map(it => `
      <div class="feed-item">
        <div class="feed-dot" style="color:${dotColor(it.kind)};">${dotIcon(it.kind)}</div>
        <div class="feed-text">${it.html}</div>
        <div class="feed-time">${fmtAgo(it.ts)}</div>
      </div>`).join('');
  }
  function dotColor(kind) {
    if (/won|accept/.test(kind))   return 'var(--success)';
    if (/quote/.test(kind))        return 'var(--accent)';
    if (/message|thread/.test(kind))return 'var(--ind-surgical)';
    if (/warn|expire/.test(kind))  return 'var(--warning)';
    return 'var(--text-mid)';
  }
  function dotIcon(kind) {
    if (/won|accept/.test(kind))    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>';
    if (/quote/.test(kind))         return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    if (/message|thread/.test(kind))return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>';
  }

  /* ════════════════════════════════════════
     CAPACITY GAUGE (right column)
  ════════════════════════════════════════ */
  function renderCapacity() {
    const wrap = document.getElementById('capacity-gauge');
    if (!wrap || !window.NX) return;
    /* Simple proxy: how many RFQs you've quoted vs how many you could quote */
    const possible = Math.max(state.leads.length + state.myQuotes.length, 1);
    const used = Math.min(state.myQuotes.length / possible, 1);
    wrap.innerHTML = '';
    NX.gauge(wrap, { size: 180, value: used, color: 'var(--accent)', label: 'Capacity used' });
    const txt = $('#capacity-text');
    if (txt) {
      txt.innerHTML = used === 0
        ? 'No quotes yet — capacity is wide open.'
        : `<strong style="color:var(--text);">${Math.round(used * 100)}%</strong> of available bench engaged. ${state.leads.length} fresh ${state.leads.length === 1 ? 'lead' : 'leads'} still open for you.`;
    }
  }

  /* ════════════════════════════════════════
     VERIFICATION CARD
  ════════════════════════════════════════ */
  function renderVerifyCard() {
    const sub = $('#verify-sub'), block = $('#verify-block');
    if (!sub || !block) return;
    const p = state.profile;
    if (p.is_admin) {
      sub.textContent = 'Admin · root';
      block.innerHTML = `You have admin privileges. <a href="admin.html" style="color:var(--accent);">Open the admin portal →</a>`;
      return;
    }
    if (p.verified_status) {
      sub.textContent = 'Verified by Nexora';
      block.innerHTML = `Your shop is fully verified. Quotes you send carry the verified badge.`;
      return;
    }
    sub.textContent = 'Awaiting verification';
    block.innerHTML = `Your application is in our review queue. You can already browse leads in your industry; once your SCCI credentials are confirmed, your quotes carry the verified badge.`;
  }

  /* ════════════════════════════════════════
     BADGES
  ════════════════════════════════════════ */
  function renderBadges() {
    setText('#bd-rfqs',     state.leads.length);
    setText('#bd-quotes',   state.myQuotes.length);
    setText('#bd-messages', state.threads.filter(t => t.last_at && (!t.read_at || t.last_at > t.read_at)).length || state.threads.length);
  }

  function renderSync() {
    const el = $('#sync-time');
    if (el) el.textContent = sb ? `last sync ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : 'demo mode';
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
    $('#q-title').textContent   = lead.product || '—';
    $('#q-sub').textContent     = `${fmtNum(lead.quantity)} ${lead.unit || ''} · ${lead.destination || ''}`;
    $('#q-sum-qty').textContent    = `${fmtNum(lead.quantity)} ${lead.unit || ''}`;
    $('#q-sum-target').textContent = lead.target_price != null ? fmtMoney(lead.target_price) : '—';
    $('#q-sum-dest').textContent   = lead.destination || '—';
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
    if (!price || price <= 0) { $('#q-price').focus(); toastNew('Please enter a valid unit price.'); return; }
    if (!sb) { toastNew('Connect Supabase to send real quotes.'); return; }
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
    if (error) { console.warn('quote insert', error); toastNew(error.message || 'Could not send quote.'); return; }
    state.myQuotes.unshift(data);
    state.quotedIds.add(data.rfq_id);
    state.quoteByLead[data.rfq_id] = data;
    toastNew(`Quote sent for ${currentQuoteLead.product}.`);
    closeModals();
    renderEverything();
  }

  /* ════════════════════════════════════════
     DETAILS MODAL
  ════════════════════════════════════════ */
  function openDetailsModal(id) {
    const lead = state.leads.find(l => l.id === id);
    if (!lead) return;
    const isQuoted = state.quotedIds.has(lead.id);
    $('#d-eyebrow').textContent = `Lead · ${(lead.id||'').slice(0,8)}`;
    $('#d-title').textContent   = lead.product || '—';
    $('#d-sub').textContent     = `${fmtNum(lead.quantity)} ${lead.unit || ''} · ${lead.destination || ''}`;
    $('#d-body').innerHTML = `
      <div class="detail-section">
        <h4>About</h4>
        <p style="color:var(--text);font-size:0.94rem;line-height:1.55;">${esc(lead.specs || '— no additional specifications provided —')}</p>
      </div>
      <div class="detail-section">
        <h4>Specifications</h4>
        <div class="detail-grid">
          <div class="meta-item"><span class="meta-label">Quantity</span><span class="meta-value"><strong>${fmtNum(lead.quantity)}</strong> ${esc(lead.unit||'')}</span></div>
          <div class="meta-item"><span class="meta-label">Destination</span><span class="meta-value">${esc(lead.destination||'—')}</span></div>
          <div class="meta-item"><span class="meta-label">Lead time</span><span class="meta-value">${esc(lead.lead_time||'—')}</span></div>
          <div class="meta-item"><span class="meta-label">Incoterm</span><span class="meta-value">${esc(lead.incoterm||'—')}</span></div>
          <div class="meta-item"><span class="meta-label">Target price</span><span class="meta-value">${lead.target_price!=null?fmtMoney(lead.target_price):'—'}</span></div>
          <div class="meta-item"><span class="meta-label">Reference</span><span class="meta-value">${esc(lead.id)}</span></div>
        </div>
      </div>
      <div class="detail-section">
        <h4>Status</h4>
        <span class="chip ${isQuoted ? 'chip--quoted' : 'chip--open'}">${isQuoted ? 'Quoted' : 'Open'}</span>
      </div>`;
    $('#d-cta').textContent = isQuoted ? 'Quote sent' : 'Send Quote';
    $('#d-cta').onclick = () => {
      closeModals();
      if (!isQuoted) setTimeout(() => openQuoteModal(lead.id), 280);
    };
    openModal($('#modal-details'));
  }

  /* ════════════════════════════════════════
     PROFILE
  ════════════════════════════════════════ */
  function bootProfile() {
    const p = state.profile;
    const company = p.company || p.full_name || (me.user && me.user.email) || 'Your shop';
    setText('#p-avatar', initials(company));
    setText('#p-name',   company);
    setText('#p-role',   cap(p.role || 'Manufacturer'));
    setText('#p-status', p.verified_status ? 'Verified' : 'Awaiting verification');
    setText('#p-city',   p.location || '—');
    setText('#p-industry', p.industry ? cap(p.industry) : '—');
    setText('#p-joined', p.created_at ? fmtAgo(p.created_at) : '—');
    const v = $('#p-verified'); if (v) v.style.display = p.verified_status ? 'inline-flex' : 'none';

    const set = (id, v) => { const el = $(id); if (el) el.value = v ?? ''; };
    set('#pf-name',      p.company || '');
    set('#pf-city',      p.location || '');
    set('#pf-founded',   p.founded || '');
    set('#pf-employees', p.employees || '');
    set('#pf-capacity',  p.capacity || '');
    set('#pf-about',     p.about || '');
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
      if (error) { console.warn('profile save', error); toastNew('Could not save: ' + error.message); return; }
    }
    bootProfile();
    /* Update sidebar pill */
    const av = $('#nx-user-avatar'), nm = $('#nx-user-name');
    if (av) av.textContent = initials(patch.company || patch.location || me.user.email);
    if (nm) nm.textContent = patch.company || me.user.email;
    toastNew('Profile saved.');
  }

  /* ════════════════════════════════════════
     MESSAGES
  ════════════════════════════════════════ */
  function renderThreadList(searchOverride) {
    const list = $('#thread-list');
    if (!list) return;
    const q = searchOverride != null ? searchOverride : '';
    let threads = state.threads;
    if (q) threads = threads.filter(t => (t.last_preview || '').toLowerCase().includes(q));
    if (!threads.length) {
      list.innerHTML = `<div style="padding:24px;color:var(--text-muted);font-size:0.86rem;text-align:center;">${q ? 'No matches.' : 'No conversations yet. Send a quote to start one.'}</div>`;
      return;
    }
    list.innerHTML = threads.map(t => {
      const ini = initials(t.last_preview || 'Thread');
      return `
        <div class="thread-item ${t.id === state.activeThreadId ? 'is-active' : ''}" data-id="${esc(t.id)}" style="display:grid;grid-template-columns:36px 1fr auto;gap:12px;padding:14px 18px;border-bottom:1px solid var(--rule);cursor:pointer;${t.id === state.activeThreadId ? 'background:var(--bg-elevated);' : ''}">
          <div class="user-avatar" style="width:36px;height:36px;font-size:0.8rem;background:var(--bg-deep);color:var(--text-mid);">${ini}</div>
          <div style="min-width:0;">
            <div style="font-size:0.88rem;font-weight:500;color:var(--text);">Thread · ${esc((t.id||'').slice(0,6))}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.last_preview || '')}</div>
          </div>
          <div style="font-size:0.74rem;color:var(--text-muted);text-align:right;">${fmtAgo(t.last_at)}</div>
        </div>`;
    }).join('');
    list.querySelectorAll('.thread-item').forEach(item =>
      item.addEventListener('click', () => openThread(item.dataset.id))
    );
  }
  async function openThread(id) {
    state.activeThreadId = id;
    await loadThreadMessages(id);
    renderThreadList();
    renderActiveThread();
  }
  function renderActiveThread() {
    const t = state.threads.find(x => x.id === state.activeThreadId);
    if (!t) return;
    $('#thread-name').textContent = 'Conversation · ' + (t.id||'').slice(0,6);
    $('#thread-sub').textContent  = t.rfq_id ? 'Re: RFQ ' + (t.rfq_id||'').slice(0,6) : 'Direct message';
    $('#thread-avatar').textContent = initials(t.last_preview || 'Thread');
    const msgs = $('#thread-messages');
    if (!state.activeThreadMessages.length) {
      msgs.innerHTML = `<div style="margin:auto;color:var(--text-muted);font-size:0.88rem;">No messages yet — say hi.</div>`;
      return;
    }
    msgs.innerHTML = state.activeThreadMessages.map(m => {
      const mine = m.sender_id === me.user.id;
      return `<div style="max-width:72%;padding:10px 14px;border-radius:var(--radius-md);font-size:0.92rem;line-height:1.5;align-self:${mine ? 'flex-end' : 'flex-start'};${mine ? 'background:var(--accent);color:#fff;border-bottom-right-radius:4px;' : 'background:var(--surface);border:1px solid var(--border);border-bottom-left-radius:4px;'}">${esc(m.body)}<span style="display:block;font-size:0.7rem;margin-top:4px;opacity:0.7;">${fmtClock(m.created_at)}</span></div>`;
    }).join('');
    msgs.scrollTop = msgs.scrollHeight;
  }
  async function sendMessage(e) {
    e.preventDefault();
    if (!state.activeThreadId) { toastNew('Open a conversation first.'); return; }
    const input = $('#thread-composer-input');
    const body = Auth.sanitize(input.value);
    if (!body) return;
    input.value = '';
    if (!sb) return;
    const { data, error } = await sb.from('messages').insert({
      thread_id: state.activeThreadId, sender_id: me.user.id, body
    }).select('*').single();
    if (error) { console.warn('send msg', error); return; }
    state.activeThreadMessages.push(data);
    const t = state.threads.find(x => x.id === state.activeThreadId);
    if (t) { t.last_preview = body; t.last_at = data.created_at; }
    renderActiveThread();
    renderThreadList();
  }

  /* ════════════════════════════════════════
     NOTIFICATIONS
  ════════════════════════════════════════ */
  function renderNotifs() {
    const list = $('#notif-list');
    const pip  = $('#notif-pip');
    const unread = state.notifs.filter(n => !n.read_at).length;
    if (pip) pip.hidden = !unread;
    if (!list) return;
    if (!state.notifs.length) {
      list.innerHTML = `<div style="padding:28px 18px;text-align:center;color:var(--text-muted);font-size:0.88rem;">You're all caught up.</div>`;
      return;
    }
    list.innerHTML = state.notifs.map(n => `
      <div class="notif-item" data-id="${esc(n.id)}" style="padding:12px 18px;border-bottom:1px solid var(--rule);cursor:pointer;${!n.read_at ? 'background:var(--accent-tint);' : ''}">
        <div style="font-size:0.86rem;color:var(--text);line-height:1.45;">${n.body_html || esc(n.body || '')}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${fmtAgo(n.created_at)}</div>
      </div>`).join('');
    list.querySelectorAll('.notif-item').forEach(item =>
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        const n = state.notifs.find(x => x.id === id);
        if (n && !n.read_at) {
          n.read_at = new Date().toISOString();
          renderNotifs();
          if (sb) await sb.from('notifications').update({ read_at: n.read_at }).eq('id', id);
        }
      })
    );
  }
  async function markAllRead() {
    const unread = state.notifs.filter(n => !n.read_at);
    if (!unread.length) return;
    const now = new Date().toISOString();
    unread.forEach(n => n.read_at = now);
    renderNotifs();
    if (sb) await sb.from('notifications').update({ read_at: now }).is('read_at', null).eq('user_id', me.user.id);
    toastNew('All notifications marked as read.');
  }

  /* ════════════════════════════════════════
     MODAL CORE
  ════════════════════════════════════════ */
  function openModal(m) { if (!m) return; m.classList.add('show'); document.body.style.overflow = 'hidden'; }
  function closeModals() {
    $$('.modal-backdrop').forEach(m => m.classList.remove('show'));
    document.body.style.overflow = '';
    currentQuoteLead = null;
  }

  /* ════════════════════════════════════════
     TOAST
  ════════════════════════════════════════ */
  const toastStack = $('#toast-stack');
  function toastNew(msg) {
    if (!toastStack) return Auth.toast(msg, 'info');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>
      <span>${esc(msg)}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 260); }, 3400);
  }

  function setText(sel, v) { const el = $(sel); if (el) el.textContent = String(v); }

  /* Periodic refresh of "ago" times in the activity feed */
  setInterval(renderActivityFromState, 60_000);
})();
