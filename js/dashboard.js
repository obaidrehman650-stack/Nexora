/* ════════════════════════════════════════
   NEXORA — Dashboard
   100% Supabase-backed. No hardcoded sample data.
   Realtime subscriptions keep the UI in sync.
═══════════════════════════════════════════ */
(function () {
  const Auth = window.NexoraAuth;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* Wait for the Nexora Guard to verify auth + hydrate the user pill. */
  function onReady(fn) {
    if (!document.body.classList.contains('auth-pending')) return fn();
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
     BOOT
  ════════════════════════════════════════ */
  let sb, me, state;

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
    /* Filter pills */
    $$('.pill[data-filter]').forEach(pill =>
      pill.addEventListener('click', () => {
        $$('.pill[data-filter]').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.filter = pill.dataset.filter;
        renderLeads();
      })
    );
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
     LEADS VIEW
  ════════════════════════════════════════ */
  const grid   = $('#leads-grid');
  const liveCt = $('#live-count');

  function filteredLeads() {
    let leads = state.filter === 'all'
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

  function renderLeads() {
    if (!grid) return;
    const leads = filteredLeads();
    if (!leads.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>
          </svg>
          <h3>${state.search ? 'No leads match your search' : 'No live RFQs yet'}</h3>
          <p>${state.search
            ? 'Try different keywords or clear the search.'
            : state.profile.verified_status
              ? 'New requirements posted by verified exporters will appear here in real time.'
              : 'Your account is awaiting verification — once approved, leads in your industry will appear here.'}
          </p>
        </div>`;
      return;
    }
    grid.innerHTML = leads.map((l, i) => leadCardHTML(l, i)).join('');
    grid.querySelectorAll('[data-action="quote"]').forEach(b =>
      b.addEventListener('click', () => openQuoteModal(b.dataset.id))
    );
    grid.querySelectorAll('[data-action="details"]').forEach(b =>
      b.addEventListener('click', () => openDetailsModal(b.dataset.id))
    );
  }

  function leadCardHTML(l, i = 0) {
    const isQuoted   = state.quotedIds.has(l.id);
    const isNew      = (Date.now() - new Date(l.created_at).getTime()) < 15 * 60_000;
    const industryLabel = cap(l.industry);
    return `
      <article class="lead-card${isNew ? ' new' : ''}" data-lead-id="${escapeHtml(l.id)}" style="--i:${i}">
        <div class="lead-top">
          <span class="industry-badge ${escapeHtml(l.industry)}">${escapeHtml(industryLabel)}</span>
          <span class="lead-time">${fmtAgo(l.created_at)}</span>
        </div>
        <div>
          <h3 class="lead-product">${escapeHtml(l.product)}</h3>
          ${l.specs ? `<p class="lead-desc">${escapeHtml(l.specs.slice(0, 140))}${l.specs.length > 140 ? '…' : ''}</p>` : ''}
        </div>
        <div class="lead-meta">
          <div class="meta-item">
            <span class="meta-label">Quantity</span>
            <span class="meta-value"><strong>${fmtNum(l.quantity)}</strong> ${escapeHtml(l.unit)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Destination</span>
            <span class="meta-value">${escapeHtml(l.destination)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Target</span>
            <span class="meta-value">${l.target_price != null ? fmtMoney(l.target_price) : '—'}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Ref</span>
            <span class="meta-value">${escapeHtml((l.id || '').slice(0, 8))}</span>
          </div>
        </div>
        <div class="lead-actions">
          <button class="btn-quote${isQuoted ? ' sent' : ''}" data-action="quote" data-id="${escapeHtml(l.id)}" ${isQuoted ? 'disabled' : ''}>
            ${isQuoted
              ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Quote Sent`
              : `Send Quote <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`}
          </button>
          <button class="btn-details" data-action="details" data-id="${escapeHtml(l.id)}">Details</button>
        </div>
      </article>`;
  }

  function updateLiveCount() {
    const open = state.leads.length;
    if (liveCt) liveCt.textContent = open;

    const rfqBadge = $('.nav-item[data-section="rfqs"] .badge');
    if (rfqBadge) rfqBadge.textContent = state.myQuotes.length;

    const msgBadge = $('.nav-item[data-section="messages"] .badge');
    if (msgBadge) msgBadge.textContent = state.threads.filter(t =>
      !t.read_by_manufacturer_at  // placeholder until we track read state per thread
    ).length || state.threads.length;

    ['all','sports','surgical','leather'].forEach(k => {
      const c = $(`.pill[data-filter="${k}"] .count`);
      if (!c) return;
      c.textContent = k === 'all'
        ? state.leads.length
        : state.leads.filter(l => l.industry === k).length;
    });

    const elTotal   = $('#stat-total');
    const elTotal2  = $('#stat-total-2');
    const elNew     = $('#stat-new');
    const elQuoted  = $('#stat-quoted');
    const elMarkets = $('#stat-markets');
    const elLeadsCt = $('#leads-section-count');
    if (elTotal)   elTotal.textContent   = state.leads.length;
    if (elTotal2)  elTotal2.textContent  = state.leads.length;
    if (elNew)     elNew.textContent     = state.leads.filter(l =>
      (Date.now() - new Date(l.created_at).getTime()) < 60 * 60_000).length;
    if (elQuoted)  elQuoted.textContent  = state.myQuotes.length;
    if (elMarkets) elMarkets.textContent = new Set(state.leads.map(l => l.destination)).size;
    if (elLeadsCt) elLeadsCt.textContent = `${state.leads.length} open`;
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
