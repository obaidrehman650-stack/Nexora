/* ════════════════════════════════════════
   NEXORA — Dashboard JS
   Views · Modals · Search · Notifications
════════════════════════════════════════ */

/* ════════════════════════════════════════
   DATA
════════════════════════════════════════ */
const LEADS_SOURCE = [
  {
    id: 'L-2041',
    industry: 'sports',
    product: 'Hand-Stitched Match Football',
    desc: 'Size 5, FIFA Quality Pro spec, custom branding required.',
    fullDesc: 'Buyer is sourcing official match-day footballs for a regional league. Requires 32-panel hand-stitched construction, butyl bladder, embossed branding on 4 panels. Sample approval required before bulk PO.',
    quantity: 12000, unit: 'units',
    destination: 'Germany',
    moq: 500,
    targetPrice: 8.50,
    buyer: 'Verified Buyer · DE-22',
    buyerSince: '2024',
    deals: 14,
    leadTime: '45 days',
    isNew: true,
    minutesAgo: 2,
    status: 'open'
  },
  {
    id: 'L-2040',
    industry: 'surgical',
    product: 'Stainless Steel Mosquito Forceps',
    desc: 'AISI 410 grade, 5" curved, CE-marked. Sample required.',
    fullDesc: 'Hospital procurement group ordering replacement instruments across 12 facilities. Need ISO 13485 and EU MDR compliance documentation upfront. Mirror polish, laser-etched lot numbers.',
    quantity: 5000, unit: 'pcs',
    destination: 'USA',
    moq: 1000,
    targetPrice: 3.20,
    buyer: 'Verified Buyer · US-FL',
    buyerSince: '2023',
    deals: 28,
    leadTime: '30 days',
    isNew: true,
    minutesAgo: 6,
    status: 'open'
  },
  {
    id: 'L-2039',
    industry: 'leather',
    product: 'Premium Motorcycle Gloves',
    desc: 'Full-grain cowhide, knuckle protection, CE Level 1.',
    fullDesc: 'European retailer expanding their riding gear line. Full-grain Pakistani cowhide, TPU knuckle, Kevlar lining at palm. Three sizes, two colorways. EN 13594 certification required.',
    quantity: 2500, unit: 'pairs',
    destination: 'Italy',
    moq: 250,
    targetPrice: 24.00,
    buyer: 'Verified Buyer · IT-MI',
    buyerSince: '2024',
    deals: 7,
    leadTime: '60 days',
    isNew: false,
    minutesAgo: 14,
    status: 'open'
  },
  {
    id: 'L-2038',
    industry: 'sports',
    product: 'Pro Series Boxing Gloves 16oz',
    desc: 'Synthetic leather, dual Velcro, private label OK.',
    fullDesc: 'Boxing equipment brand launching a new pro line. PU leather, IMF foam construction, mesh palm, custom logo and packaging. 4 colorways. Looking for OEM partner.',
    quantity: 3000, unit: 'pairs',
    destination: 'United Kingdom',
    moq: 300,
    targetPrice: 18.00,
    buyer: 'Verified Buyer · UK-LDN',
    buyerSince: '2022',
    deals: 41,
    leadTime: '45 days',
    isNew: false,
    minutesAgo: 22,
    status: 'open'
  },
  {
    id: 'L-2037',
    industry: 'surgical',
    product: 'Dental Extraction Forceps Set',
    desc: '12-piece set, English pattern, mirror polish.',
    fullDesc: '12-piece extraction set, English pattern, anatomical handles. Velvet-lined presentation case. Each instrument individually laser-etched. ISO 7153-1 compliant materials.',
    quantity: 800, unit: 'sets',
    destination: 'France',
    moq: 100,
    targetPrice: 145.00,
    buyer: 'Verified Buyer · FR-LY',
    buyerSince: '2023',
    deals: 12,
    leadTime: '40 days',
    isNew: false,
    minutesAgo: 41,
    status: 'open'
  },
  {
    id: 'L-2036',
    industry: 'leather',
    product: 'Aniline Leather Bifold Wallets',
    desc: 'Vegetable-tanned, RFID lining, embossed logo.',
    fullDesc: 'Premium leather brand launching travel collection. Vegetable-tanned aniline, RFID-shielded card slots, gold foil interior stamp. 3 colorways. Custom packaging required.',
    quantity: 6000, unit: 'units',
    destination: 'Netherlands',
    moq: 500,
    targetPrice: 14.50,
    buyer: 'Verified Buyer · NL-AMS',
    buyerSince: '2024',
    deals: 5,
    leadTime: '45 days',
    isNew: false,
    minutesAgo: 58,
    status: 'open'
  },
  {
    id: 'L-2035',
    industry: 'sports',
    product: 'Cricket Batting Gloves',
    desc: 'Pittard leather palm, HDF cane insert, men\'s sizing.',
    fullDesc: 'Cricket gear retailer ordering for upcoming season. Pittard leather palm, high-density foam fingers, cane insert, sweat band. Right and left-hand variants.',
    quantity: 1500, unit: 'pairs',
    destination: 'Australia',
    moq: 200,
    targetPrice: 32.00,
    buyer: 'Verified Buyer · AU-SYD',
    buyerSince: '2023',
    deals: 18,
    leadTime: '50 days',
    isNew: false,
    minutesAgo: 73,
    status: 'open'
  },
  {
    id: 'L-2034',
    industry: 'surgical',
    product: 'Orthopedic Bone Cutters',
    desc: 'Liston pattern, 7", titanium-coated. ISO 13485 docs.',
    fullDesc: 'Orthopedic distributor for South-East Asian hospitals. Liston pattern bone cutters, 7-inch, titanium-nitride coating. Tungsten carbide inserts.',
    quantity: 600, unit: 'pcs',
    destination: 'Japan',
    moq: 50,
    targetPrice: 78.00,
    buyer: 'Verified Buyer · JP-OSK',
    buyerSince: '2022',
    deals: 22,
    leadTime: '35 days',
    isNew: false,
    minutesAgo: 95,
    status: 'open'
  },
  {
    id: 'L-2033',
    industry: 'leather',
    product: 'Industrial Welding Aprons',
    desc: 'Split cowhide, 24"x36", reinforced strap.',
    fullDesc: 'Industrial safety distributor. Split cowhide, 24"x36" coverage, reinforced cross-back strap, brass grommets. EN ISO 11611 Class 1 compliance.',
    quantity: 4000, unit: 'units',
    destination: 'UAE',
    moq: 500,
    targetPrice: 19.00,
    buyer: 'Verified Buyer · AE-DXB',
    buyerSince: '2024',
    deals: 9,
    leadTime: '40 days',
    isNew: false,
    minutesAgo: 118,
    status: 'open'
  },
  {
    id: 'L-2032',
    industry: 'sports',
    product: 'Goalkeeper Gloves — Adult',
    desc: '4mm German latex, finger spines, negative cut.',
    fullDesc: 'Football gear retailer in Spain. 4mm German latex palm, finger spine protection, negative cut wrist closure. Sizes 8-11. Two colorways.',
    quantity: 2000, unit: 'pairs',
    destination: 'Spain',
    moq: 200,
    targetPrice: 22.50,
    buyer: 'Verified Buyer · ES-BCN',
    buyerSince: '2023',
    deals: 16,
    leadTime: '45 days',
    isNew: false,
    minutesAgo: 142,
    status: 'open'
  }
];

/* Past RFQ history for RFQs view */
const HISTORY_LEADS = [
  { id: 'L-1998', industry: 'sports',   product: 'Training Footballs Size 4',     destination: 'Brazil',    quantity: 8000, status: 'quoted', minutesAgo: 1440, sentPrice: 5.20 },
  { id: 'L-1991', industry: 'surgical', product: 'Surgical Scissors (Mayo) Set',  destination: 'Canada',    quantity: 2000, status: 'won',    minutesAgo: 2880, sentPrice: 12.40 },
  { id: 'L-1985', industry: 'leather',  product: 'Equestrian Riding Gloves',      destination: 'Germany',   quantity: 1200, status: 'quoted', minutesAgo: 4320, sentPrice: 18.00 },
  { id: 'L-1972', industry: 'sports',   product: 'Boxing Hand Wraps 180"',        destination: 'USA',       quantity: 12000,status: 'lost',   minutesAgo: 7200, sentPrice: 1.80 },
  { id: 'L-1968', industry: 'leather',  product: 'Bifold Wallets, Embossed',      destination: 'Sweden',    quantity: 3000, status: 'won',    minutesAgo: 10080, sentPrice: 13.50 },
  { id: 'L-1955', industry: 'surgical', product: 'Dental Mirrors, Size 5',        destination: 'Australia', quantity: 5000, status: 'won',    minutesAgo: 14400, sentPrice: 2.10 }
];

/* Notifications */
const NOTIF_DATA = [
  { id: 1, unread: true,  text: '<strong>New RFQ</strong> — Hand-Stitched Match Football (Germany)',     time: '2m ago' },
  { id: 2, unread: true,  text: '<strong>L-1991</strong> moved to <strong>Won</strong>. Congrats.',     time: '14m ago' },
  { id: 3, unread: true,  text: '<strong>Klaus Müller</strong> replied on L-2038 — Boxing Gloves',       time: '38m ago' },
  { id: 4, unread: false, text: '<strong>New buyer</strong> verified in your network — IT-MI',           time: '2h ago' },
  { id: 5, unread: false, text: 'Your profile was viewed <strong>12 times</strong> this week',           time: '1d ago' }
];

/* Message threads */
const THREADS = [
  {
    id: 't1', name: 'Klaus Müller — Sport DE', initials: 'KM',
    preview: 'Confirmed the sample order, sending PO by Friday.',
    time: '2m', unread: true,
    sub: 'Re: L-2038 · Pro Series Boxing Gloves',
    messages: [
      { from: 'them', text: 'Hi — we received your quote, all looks good.', time: '10:24' },
      { from: 'them', text: 'One question: can you adjust palm padding to 12mm instead of 10mm?', time: '10:25' },
      { from: 'me',   text: 'Salam Klaus, yes 12mm is no problem. Sample lead time stays at 7 days.', time: '10:31' },
      { from: 'them', text: 'Perfect. Confirmed the sample order, sending PO by Friday.', time: '10:42' }
    ]
  },
  {
    id: 't2', name: 'Hiroshi Tanaka — OrthoJP', initials: 'HT',
    preview: 'Need ISO certificates and lot tracking specs.',
    time: '38m', unread: true,
    sub: 'Re: L-2034 · Orthopedic Bone Cutters',
    messages: [
      { from: 'them', text: 'Konnichiwa. Can you share your ISO 13485 documentation?', time: 'Yesterday' },
      { from: 'me',   text: 'Sending now — also includes our latest audit report from March.', time: 'Yesterday' },
      { from: 'them', text: 'Need ISO certificates and lot tracking specs.', time: '38m' }
    ]
  },
  {
    id: 't3', name: 'Anna Larsen — NordicWallet', initials: 'AL',
    preview: 'Great. Looking forward to the proto samples.',
    time: '2h', unread: false,
    sub: 'Re: L-1968 · Bifold Wallets',
    messages: [
      { from: 'them', text: 'Loved the leather grain on the prototype.', time: 'Mon' },
      { from: 'me',   text: 'Glad to hear it. Production starts next week — we\'ll ship 100 units first.', time: 'Mon' },
      { from: 'them', text: 'Great. Looking forward to the proto samples.', time: '2h' }
    ]
  },
  {
    id: 't4', name: 'Sara Conti — RidersIT', initials: 'SC',
    preview: 'Can we move to titanium hardware? Quote difference?',
    time: '1d', unread: false,
    sub: 'Re: L-2039 · Motorcycle Gloves',
    messages: [
      { from: 'them', text: 'Quick spec question.', time: '1d' },
      { from: 'them', text: 'Can we move to titanium hardware? Quote difference?', time: '1d' }
    ]
  }
];

/* Sialkot profile (current user) */
const PROFILE = {
  company: 'Obur Industries',
  type: 'Manufacturer',
  initials: 'OI',
  verified: true,
  joined: 'Founding member · 2026',
  city: 'Sialkot, Punjab',
  employees: '180–220',
  capacity: '24,000 units / month',
  founded: 1998,
  industries: ['Sports goods', 'Leather'],
  certifications: [
    { name: 'ISO 9001:2015',  body: 'Quality Management',     year: '2024' },
    { name: 'FIFA Quality Pro', body: 'Sports Goods',         year: '2023' },
    { name: 'WFSGI Member',   body: 'Sports Industry',        year: '2022' },
    { name: 'SEDEX 4-Pillar', body: 'Ethical Audit',          year: '2024' }
  ]
};

/* ════════════════════════════════════════
   STATE
════════════════════════════════════════ */
const state = {
  view: 'dashboard',
  filter: 'all',
  search: '',
  leads: [...LEADS_SOURCE],
  quoted: new Set(),
  quotes: {},                    // { leadId: { price, leadTime, ... } }
  notifs: [...NOTIF_DATA],
  threads: [...THREADS],
  activeThread: 't1',
  openPopover: null
};

/* ════════════════════════════════════════
   UTILS
════════════════════════════════════════ */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function fmtNum(n) { return Number(n).toLocaleString('en-US'); }
function fmtMoney(n) { return '$' + Number(n).toFixed(2); }
function fmtAgo(min) {
  if (min < 1)  return 'Just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)   return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  // Adjust topbar search placeholder per view
  const search = $('#search-input');
  if (search) {
    const ph = {
      dashboard: 'Search leads, buyers, products…',
      rfqs:      'Search RFQ history…',
      profile:   'Search profile fields…',
      messages:  'Search conversations…'
    };
    search.placeholder = ph[name] || ph.dashboard;
  }
  if (name === 'rfqs')     renderRfqs();
  if (name === 'messages') renderThreads();
}

$$('.nav-item[data-section]').forEach(n => {
  n.addEventListener('click', e => { e.preventDefault(); setView(n.dataset.section); });
});

/* ════════════════════════════════════════
   SIDEBAR (mobile)
════════════════════════════════════════ */
const sidebar = $('.sidebar');
const scrim   = $('.sidebar-scrim');
const menuBtn = $('.menu-toggle');
function openSidebar()  { sidebar.classList.add('open');    scrim.classList.add('show'); }
function closeSidebar() { sidebar.classList.remove('open'); scrim.classList.remove('show'); }
if (menuBtn) menuBtn.addEventListener('click', openSidebar);
if (scrim)   scrim.addEventListener('click', closeSidebar);
window.addEventListener('resize', () => { if (window.innerWidth > 880) closeSidebar(); });

/* ════════════════════════════════════════
   POPOVERS — notifications / settings
════════════════════════════════════════ */
function togglePopover(name, anchorBtn) {
  if (state.openPopover === name) { closeAllPopovers(); return; }
  closeAllPopovers();
  state.openPopover = name;
  $(`#popover-${name}`).classList.add('show');
  anchorBtn.classList.add('open');
}
function closeAllPopovers() {
  $$('.popover').forEach(p => p.classList.remove('show'));
  $$('.icon-btn').forEach(b => b.classList.remove('open'));
  state.openPopover = null;
}
$('#btn-notifs').addEventListener('click', e => {
  e.stopPropagation();
  togglePopover('notifs', e.currentTarget);
});
$('#btn-settings').addEventListener('click', e => {
  e.stopPropagation();
  togglePopover('settings', e.currentTarget);
});
$$('.popover').forEach(p => p.addEventListener('click', e => e.stopPropagation()));
document.addEventListener('click', closeAllPopovers);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAllPopovers(); closeModals(); } });

function renderNotifs() {
  const list = $('#notif-list');
  const dot  = $('#notif-dot');
  const unread = state.notifs.filter(n => n.unread).length;
  if (dot) dot.style.display = unread ? 'block' : 'none';
  if (!list) return;
  if (!state.notifs.length) {
    list.innerHTML = '<div class="popover-empty">You\'re all caught up.</div>';
    return;
  }
  list.innerHTML = state.notifs.map((n, i) => `
    <div class="notif-item${n.unread ? ' unread' : ''}" data-id="${n.id}" style="--i:${i}">
      <span class="notif-dot-static"></span>
      <div class="notif-content">${n.text}</div>
      <span class="notif-time">${escapeHtml(n.time)}</span>
    </div>`).join('');
  list.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = +item.dataset.id;
      const n = state.notifs.find(x => x.id === id);
      if (n) n.unread = false;
      renderNotifs();
    });
  });
}
$('#notif-clear').addEventListener('click', () => {
  state.notifs.forEach(n => n.unread = false);
  renderNotifs();
  toast('All notifications marked as read.');
});

/* Settings menu items */
$$('#popover-settings .menu-item').forEach(item => {
  item.addEventListener('click', () => {
    const action = item.dataset.action;
    closeAllPopovers();
    if (action === 'logout')  toast('Logged out — redirecting…');
    else if (action === 'help')    toast('Help center opened in new tab.');
    else if (action === 'theme')   toast('Theme settings coming in v0.4.');
    else if (action === 'account') toast('Account settings coming in v0.4.');
  });
});

/* ════════════════════════════════════════
   SEARCH
════════════════════════════════════════ */
const searchInput = $('#search-input');
const searchClear = $('#search-clear');
searchInput.addEventListener('input', e => {
  state.search = e.target.value.trim().toLowerCase();
  searchInput.parentElement.classList.toggle('has-value', !!state.search);
  if (state.view === 'dashboard') renderLeads();
  if (state.view === 'rfqs')      renderRfqs();
  if (state.view === 'messages')  renderThreads();
});
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  state.search = '';
  searchInput.parentElement.classList.remove('has-value');
  searchInput.focus();
  if (state.view === 'dashboard') renderLeads();
  if (state.view === 'rfqs')      renderRfqs();
  if (state.view === 'messages')  renderThreads();
});

/* ════════════════════════════════════════
   DASHBOARD VIEW — lead cards
════════════════════════════════════════ */
const grid    = $('#leads-grid');
const liveCt  = $('#live-count');

function filteredLeads() {
  let leads = state.filter === 'all'
    ? state.leads
    : state.leads.filter(l => l.industry === state.filter);
  if (state.search) {
    const q = state.search;
    leads = leads.filter(l =>
      l.product.toLowerCase().includes(q) ||
      l.destination.toLowerCase().includes(q) ||
      l.id.toLowerCase().includes(q) ||
      l.industry.toLowerCase().includes(q) ||
      l.buyer.toLowerCase().includes(q)
    );
  }
  return leads;
}

function renderLeads() {
  const leads = filteredLeads();
  if (!leads.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.3-4.3"/>
        </svg>
        <h3>${state.search ? 'No leads match your search' : 'No matching leads'}</h3>
        <p>${state.search ? 'Try different keywords or clear the search.' : 'Try a different industry filter — new leads arrive every few minutes.'}</p>
      </div>`;
    return;
  }
  grid.innerHTML = leads.map((l, i) => leadCardHTML(l, i)).join('');
  attachLeadHandlers();
}

function leadCardHTML(l, i = 0) {
  const isQuoted = state.quoted.has(l.id);
  const industryLabel = l.industry.charAt(0).toUpperCase() + l.industry.slice(1);
  return `
    <article class="lead-card${l.isNew ? ' new' : ''}" data-lead-id="${l.id}" style="--i:${i}">
      <div class="lead-top">
        <span class="industry-badge ${l.industry}">${industryLabel}</span>
        <span class="lead-time" data-min="${l.minutesAgo}">${fmtAgo(l.minutesAgo)}</span>
      </div>
      <div>
        <h3 class="lead-product">${escapeHtml(l.product)}</h3>
        <p class="lead-desc">${escapeHtml(l.desc)}</p>
      </div>
      <div class="lead-meta">
        <div class="meta-item">
          <span class="meta-label">Quantity</span>
          <span class="meta-value"><strong>${fmtNum(l.quantity)}</strong> ${l.unit}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Destination</span>
          <span class="meta-value">${escapeHtml(l.destination)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">MOQ</span>
          <span class="meta-value">${fmtNum(l.moq)} ${l.unit}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Ref</span>
          <span class="meta-value">${l.id}</span>
        </div>
      </div>
      <div class="lead-buyer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 12l2 2 4-4"/>
          <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>${escapeHtml(l.buyer)}</span>
      </div>
      <div class="lead-actions">
        <button class="btn-quote${isQuoted ? ' sent' : ''}" data-action="quote" data-id="${l.id}" ${isQuoted ? 'disabled' : ''}>
          ${isQuoted
            ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Quote Sent`
            : `Send Quote
               <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`}
        </button>
        <button class="btn-details" data-action="details" data-id="${l.id}">Details</button>
      </div>
    </article>`;
}

function attachLeadHandlers() {
  grid.querySelectorAll('[data-action="quote"]').forEach(btn => {
    btn.addEventListener('click', () => openQuoteModal(btn.dataset.id));
  });
  grid.querySelectorAll('[data-action="details"]').forEach(btn => {
    btn.addEventListener('click', () => openDetailsModal(btn.dataset.id));
  });
}

/* ════════════════════════════════════════
   FILTER PILLS
════════════════════════════════════════ */
$$('.pill').forEach(pill => {
  pill.addEventListener('click', () => {
    $$('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.filter = pill.dataset.filter;
    renderLeads();
  });
});

/* ════════════════════════════════════════
   STATS / COUNTS
════════════════════════════════════════ */
function updateLiveCount() {
  const total = state.leads.length;
  const open  = state.leads.filter(l => !state.quoted.has(l.id)).length;
  if (liveCt) liveCt.textContent = open;

  const rfqBadge = $('.nav-item[data-section="rfqs"] .badge');
  if (rfqBadge) rfqBadge.textContent = open + HISTORY_LEADS.length;

  ['all','sports','surgical','leather'].forEach(k => {
    const c = $(`.pill[data-filter="${k}"] .count`);
    if (!c) return;
    c.textContent = k === 'all'
      ? total
      : state.leads.filter(l => l.industry === k).length;
  });

  const elTotal   = $('#stat-total');
  const elNew     = $('#stat-new');
  const elQuoted  = $('#stat-quoted');
  const elMarkets = $('#stat-markets');
  if (elTotal)   elTotal.textContent   = total;
  if (elNew)     elNew.textContent     = state.leads.filter(l => l.isNew).length;
  if (elQuoted)  elQuoted.textContent  = state.quoted.size;
  if (elMarkets) elMarkets.textContent = new Set(state.leads.map(l => l.destination)).size;
}

/* ════════════════════════════════════════
   ✦ QUOTE MODAL ✦
════════════════════════════════════════ */
const quoteModal      = $('#modal-quote');
const detailsModal    = $('#modal-details');
let currentQuoteLead  = null;

function openQuoteModal(id) {
  const lead = state.leads.find(l => l.id === id);
  if (!lead) return;
  currentQuoteLead = lead;

  $('#q-eyebrow').textContent = `New Quote · ${lead.id}`;
  $('#q-title').textContent = lead.product;
  $('#q-sub').textContent = `${fmtNum(lead.quantity)} ${lead.unit} · ${lead.destination}`;

  $('#q-sum-qty').textContent      = `${fmtNum(lead.quantity)} ${lead.unit}`;
  $('#q-sum-target').textContent   = fmtMoney(lead.targetPrice);
  $('#q-sum-dest').textContent     = lead.destination;

  // Reset fields with smart defaults
  $('#q-price').value         = lead.targetPrice.toFixed(2);
  $('#q-moq').value           = lead.moq;
  $('#q-lead-time').value     = lead.leadTime;
  $('#q-payment').value       = '50% deposit, 50% on B/L';
  $('#q-incoterm').value      = 'FOB Karachi';
  $('#q-notes').value         = '';

  openModal(quoteModal);
  setTimeout(() => $('#q-price').focus(), 200);
}

$('#q-submit').addEventListener('click', () => {
  if (!currentQuoteLead) return;
  const price = parseFloat($('#q-price').value);
  if (!price || price <= 0) {
    $('#q-price').focus();
    toast('Please enter a valid unit price.');
    return;
  }
  state.quoted.add(currentQuoteLead.id);
  state.quotes[currentQuoteLead.id] = {
    price,
    moq:       $('#q-moq').value,
    leadTime:  $('#q-lead-time').value,
    payment:   $('#q-payment').value,
    incoterm:  $('#q-incoterm').value,
    notes:     $('#q-notes').value,
    sentAt:    new Date().toISOString()
  };
  toast(`Quote sent for ${currentQuoteLead.product} → ${currentQuoteLead.destination}.`);

  // Add a notification
  state.notifs.unshift({
    id: Date.now(),
    unread: true,
    text: `<strong>Quote sent</strong> — ${currentQuoteLead.product} (${currentQuoteLead.destination})`,
    time: 'Just now'
  });
  renderNotifs();

  closeModals();
  renderLeads();
  updateLiveCount();
});

/* ════════════════════════════════════════
   ✦ DETAILS MODAL ✦
════════════════════════════════════════ */
function openDetailsModal(id) {
  const lead = state.leads.find(l => l.id === id);
  if (!lead) return;
  const isQuoted = state.quoted.has(lead.id);
  const industryLabel = lead.industry.charAt(0).toUpperCase() + lead.industry.slice(1);

  $('#d-eyebrow').textContent = `Lead detail · ${lead.id}`;
  $('#d-title').textContent = lead.product;
  $('#d-sub').textContent = `${fmtNum(lead.quantity)} ${lead.unit} · ${lead.destination}`;

  $('#d-body').innerHTML = `
    <div class="detail-section">
      <h4>About this lead</h4>
      <div style="display:flex; gap:10px; align-items:center; margin-bottom: 12px;">
        <span class="industry-badge ${lead.industry}">${industryLabel}</span>
        <span class="lead-time">${fmtAgo(lead.minutesAgo)}</span>
      </div>
      <p>${escapeHtml(lead.fullDesc || lead.desc)}</p>
    </div>

    <div class="detail-section">
      <h4>Specifications</h4>
      <div class="detail-grid">
        <div class="meta-item">
          <span class="meta-label">Quantity</span>
          <span class="meta-value"><strong>${fmtNum(lead.quantity)}</strong> ${lead.unit}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">MOQ</span>
          <span class="meta-value">${fmtNum(lead.moq)} ${lead.unit}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Destination</span>
          <span class="meta-value">${escapeHtml(lead.destination)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Lead time</span>
          <span class="meta-value">${escapeHtml(lead.leadTime)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Target price</span>
          <span class="meta-value">${fmtMoney(lead.targetPrice)} / ${lead.unit.slice(0,-1)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Reference</span>
          <span class="meta-value">${lead.id}</span>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h4>Buyer</h4>
      <div class="detail-grid">
        <div class="meta-item">
          <span class="meta-label">Identity</span>
          <span class="meta-value">${escapeHtml(lead.buyer)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">On Nexora since</span>
          <span class="meta-value">${escapeHtml(lead.buyerSince)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Closed deals</span>
          <span class="meta-value">${lead.deals}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Status</span>
          <span class="meta-value"><span class="status-chip ${isQuoted ? 'quoted' : 'open'}">${isQuoted ? 'Quoted' : 'Open'}</span></span>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <h4>Activity</h4>
      <ul class="timeline">
        <li class="now">
          <strong>RFQ received</strong>
          <span class="time">${fmtAgo(lead.minutesAgo)}</span>
        </li>
        <li>
          <strong>Buyer verified by Nexora</strong>
          <span class="time">Member since ${lead.buyerSince}</span>
        </li>
        <li>
          <strong>${lead.deals} prior deals closed via platform</strong>
          <span class="time">Across ${Math.max(2, Math.floor(lead.deals/4))} suppliers</span>
        </li>
      </ul>
    </div>
  `;

  $('#d-cta').textContent = isQuoted ? 'View Sent Quote' : 'Send Quote';
  $('#d-cta').onclick = () => {
    closeModals();
    if (!isQuoted) setTimeout(() => openQuoteModal(lead.id), 280);
    else toast(`Quote for ${lead.id}: ${fmtMoney(state.quotes[lead.id].price)} / unit`);
  };

  openModal(detailsModal);
}

/* ════════════════════════════════════════
   MODAL CORE
════════════════════════════════════════ */
function openModal(m) {
  m.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeModals() {
  $$('.modal-backdrop').forEach(m => m.classList.remove('show'));
  document.body.style.overflow = '';
  currentQuoteLead = null;
}
$$('[data-close-modal]').forEach(b => b.addEventListener('click', closeModals));
$$('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', e => { if (e.target === bd) closeModals(); });
});

/* ════════════════════════════════════════
   ✦ RFQs VIEW
════════════════════════════════════════ */
function renderRfqs() {
  const tbody = $('#rfq-tbody');
  if (!tbody) return;

  const openLeads = state.leads.map(l => ({
    id: l.id, industry: l.industry, product: l.product, destination: l.destination,
    quantity: l.quantity, status: state.quoted.has(l.id) ? 'quoted' : 'open',
    minutesAgo: l.minutesAgo,
    sentPrice: state.quotes[l.id] ? state.quotes[l.id].price : null
  }));
  let rows = [...openLeads, ...HISTORY_LEADS];

  if (state.search) {
    const q = state.search;
    rows = rows.filter(r =>
      r.product.toLowerCase().includes(q) ||
      r.destination.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q)
    );
  }

  // Stat counts for the table
  const counts = { all: rows.length, open: 0, quoted: 0, won: 0, lost: 0 };
  rows.forEach(r => counts[r.status]++);
  $('#rfq-stat-all').textContent    = counts.all;
  $('#rfq-stat-open').textContent   = counts.open;
  $('#rfq-stat-quoted').textContent = counts.quoted;
  $('#rfq-stat-won').textContent    = counts.won;
  $('#rfq-stat-lost').textContent   = counts.lost;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding: 40px; text-align: center; color: var(--text-muted);">No RFQs match your search.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((r, i) => `
    <tr data-id="${r.id}" style="--i:${i}">
      <td>
        <span class="rfq-product">${escapeHtml(r.product)}</span>
        <span class="rfq-meta">${r.id} · ${r.industry}</span>
      </td>
      <td>${escapeHtml(r.destination)}</td>
      <td>${fmtNum(r.quantity)}</td>
      <td>${r.sentPrice != null ? fmtMoney(r.sentPrice) : '—'}</td>
      <td><span class="status-chip ${r.status}">${r.status.charAt(0).toUpperCase()+r.status.slice(1)}</span></td>
      <td>${fmtAgo(r.minutesAgo)}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const id = tr.dataset.id;
      const lead = state.leads.find(l => l.id === id);
      if (lead) openDetailsModal(id);
      else toast(`${id} — archived RFQ, full history coming soon.`);
    });
  });
}

/* ════════════════════════════════════════
   ✦ PROFILE VIEW (interactive form)
════════════════════════════════════════ */
function bootProfile() {
  $('#p-avatar').textContent  = PROFILE.initials;
  $('#p-name').textContent    = PROFILE.company;
  $('#p-role').textContent    = PROFILE.type;
  $('#p-joined').textContent  = PROFILE.joined;
  $('#p-city').textContent    = PROFILE.city;
  $('#p-employees').textContent = PROFILE.employees;
  $('#p-capacity').textContent  = PROFILE.capacity;
  $('#p-founded').textContent   = PROFILE.founded;

  // Pre-fill form
  $('#pf-name').value      = PROFILE.company;
  $('#pf-type').value      = PROFILE.type;
  $('#pf-city').value      = PROFILE.city;
  $('#pf-founded').value   = PROFILE.founded;
  $('#pf-employees').value = PROFILE.employees;
  $('#pf-capacity').value  = PROFILE.capacity;
  $('#pf-about').value     = `Sialkot-based ${PROFILE.type.toLowerCase()} of premium sports goods and leather products. Established ${PROFILE.founded}. Capacity ${PROFILE.capacity}. ISO 9001 and FIFA Quality Pro certified.`;

  // Certifications
  $('#p-cert-grid').innerHTML = PROFILE.certifications.map(c => `
    <div class="cert-chip">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M9 12l2 2 4-4"/>
        <circle cx="12" cy="12" r="9"/>
      </svg>
      <div>
        <strong>${escapeHtml(c.name)}</strong>
        <span>${escapeHtml(c.body)} · ${c.year}</span>
      </div>
    </div>`).join('');
}

$('#profile-save').addEventListener('click', e => {
  e.preventDefault();
  // Persist to in-memory profile
  PROFILE.company  = $('#pf-name').value.trim()  || PROFILE.company;
  PROFILE.type     = $('#pf-type').value;
  PROFILE.city     = $('#pf-city').value.trim()  || PROFILE.city;
  PROFILE.founded  = $('#pf-founded').value      || PROFILE.founded;
  PROFILE.employees= $('#pf-employees').value.trim() || PROFILE.employees;
  PROFILE.capacity = $('#pf-capacity').value.trim()  || PROFILE.capacity;
  PROFILE.initials = PROFILE.company.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();

  // Reflect updates in card + sidebar
  bootProfile();
  $('.user-name').textContent = PROFILE.company;
  $('.user-role').textContent = PROFILE.type;
  $('.user-avatar').textContent = PROFILE.initials;
  toast('Profile saved.');
});

$('#profile-cancel').addEventListener('click', e => {
  e.preventDefault();
  bootProfile();
  toast('Changes discarded.');
});

/* ════════════════════════════════════════
   ✦ MESSAGES VIEW
════════════════════════════════════════ */
function renderThreads() {
  const list = $('#thread-list');
  if (!list) return;
  let threads = state.threads;
  if (state.search) {
    const q = state.search;
    threads = threads.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.preview.toLowerCase().includes(q) ||
      t.sub.toLowerCase().includes(q)
    );
  }
  list.innerHTML = threads.map((t, i) => `
    <div class="thread-item${t.id === state.activeThread ? ' active' : ''}${t.unread ? ' has-unread' : ''}" data-id="${t.id}" style="--i:${i}">
      <div class="thread-avatar">${t.initials}</div>
      <div class="thread-body">
        <div class="thread-name">${escapeHtml(t.name)}</div>
        <div class="thread-preview">${escapeHtml(t.preview)}</div>
      </div>
      <div class="thread-meta">
        ${escapeHtml(t.time)}
        <span class="unread-dot"></span>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.thread-item').forEach(item => {
    item.addEventListener('click', () => {
      state.activeThread = item.dataset.id;
      const t = state.threads.find(x => x.id === state.activeThread);
      if (t) t.unread = false;
      renderThreads();
      renderActiveThread();
    });
  });
  if (threads.length === 0) {
    list.innerHTML = '<div class="popover-empty">No conversations match.</div>';
  }
}

function renderActiveThread() {
  const t = state.threads.find(x => x.id === state.activeThread);
  if (!t) return;
  $('#thread-name').textContent = t.name;
  $('#thread-sub').textContent  = t.sub;
  $('#thread-avatar').textContent = t.initials;
  $('#thread-messages').innerHTML = t.messages.map(m => `
    <div class="msg ${m.from}">
      ${escapeHtml(m.text)}
      <span class="msg-time">${escapeHtml(m.time)}</span>
    </div>`).join('');
  // Scroll to bottom
  const msgs = $('#thread-messages');
  msgs.scrollTop = msgs.scrollHeight;
}

$('#thread-composer-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#thread-composer-input');
  const text = input.value.trim();
  if (!text) return;
  const t = state.threads.find(x => x.id === state.activeThread);
  if (!t) return;
  t.messages.push({ from: 'me', text, time: 'Just now' });
  t.preview = text;
  t.time = 'now';
  input.value = '';
  renderActiveThread();
  renderThreads();

  // Simulate a reply
  setTimeout(() => {
    const reply = pickReply(text);
    t.messages.push({ from: 'them', text: reply, time: 'Just now' });
    t.preview = reply;
    renderActiveThread();
    renderThreads();
    toast(`New message from ${t.name.split(' — ')[0]}`);
  }, 1800);
});

function pickReply(text) {
  const lower = text.toLowerCase();
  if (lower.includes('price') || lower.includes('quote')) return 'Got it — reviewing the numbers and will revert tomorrow.';
  if (lower.includes('sample') || lower.includes('proto')) return 'Send the samples whenever ready. Our usual courier address still works.';
  if (lower.includes('thank'))   return 'Anytime — let me know if anything else comes up.';
  return 'Noted, thanks. I\'ll loop back shortly.';
}

/* ════════════════════════════════════════
   LIVE-TIME TICK
════════════════════════════════════════ */
setInterval(() => {
  state.leads.forEach(l => l.minutesAgo += 1);
  HISTORY_LEADS.forEach(l => l.minutesAgo += 1);
  $$('.lead-time').forEach(el => {
    const m = parseInt(el.dataset.min, 10) + 1;
    el.dataset.min = m;
    el.textContent = fmtAgo(m);
  });
}, 60000);

/* ════════════════════════════════════════
   SIMULATED NEW-LEAD STREAM
════════════════════════════════════════ */
const SAMPLE_NEW = [
  { industry: 'sports',   product: 'Rugby Training Balls',          desc: 'Size 5, hand-stitched, 4-panel grip.',          destination: 'Australia',     moq: 100, unit: 'units', targetPrice: 7.50, leadTime: '40 days' },
  { industry: 'surgical', product: 'Surgical Scissors (Mayo)',      desc: '6.75", stainless, ratcheted handle.',           destination: 'Canada',        moq: 200, unit: 'pcs',   targetPrice: 11.00, leadTime: '30 days' },
  { industry: 'leather',  product: 'Equestrian Riding Gloves',      desc: 'Goatskin palm, mesh back, women\'s sizing.',    destination: 'United Kingdom',moq: 150, unit: 'pairs', targetPrice: 28.00, leadTime: '45 days' }
];
let nextId = 2042;

function pushNewLead() {
  if (document.hidden) return;
  const tpl = SAMPLE_NEW[Math.floor(Math.random() * SAMPLE_NEW.length)];
  const newLead = {
    ...tpl,
    id: 'L-' + (nextId++),
    fullDesc: tpl.desc + ' Detailed RFQ available — open the lead to review specifications, certifications and buyer history.',
    quantity: Math.floor((500 + Math.random() * 9500) / 100) * 100,
    buyer: 'Verified Buyer · ' + ['DE-22','US-FL','UK-LDN','NL-AMS','FR-LY','IT-MI','JP-OSK'][Math.floor(Math.random()*7)],
    buyerSince: '2024',
    deals: Math.floor(Math.random() * 20) + 1,
    isNew: true,
    minutesAgo: 0,
    status: 'open'
  };
  state.leads.forEach(l => l.isNew = false);
  state.leads.unshift(newLead);
  if (state.view === 'dashboard') renderLeads();
  if (state.view === 'rfqs')      renderRfqs();
  updateLiveCount();

  state.notifs.unshift({
    id: Date.now(),
    unread: true,
    text: `<strong>New RFQ</strong> — ${newLead.product} (${newLead.destination})`,
    time: 'Just now'
  });
  renderNotifs();
  toast(`New ${newLead.industry} lead · ${newLead.product}`);
}
setTimeout(() => setInterval(pushNewLead, 45000), 25000);

/* ════════════════════════════════════════
   TOAST
════════════════════════════════════════ */
const toastStack = $('#toast-stack');
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M9 12l2 2 4-4"/>
      <circle cx="12" cy="12" r="9"/>
    </svg>
    <span>${msg}</span>`;
  toastStack.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 260);
  }, 3400);
}

/* ════════════════════════════════════════
   USER PILL — opens settings popover
════════════════════════════════════════ */
$('.user-pill').addEventListener('click', () => setView('profile'));

/* ════════════════════════════════════════
   BOOT
════════════════════════════════════════ */
bootProfile();
renderLeads();
renderNotifs();
renderActiveThread();
updateLiveCount();
