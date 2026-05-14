/* ════════════════════════════════════════
   NEXORA — Exporter Control Center
   - Post a Requirement (RFQ)
   - My RFQs (history)
   - Responses (quotes received)
   - Profile editor
═══════════════════════════════════════════ */
(function () {
  const Auth = window.NexoraAuth;
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* Wait for auth guard to release the body */
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

  function boot() {
    const me = window.NEXORA_USER || {};
    const profile = me.profile || {};

    /* ── View switcher ── */
    const sectionTitles = {
      post:      'Post a requirement',
      mine:      'My RFQs',
      responses: 'Responses received',
      profile:   'Account details'
    };
    function setView(name) {
      $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === name));
      $$('.view').forEach(v => {
        const active = v.dataset.view === name;
        v.hidden = !active;
      });
      const title = $('#topbar-section-title');
      if (title) title.textContent = sectionTitles[name] || '';
      if (name === 'mine')      renderMine();
      if (name === 'responses') renderResponses();
      if (name === 'profile')   hydrateProfile();
    }
    $$('.nav-item[data-section]').forEach(n => {
      n.addEventListener('click', e => { e.preventDefault(); setView(n.dataset.section); });
    });

    /* ── Post-RFQ form ── */
    const form = $('#post-rfq-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearFieldErrors(form);
      const product = $('#rfq-product');
      const industry = form.querySelector('input[name="industry"]:checked');
      const qty = $('#rfq-qty');
      const dest = $('#rfq-destination');
      let ok = true;
      if (!product.value.trim()) { invalidate(product); ok = false; }
      if (!industry) { invalidate(form.querySelector('.industry-radio')); ok = false; }
      if (!qty.value || +qty.value < 1) { invalidate(qty); ok = false; }
      if (!dest.value.trim()) { invalidate(dest); ok = false; }
      if (!ok) return;

      const btn = $('#rfq-submit');
      setLoading(btn, true);

      const data = {
        product:      Auth.sanitize(product.value),
        industry:     industry.value,
        quantity:     +qty.value,
        unit:         $('#rfq-unit').value,
        target_price: parseFloat($('#rfq-budget').value || '0') || null,
        lead_time:    $('#rfq-leadtime').value,
        destination:  Auth.sanitize(dest.value),
        incoterm:     $('#rfq-incoterm').value,
        specs:        Auth.sanitize($('#rfq-specs').value),
        posted_by:    me.user && me.user.id,
        posted_at:    new Date().toISOString()
      };

      try {
        await saveRfq(data);
        Auth.toast(`Posted "${data.product}" to ${manufacturerCount(data.industry)} verified ${data.industry} manufacturers.`, 'success', { timeout: 6000 });
        form.reset();
        rebuildBadges();
      } catch (err) {
        console.warn('RFQ post failed', err);
        Auth.toast('Could not post your requirement. Please try again.', 'error');
      } finally {
        setLoading(btn, false);
      }
    });

    $('#rfq-draft').addEventListener('click', () => {
      const draft = collectForm(form);
      try {
        localStorage.setItem('nexora-rfq-draft', JSON.stringify(draft));
        Auth.toast('Draft saved. Pick it back up anytime.', 'info');
      } catch {}
    });

    /* Hydrate from draft, if any */
    try {
      const draft = JSON.parse(localStorage.getItem('nexora-rfq-draft') || 'null');
      if (draft) applyDraft(form, draft);
    } catch {}

    /* ── My RFQs view ── */
    function renderMine() {
      const wrap = $('#rfq-history');
      const all = listRfqs();
      const mine = all.filter(r => r.posted_by === (me.user && me.user.id) || !r.posted_by);
      if (!mine.length) {
        wrap.innerHTML = emptyStateHtml(
          'No requirements posted yet.',
          'Post your first RFQ — verified manufacturers respond in hours.'
        );
        return;
      }
      wrap.innerHTML = mine.sort((a, b) => (b.posted_at || '').localeCompare(a.posted_at || ''))
        .map(rfqMineHtml).join('');
    }

    /* ── Responses view (quotes received) ── */
    function renderResponses() {
      const wrap = $('#rfq-responses');
      const responses = stubResponses();
      if (!responses.length) {
        wrap.innerHTML = emptyStateHtml(
          'No responses yet.',
          'Once manufacturers quote your RFQ, their offers appear here.'
        );
        return;
      }
      wrap.innerHTML = responses.map(responseHtml).join('');
    }

    /* ── Profile view ── */
    function hydrateProfile() {
      $('#pf-name').value    = profile.full_name || '';
      $('#pf-company').value = profile.company   || '';
      $('#pf-email').value   = profile.email     || (me.user && me.user.email) || '';
      $('#pf-country').value = profile.location  || '';
    }
    $('#pf-reset').addEventListener('click', hydrateProfile);
    $('#pf-save').addEventListener('click', () => {
      /* In Supabase mode this would write to `profiles`. In demo mode we
         just stash the updates locally. */
      profile.full_name = Auth.sanitize($('#pf-name').value);
      profile.company   = Auth.sanitize($('#pf-company').value);
      profile.location  = Auth.sanitize($('#pf-country').value);
      $('#nx-user-name').textContent = profile.company || profile.full_name || profile.email;
      Auth.toast('Profile saved.', 'success');
    });

    /* ── Init ── */
    rebuildBadges();
    setView('post');
  }

  /* ════════════════════════════════════════
     RFQ store — localStorage-backed for demo.
     Replace with `supabase.from('rfqs').insert(...)` when you
     wire Supabase up. The schema lives in supabase-schema.sql.
  ══════════════════════════════════════ */
  const RFQ_KEY = 'nexora-rfqs';
  function listRfqs() {
    try { return JSON.parse(localStorage.getItem(RFQ_KEY) || '[]'); } catch { return []; }
  }
  async function saveRfq(data) {
    /* Optional Supabase write — silently degrades to local if unavailable */
    if (window.supabase && window.NEXORA_CONFIG &&
        !/^YOUR-/.test(window.NEXORA_CONFIG.SUPABASE_URL)) {
      try {
        const sb = window.supabase.createClient(
          window.NEXORA_CONFIG.SUPABASE_URL,
          window.NEXORA_CONFIG.SUPABASE_ANON_KEY
        );
        await sb.from('rfqs').insert({ ...data, status: 'open' });
      } catch (e) { console.warn('Supabase write failed; using local fallback', e); }
    }
    const rfqs = listRfqs();
    rfqs.unshift({ ...data, id: 'rfq_' + Math.random().toString(36).slice(2, 9), status: 'open', responses: 0 });
    localStorage.setItem(RFQ_KEY, JSON.stringify(rfqs));
  }

  function rebuildBadges() {
    const all = listRfqs();
    const badge = document.getElementById('ex-rfqs-badge');
    if (badge) badge.textContent = all.length;
    const respBadge = document.getElementById('ex-resp-badge');
    if (respBadge) respBadge.textContent = stubResponses().length;
  }

  /* ════════════════════════════════════════
     Templates
  ══════════════════════════════════════ */
  function rfqMineHtml(r) {
    const status = r.status || 'open';
    const responses = r.responses || 0;
    return `
      <article class="rfq-mine" data-id="${escape(r.id)}">
        <div class="rfq-mine-top">
          <span>${escape((r.id || '').slice(0, 9))}</span>
          <span>${timeAgo(r.posted_at)}</span>
        </div>
        <div class="rfq-mine-product">${escape(r.product)}</div>
        <div class="rfq-mine-meta">${fmtNum(r.quantity)} ${escape(r.unit)} · ${escape(r.destination)}${r.target_price ? ' · $' + r.target_price.toFixed(2) : ''}</div>
        <div class="rfq-mine-foot">
          <span class="rfq-status rfq-status--${status}">${status}</span>
          <span class="rfq-mine-count">${responses} ${responses === 1 ? 'response' : 'responses'}</span>
        </div>
      </article>
    `;
  }

  function responseHtml(r) {
    return `
      <article class="rfq-mine">
        <div class="rfq-mine-top">
          <span>From ${escape(r.from)}</span>
          <span>${escape(r.when)}</span>
        </div>
        <div class="rfq-mine-product">${escape(r.product)}</div>
        <div class="rfq-mine-meta">$${r.price.toFixed(2)} / ${escape(r.unit)} · Lead ${escape(r.lead)}</div>
        <div class="rfq-mine-foot">
          <span class="rfq-status rfq-status--quoted">Quoted</span>
          <a class="btn-link" href="Nexora - Dashboard.html">Open thread →</a>
        </div>
      </article>
    `;
  }

  function emptyStateHtml(title, body) {
    return `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>
        </svg>
        <h3>${escape(title)}</h3>
        <p>${escape(body)}</p>
      </div>
    `;
  }

  function stubResponses() {
    /* In Supabase mode, fetch from `quotes` table. For now: derive from
       posted RFQs — show one fake response if any RFQ exists. */
    const r = listRfqs()[0];
    if (!r) return [];
    return [
      {
        from: 'Sialkot Forge Ltd · Verified',
        product: r.product,
        price: (r.target_price || 8.5) * 1.04,
        unit: r.unit,
        lead: r.lead_time,
        when: 'Just now'
      },
      {
        from: 'Iqbal Industries · Verified',
        product: r.product,
        price: (r.target_price || 8.5) * 0.92,
        unit: r.unit,
        lead: r.lead_time,
        when: '2h ago'
      }
    ];
  }

  function manufacturerCount(industry) {
    return { surgical: 412, sports: 2400, leather: 168 }[industry] || 800;
  }

  /* ════════════════════════════════════════
     Utility helpers
  ══════════════════════════════════════ */
  function escape(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function fmtNum(n) { return Number(n).toLocaleString('en-US'); }
  function timeAgo(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff/60) + 'm ago';
    if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
    return Math.floor(diff/86400) + 'd ago';
  }
  function clearFieldErrors(scope) { $$('.field.invalid, .industry-radio.invalid', scope).forEach(f => f.classList.remove('invalid')); }
  function invalidate(el) {
    const f = el.closest('.field') || el;
    f.classList.add('invalid');
  }
  function setLoading(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-loading', !!on);
    btn.disabled = !!on;
  }
  function collectForm(f) {
    const out = {};
    new FormData(f).forEach((v, k) => out[k] = v);
    return out;
  }
  function applyDraft(f, d) {
    Object.entries(d).forEach(([k, v]) => {
      const el = f.querySelector(`[name="${k}"]`);
      if (!el) return;
      if (el.type === 'radio') {
        const radio = f.querySelector(`[name="${k}"][value="${v}"]`);
        if (radio) radio.checked = true;
      } else el.value = v;
    });
  }
})();
