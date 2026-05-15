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
    setView('overview');
    renderOverview();
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
    /* Overview CTAs */
    const newBtn  = $('#ex-new-rfq');
    if (newBtn)  newBtn.addEventListener('click', () => setView('post'));
    const postBtn = $('#ex-post-cta');
    if (postBtn) postBtn.addEventListener('click', () => setView('post'));
    /* Generic jumps: [data-jump-mine] → mine view */
    document.addEventListener('click', e => {
      const j = e.target.closest('[data-jump-mine]');
      if (j) { e.preventDefault(); setView('mine'); }
    });
    /* Overview scope tabs (visual only) */
    $$('#ex-scope .tab[data-scope]').forEach(tab =>
      tab.addEventListener('click', e => {
        e.preventDefault();
        $$('#ex-scope .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.scope = tab.dataset.scope;
        renderOverview();
      })
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
  state.view = 'overview';

  const sectionTitles = {
    overview:  'Overview',
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
    if (name === 'overview')  renderOverview();
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
     OVERVIEW — editorial control center
  ════════════════════════════════════════ */
  function setText(sel, v) { const el = $(sel); if (el) el.textContent = String(v); }
  function fmtMoneyShort(v) {
    v = Number(v) || 0;
    if (v >= 1_000_000) return { value: (v / 1_000_000).toFixed(1), unit: 'M' };
    if (v >= 1_000)     return { value: Math.round(v / 1_000),       unit: 'k' };
    return { value: Math.round(v), unit: '' };
  }
  function withinDays(iso, n) {
    return iso && (Date.now() - new Date(iso).getTime()) < n * 86_400_000;
  }
  function escapeHtmlEx(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderOverview() {
    const rfqs = state.myRfqs || [];
    const allQuotes = Object.values(state.responsesByRfq || {}).flat();
    const scope = state.scope || 'week';
    const days = scope === 'week' ? 7 : scope === 'month' ? 30 : 365;

    /* ── Hero greeting ── */
    const firstName = ((state.profile.full_name || state.profile.company || '') + '').split(' ')[0] || 'there';
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Hello' : 'Good evening';
    const respInScope = allQuotes.filter(q => withinDays(q.created_at, days)).length;
    const greetEl = $('#ex-greeting');
    if (greetEl) greetEl.innerHTML = `${greet}, ${escapeHtmlEx(firstName)}. <em>${respInScope}</em> manufacturers responded ${scope === 'week' ? 'this week' : scope === 'month' ? 'this month' : 'this year'}.`;
    const ttq = computeTimeToFirstQuote(rfqs, allQuotes);
    const open = rfqs.filter(r => r.status === 'open' || r.status === 'quoted').length;
    setText('#ex-sub', '');
    const sub = $('#ex-sub');
    if (sub) {
      sub.innerHTML = rfqs.length
        ? `${open} open requirement${open === 1 ? '' : 's'} being quoted in real time. Median time-to-first-quote: <strong style="color:var(--text)">${ttq != null ? ttq.toFixed(1) + 'h' : '—'}</strong>.`
        : 'No requirements posted yet — post one to start receiving quotes from verified manufacturers.';
    }

    /* ── KPI tiles ── */
    setText('#ex-kpi-rfqs', open);
    const recent = rfqs.filter(r => withinDays(r.created_at, days)).length;
    const rEl = $('#ex-kpi-rfqs-delta');
    if (rEl) { rEl.textContent = recent ? `▲ ${recent}` : '—'; rEl.className = 'delta ' + (recent ? 'up' : 'flat'); }

    setText('#ex-kpi-resp', allQuotes.length);
    const rspEl = $('#ex-kpi-resp-delta');
    const respPeriod = allQuotes.filter(q => withinDays(q.created_at, days)).length;
    if (rspEl) { rspEl.textContent = respPeriod ? `▲ ${respPeriod}` : '—'; rspEl.className = 'delta ' + (respPeriod ? 'up' : 'flat'); }

    setText('#ex-kpi-tt', ttq != null ? ttq.toFixed(1) : '—');

    const spend = allQuotes
      .filter(q => q.status === 'accepted')
      .reduce((s, q) => {
        const rfq = rfqs.find(r => r.id === q.rfq_id) || {};
        return s + (Number(q.unit_price) || 0) * (Number(rfq.quantity) || 0);
      }, 0);
    const sp = fmtMoneyShort(spend);
    setText('#ex-kpi-spend', sp.value);
    setText('#ex-kpi-spend-unit', sp.unit);

    /* ── Sparklines ── */
    drawExSpark('ex-spark-rfqs',  bucketizeEx(rfqs,      30, 8));
    drawExSpark('ex-spark-resp',  bucketizeEx(allQuotes, 30, 8));
    drawExSpark('ex-spark-tt',    bucketizeEx(allQuotes, 30, 8));
    drawExSpark('ex-spark-spend', bucketizeSpendEx(allQuotes, rfqs));

    /* ── Active requirements table ── */
    setText('#ex-open-count', open);
    const tbody = $('#ex-active-tbody');
    if (tbody) {
      const activeRows = rfqs
        .filter(r => r.status === 'open' || r.status === 'quoted')
        .slice(0, 6);
      if (!activeRows.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text-muted);">No open requirements — post one to get started.</td></tr>`;
      } else {
        const maxResp = Math.max(1, ...activeRows.map(r => (state.responsesByRfq[r.id] || []).length));
        tbody.innerHTML = activeRows.map(r => {
          const resp = (state.responsesByRfq[r.id] || []).length;
          const p = resp / maxResp;
          const indClass = r.industry === 'surgical' ? 'chip--surg'
                         : r.industry === 'sports'   ? 'chip--sport'
                         : r.industry === 'leather'  ? 'chip--leath'
                         : 'chip--quoted';
          const indPip = r.industry === 'surgical' ? 'I' : r.industry === 'sports' ? 'II' : r.industry === 'leather' ? 'III' : '';
          const status = resp > 0 ? { cls:'chip--quoted', label:'Quoted' } : { cls:'chip--open', label:'Receiving' };
          return `<tr data-rfq-id="${escapeHtmlEx(r.id)}">
            <td><div class="dt-cell-main"><div><div class="ti">${escapeHtmlEx(r.product || '—')}</div><div class="su">${escapeHtmlEx((r.specs || '').slice(0, 64))}</div></div></div></td>
            <td><span class="chip ${indClass}">${indPip ? indPip + ' ' : ''}${escapeHtmlEx(cap(r.industry || '—'))}</span></td>
            <td class="ta-right col-mono">${fmtNum(r.quantity)}</td>
            <td><div style="display:flex;align-items:center;gap:8px;"><div class="bar-cell in" style="--p:${p.toFixed(3)};"><div class="bar-cell-fill"></div></div><span class="col-mono" style="font-size:0.78rem;">${resp}</span></div></td>
            <td><span class="chip ${status.cls}">${status.label}</span></td>
            <td class="ta-right col-mono" style="color:var(--text-muted);">${fmtAgo(r.created_at)}</td>
          </tr>`;
        }).join('');
      }
    }

    /* ── Spend mix donut + legend ── */
    const indSpend = { surgical: 0, sports: 0, leather: 0 };
    allQuotes.filter(q => q.status === 'accepted').forEach(q => {
      const rfq = rfqs.find(r => r.id === q.rfq_id) || {};
      const dollars = (Number(q.unit_price) || 0) * (Number(rfq.quantity) || 0);
      if (indSpend[rfq.industry] != null) indSpend[rfq.industry] += dollars;
    });
    const donutWrap = $('#ex-spend-donut');
    if (donutWrap && window.NX) {
      donutWrap.innerHTML = '';
      NX.donut(donutWrap, {
        size: 160, thickness: 18,
        data: [
          { label:'Surgical', value: indSpend.surgical || 0.001, color:'var(--ind-surgical)' },
          { label:'Sports',   value: indSpend.sports   || 0.001, color:'var(--ind-sports)' },
          { label:'Leather',  value: indSpend.leather  || 0.001, color:'var(--ind-leather)' }
        ],
        centerValue: '$' + fmtMoneyShort(spend).value + fmtMoneyShort(spend).unit,
        centerLabel: 'YTD'
      });
    }
    const legend = $('#ex-spend-legend');
    if (legend) {
      const rows = [
        { key:'surgical', label:'Surgical', pip:'pip--surg',  ind:'I' },
        { key:'sports',   label:'Sports',   pip:'pip--sport', ind:'II' },
        { key:'leather',  label:'Leather',  pip:'pip--leath', ind:'III' }
      ];
      legend.innerHTML = rows.map(r => {
        const v = fmtMoneyShort(indSpend[r.key]);
        return `<div style="display:flex;justify-content:space-between;"><span style="display:inline-flex;align-items:center;gap:6px;"><span class="pip ${r.pip}">${r.ind}</span>${r.label}</span><span class="col-mono">$${v.value}${v.unit}</span></div>`;
      }).join('');
    }

    /* ── Top suppliers ── */
    const supplierWrap = $('#ex-top-suppliers');
    if (supplierWrap) {
      const totals = new Map();
      allQuotes.filter(q => q.status === 'accepted').forEach(q => {
        const t = totals.get(q.manufacturer_id) || { id: q.manufacturer_id, profile: q.profiles, count: 0, spend: 0 };
        const rfq = rfqs.find(r => r.id === q.rfq_id) || {};
        t.count += 1;
        t.spend += (Number(q.unit_price) || 0) * (Number(rfq.quantity) || 0);
        totals.set(q.manufacturer_id, t);
      });
      const top = [...totals.values()].sort((a, b) => b.spend - a.spend).slice(0, 3);
      if (!top.length) {
        supplierWrap.innerHTML = `<div style="padding:14px 4px;color:var(--text-muted);font-size:0.86rem;">No suppliers yet — accepted quotes will populate this list.</div>`;
      } else {
        supplierWrap.innerHTML = top.map(t => {
          const company = (t.profile && (t.profile.company || t.profile.full_name)) || 'Manufacturer';
          const initials = company.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('');
          const sp = fmtMoneyShort(t.spend);
          return `<div class="feed-item" style="padding:10px 4px;">
            <div class="feed-dot" style="background:var(--accent-soft);color:var(--accent-dark);border-color:rgba(201,100,66,0.22);font-family:var(--font-display);font-weight:600;font-size:0.74rem;">${escapeHtmlEx(initials)}</div>
            <div class="feed-text"><span class="ent">${escapeHtmlEx(company)}</span><span class="sub">${t.count} confirmed order${t.count === 1 ? '' : 's'} · $${sp.value}${sp.unit}</span></div>
            <div class="feed-time">${t.profile && t.profile.verified_status ? '5★' : '—'}</div>
          </div>`;
        }).join('');
      }
    }

    /* ── Spend trajectory chart (8 months) ── */
    const spendChart = $('#ex-spend-chart');
    if (spendChart && window.NX) {
      const now = new Date();
      const months = [];
      for (let i = 7; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({ key: d.getFullYear() + '-' + d.getMonth(), label: d.toLocaleString('en-US', { month:'short' }), value: 0 });
      }
      allQuotes.filter(q => q.status === 'accepted').forEach(q => {
        const t = new Date(q.created_at);
        const k = t.getFullYear() + '-' + t.getMonth();
        const idx = months.findIndex(m => m.key === k);
        if (idx >= 0) {
          const rfq = rfqs.find(r => r.id === q.rfq_id) || {};
          months[idx].value += (Number(q.unit_price) || 0) * (Number(rfq.quantity) || 0);
        }
      });
      spendChart.innerHTML = '';
      NX.areaChart(spendChart, {
        width: 720, height: 240,
        data: months.map(m => ({ label: m.label, value: m.value })),
        color: 'var(--accent)', smooth: true
      });
    }

    /* ── Activity feed ── */
    const feed = $('#ex-feed');
    if (feed) {
      const items = [];
      allQuotes.slice(0, 6).forEach(q => {
        const rfq = rfqs.find(r => r.id === q.rfq_id) || {};
        items.push({
          ts: q.created_at,
          kind: q.status === 'accepted' ? 'won' : 'quote',
          html: q.status === 'accepted'
            ? `<span class="ent">${escapeHtmlEx((q.profiles || {}).company || 'Manufacturer')}</span> shipped on order — <strong>${escapeHtmlEx(rfq.product || '')}</strong>.<span class="sub">${fmtMoney(q.unit_price)} per unit · lead ${escapeHtmlEx(q.lead_time || '—')}</span>`
            : `<span class="ent">${escapeHtmlEx((q.profiles || {}).company || 'Manufacturer')}</span> quoted <strong>${fmtMoney(q.unit_price)}/unit</strong> on ${escapeHtmlEx(rfq.product || 'your RFQ')}.<span class="sub">Lead time: ${escapeHtmlEx(q.lead_time || '—')}</span>`
        });
      });
      rfqs.slice(0, 4).forEach(r => {
        const responseCount = (state.responsesByRfq[r.id] || []).length;
        items.push({ ts: r.created_at, kind: 'rfq',
          html: responseCount
            ? `Your RFQ <strong>${escapeHtmlEx(r.product || '')}</strong> received ${responseCount} quote${responseCount === 1 ? '' : 's'}.<span class="sub">${escapeHtmlEx(cap(r.industry || ''))} · ${escapeHtmlEx(r.destination || '')}</span>`
            : `Posted RFQ — <strong>${escapeHtmlEx(r.product || '')}</strong>.<span class="sub">Awaiting first response · ${escapeHtmlEx(r.destination || '')}</span>`
        });
      });
      items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
      const top = items.slice(0, 8);
      if (!top.length) {
        feed.innerHTML = `<div style="padding:18px;text-align:center;color:var(--text-muted);font-size:0.88rem;">No activity yet.</div>`;
      } else {
        feed.innerHTML = top.map(it => {
          const color = it.kind === 'won' ? 'var(--success)' : it.kind === 'rfq' ? 'var(--accent)' : 'var(--text-mid)';
          const icon = it.kind === 'won'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>'
            : it.kind === 'rfq'
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
          return `<div class="feed-item">
            <div class="feed-dot" style="color:${color};">${icon}</div>
            <div class="feed-text">${it.html}</div>
            <div class="feed-time">${fmtAgo(it.ts)}</div>
          </div>`;
        }).join('');
      }
    }

    /* ── Footer sync stamp ── */
    setText('#ex-sync', new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false }));
    setText('#ex-locale', state.profile.location || 'live');
  }

  function drawExSpark(id, data) {
    const el = document.getElementById(id);
    if (!el || !window.NX || !NX.sparkline) return;
    el.innerHTML = NX.sparkline(data, { width: 96, height: 32, color: 'var(--accent)' });
  }
  function bucketizeEx(items, days, buckets) {
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
  function bucketizeSpendEx(quotes, rfqs) {
    const buckets = 8, span = 30 * 86_400_000;
    const arr = new Array(buckets).fill(0);
    quotes.filter(q => q.status === 'accepted').forEach(q => {
      const t = new Date(q.created_at).getTime();
      if (!t) return;
      const idx = buckets - 1 - Math.floor((Date.now() - t) / (span / buckets));
      if (idx >= 0 && idx < buckets) {
        const rfq = rfqs.find(r => r.id === q.rfq_id) || {};
        arr[idx] += (Number(q.unit_price) || 0) * (Number(rfq.quantity) || 0);
      }
    });
    if (arr.every(v => v === 0)) return arr.map((_, i) => i + 1);
    return arr;
  }
  function computeTimeToFirstQuote(rfqs, allQuotes) {
    const samples = [];
    rfqs.forEach(r => {
      const quotes = allQuotes.filter(q => q.rfq_id === r.id);
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
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
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
  function fmtMoney(n) { return n == null ? '—' : '$' + Number(n).toFixed(2); }
  function cap(s) { return String(s || '').replace(/^./, c => c.toUpperCase()); }
  function fmtAgo(iso) { return timeAgo(iso); }
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
