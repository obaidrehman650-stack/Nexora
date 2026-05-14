/* ════════════════════════════════════════
   NEXORA — Exporter Control Center
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
      myRfqs: [],
      responsesByRfq: {},   // { rfq_id: [quote, …] }
      profile: me.profile || {}
    };

    wireUI();

    if (sb) {
      await Promise.all([loadMyRfqs(), loadResponses()]);
      subscribeRealtime();
    } else {
      Auth.toast('Connect Supabase in js/config.js to load your data.', 'warn', { timeout: 6000 });
    }

    rebuildBadges();
    setView('post');
  }

  /* ════════════════════════════════════════
     DATA LAYER
  ════════════════════════════════════════ */
  async function loadMyRfqs() {
    const { data, error } = await sb.from('rfqs')
      .select('*').eq('posted_by', me.user.id)
      .order('created_at', { ascending: false });
    if (error) { console.warn('loadMyRfqs', error); Auth.toast('Could not load your RFQs.', 'error'); return; }
    state.myRfqs = data || [];
  }

  async function loadResponses() {
    if (!state.myRfqs.length) { state.responsesByRfq = {}; return; }
    const ids = state.myRfqs.map(r => r.id);
    const { data, error } = await sb.from('quotes')
      .select('*, profiles:manufacturer_id(company, full_name, verified_status, location)')
      .in('rfq_id', ids)
      .order('created_at', { ascending: false });
    if (error) { console.warn('loadResponses', error); return; }
    const grouped = {};
    (data || []).forEach(q => {
      (grouped[q.rfq_id] ||= []).push(q);
    });
    state.responsesByRfq = grouped;
  }

  function subscribeRealtime() {
    sb.channel('nx-ex-rfqs').on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'rfqs', filter: `posted_by=eq.${me.user.id}` },
      p => {
        state.myRfqs.unshift(p.new);
        if (state.view === 'mine') renderMine();
        rebuildBadges();
      }
    ).subscribe();

    sb.channel('nx-ex-quotes').on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'quotes' },
      async p => {
        if (!state.myRfqs.some(r => r.id === p.new.rfq_id)) return;  // only my RFQs' responses
        await loadResponses();
        if (state.view === 'responses') renderResponses();
        if (state.view === 'mine')      renderMine();
        rebuildBadges();
        Auth.toast('New quote received.', 'success');
      }
    ).subscribe();
  }

  /* ════════════════════════════════════════
     UI WIRING
  ════════════════════════════════════════ */
  function wireUI() {
    /* Nav */
    $$('.nav-item[data-section]').forEach(n =>
      n.addEventListener('click', e => { e.preventDefault(); setView(n.dataset.section); })
    );
    /* RFQ form */
    const form = $('#post-rfq-form');
    if (form) form.addEventListener('submit', submitRfq);
    const draftBtn = $('#rfq-draft');
    if (draftBtn) draftBtn.addEventListener('click', saveDraft);
    /* Profile */
    const pSave  = $('#pf-save');
    const pReset = $('#pf-reset');
    if (pSave)  pSave.addEventListener('click', saveProfile);
    if (pReset) pReset.addEventListener('click', hydrateProfile);
    /* Sign out — handled by the inline guard runtime in exporter.html */
    /* Hydrate draft if any */
    try {
      const draft = JSON.parse(localStorage.getItem('nexora-rfq-draft') || 'null');
      if (draft && form) applyDraft(form, draft);
    } catch {}
  }

  /* ════════════════════════════════════════
     VIEW SWITCHING
  ════════════════════════════════════════ */
  state = state || {};
  state.view = 'post';

  const sectionTitles = {
    post:      'Post a requirement',
    mine:      'My RFQs',
    responses: 'Responses received',
    profile:   'Account details'
  };

  function setView(name) {
    state.view = name;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === name));
    /* dashboard.css hides `.view` by default and shows `.view.active`.
       Toggle the class (not the `hidden` attribute) or the CSS rule
       `.view { display: none }` always wins. */
    $$('.view').forEach(v => {
      const isActive = v.dataset.view === name;
      v.classList.toggle('active', isActive);
      v.hidden = !isActive;  // keep both — works even if CSS is swapped later
    });
    const title = $('#topbar-section-title');
    if (title) title.textContent = sectionTitles[name] || '';
    if (name === 'mine')      renderMine();
    if (name === 'responses') renderResponses();
    if (name === 'profile')   hydrateProfile();
  }

  /* ════════════════════════════════════════
     POST RFQ
  ════════════════════════════════════════ */
  async function submitRfq(e) {
    e.preventDefault();
    const form = $('#post-rfq-form');
    clearFieldErrors(form);
    const product  = $('#rfq-product');
    const industry = form.querySelector('input[name="industry"]:checked');
    const qty      = $('#rfq-qty');
    const dest     = $('#rfq-destination');
    let ok = true;
    if (!product.value.trim()) { invalidate(product); ok = false; }
    if (!industry)             { invalidate(form.querySelector('.industry-radio')); ok = false; }
    if (!qty.value || +qty.value < 1) { invalidate(qty); ok = false; }
    if (!dest.value.trim())    { invalidate(dest); ok = false; }
    if (!ok) return;

    if (!sb) { Auth.toast('Connect Supabase first.', 'warn'); return; }

    const btn = $('#rfq-submit');
    setLoading(btn, true);

    const payload = {
      posted_by:    me.user.id,
      product:      Auth.sanitize(product.value),
      industry:     industry.value,
      quantity:     parseInt(qty.value, 10),
      unit:         $('#rfq-unit').value,
      target_price: parseFloat($('#rfq-budget').value) || null,
      lead_time:    $('#rfq-leadtime').value,
      destination:  Auth.sanitize(dest.value),
      incoterm:     $('#rfq-incoterm').value,
      specs:        Auth.sanitize($('#rfq-specs').value),
      status:       'open'
    };

    const { data, error } = await sb.from('rfqs').insert(payload).select('*').single();
    setLoading(btn, false);
    if (error) {
      console.warn('RFQ insert failed', error);
      Auth.toast(error.message || 'Could not post your requirement.', 'error');
      return;
    }
    state.myRfqs.unshift(data);
    rebuildBadges();
    try { localStorage.removeItem('nexora-rfq-draft'); } catch {}
    form.reset();
    Auth.toast(`Posted "${data.product}" to the verified ${data.industry} network.`, 'success');
  }

  function saveDraft() {
    const form = $('#post-rfq-form');
    if (!form) return;
    const draft = collectForm(form);
    try {
      localStorage.setItem('nexora-rfq-draft', JSON.stringify(draft));
      Auth.toast('Draft saved. Pick it back up anytime.', 'info');
    } catch {}
  }

  /* ════════════════════════════════════════
     MY RFQs
  ════════════════════════════════════════ */
  function renderMine() {
    const wrap = $('#rfq-history');
    if (!wrap) return;
    if (!state.myRfqs.length) {
      wrap.innerHTML = emptyStateHtml(
        'No requirements posted yet.',
        'Post your first RFQ — verified manufacturers respond in hours.'
      );
      return;
    }
    wrap.innerHTML = state.myRfqs.map(rfqMineHtml).join('');
  }

  function rfqMineHtml(r) {
    const status = r.status || 'open';
    const count  = (state.responsesByRfq[r.id] || []).length;
    return `
      <article class="rfq-mine" data-id="${escape(r.id)}">
        <div class="rfq-mine-top">
          <span>${escape((r.id || '').slice(0, 8))}</span>
          <span>${timeAgo(r.created_at)}</span>
        </div>
        <div class="rfq-mine-product">${escape(r.product)}</div>
        <div class="rfq-mine-meta">${fmtNum(r.quantity)} ${escape(r.unit)} · ${escape(r.destination)}${r.target_price ? ' · $' + Number(r.target_price).toFixed(2) : ''}</div>
        <div class="rfq-mine-foot">
          <span class="rfq-status rfq-status--${status}">${status}</span>
          <span class="rfq-mine-count">${count} ${count === 1 ? 'response' : 'responses'}</span>
        </div>
      </article>`;
  }

  /* ════════════════════════════════════════
     RESPONSES
  ════════════════════════════════════════ */
  function renderResponses() {
    const wrap = $('#rfq-responses');
    if (!wrap) return;
    const all = Object.values(state.responsesByRfq).flat();
    if (!all.length) {
      wrap.innerHTML = emptyStateHtml(
        'No responses yet.',
        'Once manufacturers quote your RFQ, their offers appear here.'
      );
      return;
    }
    wrap.innerHTML = all.map(responseHtml).join('');
  }

  function responseHtml(q) {
    const rfq = state.myRfqs.find(r => r.id === q.rfq_id);
    const mfg = q.profiles || {};
    const mfgName = mfg.company || mfg.full_name || 'Verified manufacturer';
    const verified = mfg.verified_status ? ' · Verified' : '';
    return `
      <article class="rfq-mine">
        <div class="rfq-mine-top">
          <span>From ${escape(mfgName)}${verified}</span>
          <span>${timeAgo(q.created_at)}</span>
        </div>
        <div class="rfq-mine-product">${escape(rfq ? rfq.product : 'RFQ')}</div>
        <div class="rfq-mine-meta">$${Number(q.unit_price).toFixed(2)} / unit · Lead ${escape(q.lead_time || '—')}${q.incoterm ? ' · ' + escape(q.incoterm) : ''}</div>
        <div class="rfq-mine-foot">
          <span class="rfq-status rfq-status--${q.status === 'accepted' ? 'won' : 'quoted'}">${escape(q.status || 'quoted')}</span>
          <span style="color:var(--text-muted); font-size:0.84rem;">RFQ ${escape((q.rfq_id || '').slice(0,8))}</span>
        </div>
      </article>`;
  }

  /* ════════════════════════════════════════
     PROFILE
  ════════════════════════════════════════ */
  function hydrateProfile() {
    const p = state.profile || {};
    $('#pf-name').value    = p.full_name || '';
    $('#pf-company').value = p.company   || '';
    $('#pf-email').value   = p.email     || (me.user && me.user.email) || '';
    $('#pf-country').value = p.location  || '';
  }

  async function saveProfile() {
    const patch = {
      full_name: Auth.sanitize($('#pf-name').value),
      company:   Auth.sanitize($('#pf-company').value),
      location:  Auth.sanitize($('#pf-country').value)
    };
    Object.assign(state.profile, patch);
    if (sb) {
      const { error } = await sb.from('profiles').update(patch).eq('id', me.user.id);
      if (error) { console.warn('profile save', error); Auth.toast(error.message || 'Could not save.', 'error'); return; }
    }
    $('#nx-user-name').textContent = patch.company || patch.full_name || me.user.email;
    Auth.toast('Profile saved.', 'success');
  }

  /* ════════════════════════════════════════
     BADGES
  ════════════════════════════════════════ */
  function rebuildBadges() {
    const mineBadge = $('#ex-rfqs-badge');
    const respBadge = $('#ex-resp-badge');
    if (mineBadge) mineBadge.textContent = state.myRfqs.length;
    if (respBadge) respBadge.textContent = Object.values(state.responsesByRfq).reduce((a, b) => a + b.length, 0);
  }

  /* ════════════════════════════════════════
     TEMPLATES & UTILITIES
  ════════════════════════════════════════ */
  function emptyStateHtml(title, body) {
    return `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>
        </svg>
        <h3>${escape(title)}</h3>
        <p>${escape(body)}</p>
      </div>`;
  }
  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function fmtNum(n) { return Number(n ?? 0).toLocaleString('en-US'); }
  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff/60) + 'm ago';
    if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
    return Math.floor(diff/86400) + 'd ago';
  }
  function clearFieldErrors(scope) {
    $$('.field.invalid, .industry-radio.invalid', scope).forEach(f => f.classList.remove('invalid'));
  }
  function invalidate(el) { (el.closest('.field') || el).classList.add('invalid'); }
  function setLoading(btn, on) { if (!btn) return; btn.classList.toggle('is-loading', !!on); btn.disabled = !!on; }
  function collectForm(f) { const out = {}; new FormData(f).forEach((v, k) => out[k] = v); return out; }
  function applyDraft(f, d) {
    Object.entries(d).forEach(([k, v]) => {
      const el = f.querySelector(`[name="${k}"]`);
      if (!el) return;
      if (el.type === 'radio') {
        const r = f.querySelector(`[name="${k}"][value="${v}"]`);
        if (r) r.checked = true;
      } else el.value = v;
    });
  }
})();
