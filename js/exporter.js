/* ════════════════════════════════════════
   NEXORA — Exporter Control Center
   100% Supabase-backed. Renders into the
   new dashboard-pro.css markup with charts.js.
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
  const fmtMoney = n => '$' + Number(n ?? 0).toFixed(2);
  function fmtAgo(iso) {
    if (!iso) return '—';
    const min = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
    if (min < 1)   return 'just now';
    if (min < 60)  return Math.floor(min) + 'm ago';
    const h = min / 60;
    if (h < 24)    return Math.floor(h) + 'h ago';
    const d = h / 24;
    if (d < 7)     return Math.floor(d) + 'd ago';
    return Math.floor(d / 7) + 'w ago';
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());
  const initials = name => (name || '··').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const FLAGS = { Germany:'🇩🇪','United Kingdom':'🇬🇧',USA:'🇺🇸','United States':'🇺🇸',Italy:'🇮🇹',France:'🇫🇷',Netherlands:'🇳🇱',Spain:'🇪🇸',Australia:'🇦🇺',Japan:'🇯🇵',UAE:'🇦🇪',Canada:'🇨🇦',Brazil:'🇧🇷' };
  const flagFor = c => FLAGS[c] || '🌐';
  const INDUSTRY_PIP = { surgical:'I', sports:'II', leather:'III' };
  const INDUSTRY_CHIP = { surgical:'chip--surg', sports:'chip--sport', leather:'chip--leath' };
  const INDUSTRY_PIP_CLASS = { surgical:'pip--surg', sports:'pip--sport', leather:'pip--leath' };

  /* ── State ─── */
  let sb, me, state;

  async function boot() {
    sb = Auth.client();
    me = window.NEXORA_USER || (await Auth.getCurrentUser());
    if (!me || !me.user) { Auth.toast('Session expired.', 'error'); setTimeout(() => location.replace('auth.html'), 600); return; }
    state = { view:'overview', myRfqs:[], responsesByRfq:{}, allResponses:[], profile: me.profile || {} };
    wireUI();
    if (sb) { await Promise.all([loadMyRfqs(), loadResponses()]); subscribeRealtime(); }
    else    { Auth.toast('Connect Supabase in js/config.js to load data.', 'warn', { timeout: 6000 }); }
    renderEverything();
  }

  /* ── Data ─── */
  async function loadMyRfqs() {
    const { data, error } = await sb.from('rfqs').select('*').eq('posted_by', me.user.id).order('created_at',{ascending:false});
    if (error) { console.warn('loadMyRfqs', error); return; }
    state.myRfqs = data || [];
  }
  async function loadResponses() {
    if (!state.myRfqs.length) { state.responsesByRfq = {}; state.allResponses = []; return; }
    const ids = state.myRfqs.map(r => r.id);
    const { data, error } = await sb.from('quotes').select('*').in('rfq_id', ids).order('created_at',{ascending:false});
    if (error) { console.warn('loadResponses', error); return; }
    state.allResponses = data || [];
    const grouped = {};
    state.allResponses.forEach(q => { (grouped[q.rfq_id] ||= []).push(q); });
    state.responsesByRfq = grouped;
  }

  /* ── Realtime ─── */
  function subscribeRealtime() {
    sb.channel('nx-ex-rfqs').on('postgres_changes',
      { event:'INSERT', schema:'public', table:'rfqs', filter:`posted_by=eq.${me.user.id}` },
      p => { state.myRfqs.unshift(p.new); renderEverything(); }
    ).subscribe();
    sb.channel('nx-ex-quotes').on('postgres_changes',
      { event:'INSERT', schema:'public', table:'quotes' },
      async p => {
        if (!state.myRfqs.some(r => r.id === p.new.rfq_id)) return;
        await loadResponses();
        renderEverything();
        Auth.toast('New quote received.', 'success');
      }
    ).subscribe();
  }

  /* ── UI wiring ─── */
  function wireUI() {
    $$('.nav-item[data-section]').forEach(n =>
      n.addEventListener('click', e => { e.preventDefault(); setView(n.dataset.section); })
    );
    $$('[data-section-link]').forEach(a =>
      a.addEventListener('click', e => { e.preventDefault(); setView(a.dataset.sectionLink); })
    );

    /* Industry radio chips (Post RFQ) */
    $$('#industry-radio label').forEach(l => {
      l.addEventListener('click', () => {
        $$('#industry-radio label').forEach(x => x.style.background = 'var(--bg-elevated)');
        l.style.background = 'var(--accent-tint)';
        l.style.borderColor = 'var(--accent)';
      });
    });

    /* Forms */
    const f = $('#post-rfq-form'); if (f) f.addEventListener('submit', submitRfq);
    const draft = $('#rfq-draft'); if (draft) draft.addEventListener('click', saveDraft);
    const pSave = $('#pf-save'), pReset = $('#pf-reset');
    if (pSave)  pSave.addEventListener('click', saveProfile);
    if (pReset) pReset.addEventListener('click', hydrateProfile);

    /* Hydrate draft */
    try { const d = JSON.parse(localStorage.getItem('nexora-rfq-draft') || 'null'); if (d) applyDraft(f, d); } catch {}
  }

  /* ── View switching ─── */
  const TITLES = { overview:'Overview', post:'Post a requirement', mine:'My RFQs', responses:'Responses', profile:'Account' };
  function setView(name) {
    state.view = name;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === name));
    $$('.canvas .view').forEach(v => v.classList.toggle('is-active', v.dataset.view === name));
    const t = $('#topbar-section-title'); if (t) t.textContent = TITLES[name] || '';
    if (name === 'mine')      renderMine();
    if (name === 'responses') renderResponsesView();
    if (name === 'profile')   hydrateProfile();
  }

  /* ── Render ─── */
  function renderEverything() {
    renderHeader();
    renderKpis();
    renderOverviewTable();
    renderIndustryDonut();
    renderSuppliersFeed();
    renderSpendChart();
    renderActivity();
    renderMine();
    renderResponsesView();
    renderBadges();
  }

  function renderHeader() {
    const p = state.profile;
    const name = (p.full_name || p.company || 'there').split(/\s+/)[0];
    $('#ph-name').textContent = name;
    $('#ph-resp-count').textContent = state.allResponses.length;
    const open = state.myRfqs.filter(r => r.status === 'open' || r.status === 'quoted').length;
    $('#ph-sub').textContent = open
      ? `${open} open ${open === 1 ? 'requirement' : 'requirements'} sourcing in real time across the Sialkot manufacturer network.`
      : 'Post your first requirement — verified manufacturers respond in hours.';
  }

  function renderKpis() {
    const open = state.myRfqs.filter(r => ['open','quoted'].includes(r.status)).length;
    const resp = state.allResponses.length;
    const avg  = state.myRfqs.length ? resp / state.myRfqs.length : 0;
    const pipelineRaw = state.allResponses.reduce((s, q) => {
      const r = state.myRfqs.find(x => x.id === q.rfq_id);
      const qty = (r && r.quantity) || 0;
      return s + (Number(q.unit_price) || 0) * qty;
    }, 0);
    const pipelineK = Math.round(pipelineRaw / 1000);

    setKpi('#kpi-rfqs', open, 0);
    setKpi('#kpi-resp', resp, 0);
    setKpi('#kpi-avg',  avg, 1);
    setKpi('#kpi-pipe', pipelineK, 0);

    drawSpark('spark-rfqs', bucketize(state.myRfqs));
    drawSpark('spark-resp', bucketize(state.allResponses));
    drawSpark('spark-avg',  bucketize(state.myRfqs).map((v, i, a) => v + (state.allResponses.length / Math.max(state.myRfqs.length, 1))));
    drawSpark('spark-pipe', bucketize(state.allResponses, q => {
      const r = state.myRfqs.find(x => x.id === q.rfq_id);
      return ((r && r.quantity) || 0) * (Number(q.unit_price) || 0) / 1000;
    }));
  }

  function setKpi(sel, value, decimals) {
    const el = $(sel); if (!el) return;
    if (window.NX && NX.animateCounter) {
      NX.animateCounter(el, value, { decimals: decimals || 0, duration: 800 });
    } else {
      el.textContent = decimals ? value.toFixed(decimals) : Math.floor(value).toLocaleString();
    }
  }
  function drawSpark(id, data) {
    const wrap = document.getElementById(id);
    if (!wrap || !window.NX || !NX.sparkline || !data || !data.length) return;
    wrap.innerHTML = NX.sparkline(data, { width: 96, height: 32, color: 'var(--accent)' });
  }
  function bucketize(items, valueFn) {
    const buckets = 8, now = Date.now(), spanMs = 7 * 86_400_000;
    const arr = new Array(buckets).fill(0);
    items.forEach(it => {
      const t = new Date(it.created_at).getTime();
      if (!t) return;
      const idx = buckets - 1 - Math.floor((now - t) / spanMs);
      if (idx >= 0 && idx < buckets) arr[idx] += (valueFn ? valueFn(it) : 1);
    });
    if (arr.every(v => v === 0)) return arr.map((_, i) => i);
    return arr;
  }

  function renderOverviewTable() {
    const tbody = $('#overview-tbody'); if (!tbody) return;
    const rows = state.myRfqs.slice(0, 6);
    $('#active-eye').textContent = `Active · ${state.myRfqs.length}`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--text-muted);">No requirements posted yet. Click "Post a requirement" to start.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const respN = (state.responsesByRfq[r.id] || []).length;
      const status = r.status === 'won' ? 'won' : (r.status === 'quoted' ? 'quoted' : 'open');
      return `
        <tr>
          <td><div class="ti">${esc(r.product || '—')}</div><div class="su">${esc((r.specs || '').slice(0,60))}</div></td>
          <td><span class="chip ${INDUSTRY_CHIP[r.industry] || ''}">${INDUSTRY_PIP[r.industry] || ''} ${cap(r.industry || '')}</span></td>
          <td class="ta-right col-mono">${fmtNum(r.quantity)}</td>
          <td><div style="display:flex;align-items:center;gap:8px;"><div class="bar-cell" style="--p:${Math.min(respN/10, 1)};"><div class="bar-cell-fill"></div></div><span class="col-mono" style="font-size:0.78rem;">${respN}</span></div></td>
          <td><span class="chip chip--${status === 'won' ? 'won' : status === 'quoted' ? 'quoted' : 'open'}">${cap(r.status === 'open' ? 'Receiving' : r.status)}</span></td>
          <td class="ta-right col-mono" style="color:var(--text-muted);">${fmtAgo(r.created_at)}</td>
        </tr>`;
    }).join('');
  }

  function renderIndustryDonut() {
    const wrap = document.getElementById('industry-donut');
    if (!wrap || !window.NX) return;
    const buckets = { surgical:0, sports:0, leather:0 };
    state.myRfqs.forEach(r => { if (buckets[r.industry] != null) buckets[r.industry]++; });
    const total = buckets.surgical + buckets.sports + buckets.leather;
    wrap.innerHTML = '';
    NX.donut(wrap, {
      size: 160, thickness: 18,
      data: [
        { label:'Surgical', value: buckets.surgical || 0.0001, color:'var(--ind-surgical)' },
        { label:'Sports',   value: buckets.sports   || 0.0001, color:'var(--ind-sports)' },
        { label:'Leather',  value: buckets.leather  || 0.0001, color:'var(--ind-leather)' }
      ],
      centerValue: String(total || 0),
      centerLabel: 'RFQs'
    });
    const lg = $('#industry-legend'); if (!lg) return;
    if (!total) {
      lg.innerHTML = `<div style="color:var(--text-muted);">No requirements yet.</div>`;
      return;
    }
    lg.innerHTML = ['surgical','sports','leather'].map(k => `
      <div style="display:flex;justify-content:space-between;">
        <span style="display:inline-flex;align-items:center;gap:6px;"><span class="pip ${INDUSTRY_PIP_CLASS[k]}">${INDUSTRY_PIP[k]}</span>${cap(k)}</span>
        <span class="col-mono">${buckets[k]} ${buckets[k]===1?'RFQ':'RFQs'}</span>
      </div>`).join('');
  }

  function renderSuppliersFeed() {
    const wrap = $('#suppliers-feed'); if (!wrap) return;
    if (!state.allResponses.length) {
      wrap.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:0.86rem;">Suppliers who quote you will appear here.</div>`;
      return;
    }
    /* Group by manufacturer_id, count quotes */
    const byMfg = {};
    state.allResponses.forEach(q => { (byMfg[q.manufacturer_id] = byMfg[q.manufacturer_id] || []).push(q); });
    const top = Object.entries(byMfg).sort((a, b) => b[1].length - a[1].length).slice(0, 4);
    wrap.innerHTML = top.map(([id, qs]) => {
      const sample = qs[0];
      const ini = (id || '··').slice(-2).toUpperCase();
      return `
        <div class="feed-item" style="padding:10px 4px;">
          <div class="feed-dot" style="background:var(--accent-soft);color:var(--accent-dark);border-color:rgba(201,100,66,0.22);font-family:var(--font-display);font-weight:600;font-size:0.74rem;">${esc(ini)}</div>
          <div class="feed-text">
            <span class="ent">Verified manufacturer · ${esc(id.slice(-6))}</span>
            <span class="sub">${qs.length} ${qs.length === 1 ? 'quote' : 'quotes'} · last ${fmtAgo(sample.created_at)}</span>
          </div>
          <div class="feed-time">${fmtMoney(sample.unit_price)}</div>
        </div>`;
    }).join('');
  }

  function renderSpendChart() {
    const wrap = document.getElementById('spend-chart');
    if (!wrap || !window.NX) return;
    const months = ['Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep'];
    const now = new Date();
    const last8 = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      last8.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: months[d.getMonth()] });
    }
    const sums = Object.fromEntries(last8.map(m => [m.key, 0]));
    state.allResponses.forEach(q => {
      const t = new Date(q.created_at);
      const k = `${t.getFullYear()}-${t.getMonth()}`;
      if (sums[k] != null) {
        const r = state.myRfqs.find(x => x.id === q.rfq_id);
        sums[k] += (Number(q.unit_price) || 0) * ((r && r.quantity) || 0);
      }
    });
    wrap.innerHTML = '';
    NX.areaChart(wrap, {
      width: 720, height: 240,
      data: last8.map(m => ({ label: m.label, value: sums[m.key] })),
      color: 'var(--accent)',
      smooth: true
    });
  }

  function renderActivity() {
    const wrap = $('#activity-feed'); if (!wrap) return;
    const items = [
      ...state.allResponses.slice(0, 6).map(q => {
        const r = state.myRfqs.find(x => x.id === q.rfq_id);
        return { ts: q.created_at, html: `New quote on <span class="ent">${esc((r && r.product) || 'your RFQ')}</span> at <strong>${fmtMoney(q.unit_price)}</strong>/unit.`, kind:'quote' };
      }),
      ...state.myRfqs.slice(0, 4).map(r => ({
        ts: r.created_at,
        html: `Posted requirement — <span class="ent">${esc(r.product)}</span> · ${esc(r.destination || '')}`,
        kind:'rfq'
      }))
    ].sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 8);
    if (!items.length) {
      wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.88rem;">No activity yet. Quotes and messages will appear here in real time.</div>`;
      return;
    }
    wrap.innerHTML = items.map(it => `
      <div class="feed-item">
        <div class="feed-dot" style="color:${it.kind === 'quote' ? 'var(--success)' : 'var(--accent)'};">
          ${it.kind === 'quote'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>'}
        </div>
        <div class="feed-text">${it.html}</div>
        <div class="feed-time">${fmtAgo(it.ts)}</div>
      </div>`).join('');
  }

  function renderMine() {
    const tbody = $('#mine-tbody'); if (!tbody) return;
    if (!state.myRfqs.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:32px;text-align:center;color:var(--text-muted);">No requirements posted yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = state.myRfqs.map(r => {
      const respN = (state.responsesByRfq[r.id] || []).length;
      const status = r.status === 'won' ? 'won' : (r.status === 'quoted' ? 'quoted' : 'open');
      return `
        <tr>
          <td><div class="ti">${esc(r.product || '—')}</div><div class="su">${esc((r.id||'').slice(0,8))}</div></td>
          <td><span class="chip ${INDUSTRY_CHIP[r.industry] || ''}">${INDUSTRY_PIP[r.industry] || ''} ${cap(r.industry || '')}</span></td>
          <td>${flagFor(r.destination)} ${esc(r.destination || '—')}</td>
          <td class="ta-right col-mono">${fmtNum(r.quantity)}</td>
          <td><div style="display:flex;align-items:center;gap:8px;"><div class="bar-cell" style="--p:${Math.min(respN/10, 1)};"><div class="bar-cell-fill"></div></div><span class="col-mono" style="font-size:0.78rem;">${respN}</span></div></td>
          <td><span class="chip chip--${status === 'won' ? 'won' : status === 'quoted' ? 'quoted' : 'open'}">${cap(r.status === 'open' ? 'Receiving' : r.status)}</span></td>
          <td class="ta-right col-mono" style="color:var(--text-muted);">${fmtAgo(r.created_at)}</td>
        </tr>`;
    }).join('');
  }

  function renderResponsesView() {
    const tbody = $('#responses-tbody'); if (!tbody) return;
    if (!state.allResponses.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--text-muted);">No responses yet. Once manufacturers quote your RFQ, their offers appear here.</td></tr>`;
      return;
    }
    tbody.innerHTML = state.allResponses.map(q => {
      const r = state.myRfqs.find(x => x.id === q.rfq_id) || {};
      return `
        <tr>
          <td><div class="dt-cell-main"><div class="av">${esc((q.manufacturer_id || '··').slice(-2).toUpperCase())}</div><div><div class="ti">Verified manufacturer</div><div class="su">${esc((q.manufacturer_id||'').slice(0,8))}</div></div></div></td>
          <td>${esc(r.product || '—')}</td>
          <td class="ta-right col-mono">${fmtMoney(q.unit_price)}</td>
          <td>${esc(q.lead_time || '—')}</td>
          <td><span class="chip chip--${q.status === 'accepted' ? 'won' : 'quoted'}">${cap(q.status || 'sent')}</span></td>
          <td class="ta-right col-mono" style="color:var(--text-muted);">${fmtAgo(q.created_at)}</td>
        </tr>`;
    }).join('');
  }

  function renderBadges() {
    const bd = $('#bd-rfqs'); if (bd) bd.textContent = state.myRfqs.length;
    const re = $('#bd-resp'); if (re) re.textContent = state.allResponses.length;
  }

  /* ── POST RFQ ─── */
  async function submitRfq(e) {
    e.preventDefault();
    const form = $('#post-rfq-form');
    const product = $('#rfq-product');
    const industry = form.querySelector('input[name="industry"]:checked');
    const qty = $('#rfq-qty');
    const dest = $('#rfq-destination');
    let ok = true;
    [product, qty, dest].forEach(el => el.closest('.field').classList.remove('invalid'));
    if (!product.value.trim()) { product.closest('.field').classList.add('invalid'); ok = false; }
    if (!industry) { ok = false; }
    if (!qty.value || +qty.value < 1) { qty.closest('.field').classList.add('invalid'); ok = false; }
    if (!dest.value.trim()) { dest.closest('.field').classList.add('invalid'); ok = false; }
    if (!ok) return;
    if (!sb) { Auth.toast('Connect Supabase first.', 'warn'); return; }

    const btn = $('#rfq-submit');
    btn.disabled = true;
    const payload = {
      posted_by: me.user.id,
      product:   Auth.sanitize(product.value),
      industry:  industry.value,
      quantity:  parseInt(qty.value, 10),
      unit:      $('#rfq-unit').value,
      target_price: parseFloat($('#rfq-budget').value) || null,
      lead_time: $('#rfq-leadtime').value,
      destination: Auth.sanitize(dest.value),
      incoterm:  $('#rfq-incoterm').value,
      specs:     Auth.sanitize($('#rfq-specs').value),
      status:    'open'
    };
    const { data, error } = await sb.from('rfqs').insert(payload).select('*').single();
    btn.disabled = false;
    if (error) { Auth.toast(error.message || 'Could not post.', 'error'); return; }
    state.myRfqs.unshift(data);
    try { localStorage.removeItem('nexora-rfq-draft'); } catch {}
    form.reset();
    $$('#industry-radio label').forEach(l => { l.style.background = 'var(--bg-elevated)'; l.style.borderColor = 'var(--border)'; });
    renderEverything();
    Auth.toast(`Posted "${data.product}" to the verified ${data.industry} network.`, 'success');
    setView('mine');
  }

  function saveDraft() {
    const form = $('#post-rfq-form'); if (!form) return;
    const out = {}; new FormData(form).forEach((v, k) => out[k] = v);
    try { localStorage.setItem('nexora-rfq-draft', JSON.stringify(out)); Auth.toast('Draft saved.', 'info'); } catch {}
  }
  function applyDraft(form, d) {
    if (!form || !d) return;
    Object.entries(d).forEach(([k, v]) => {
      const el = form.querySelector(`[name="${k}"]`);
      if (!el) return;
      if (el.type === 'radio') {
        const r = form.querySelector(`[name="${k}"][value="${v}"]`);
        if (r) { r.checked = true; r.parentElement.style.background = 'var(--accent-tint)'; r.parentElement.style.borderColor = 'var(--accent)'; }
      } else el.value = v;
    });
  }

  /* ── PROFILE ─── */
  function hydrateProfile() {
    const p = state.profile;
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
      if (error) { Auth.toast('Could not save: ' + error.message, 'error'); return; }
    }
    const nm = $('#nx-user-name'); if (nm) nm.textContent = patch.company || patch.full_name || me.user.email;
    Auth.toast('Profile saved.', 'success');
  }
})();
