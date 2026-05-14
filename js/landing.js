/* ════════════════════════════════════════
   NEXORA — Landing JS
   Intro · FLIP transition · Scroll reveals · Form · i18n
════════════════════════════════════════ */

const IS_TOUCH = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const REDUCED  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Force scroll to top so the intro is always in view on (re)load.
   Browsers preserve scroll position by default — disable that, then jump. */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

/* ════════════════════════════════════════
   ✦ INTRO — FLIP to nav
════════════════════════════════════════ */
const intro       = document.getElementById('intro');
const introContent= intro && intro.querySelector('.intro-content');
const introMark   = intro && intro.querySelector('.i-mark');
const introWord   = intro && intro.querySelector('.i-word');
const introTag    = intro && intro.querySelector('.i-tag');
const page        = document.getElementById('page');

function runIntro() {
  if (!intro || !page) return;

  // Show fallback if reduced motion
  if (REDUCED) {
    intro.style.display = 'none';
    page.classList.add('show');
    return;
  }

  // Wait for the intro choreography (~2.4s) then FLIP to nav
  setTimeout(flipIntroToNav, 2400);
}

function flipIntroToNav() {
  const navLogo = document.querySelector('nav .nav-logo');
  if (!navLogo) {
    intro.style.opacity = '0';
    setTimeout(() => intro.style.display = 'none', 400);
    page.classList.add('show');
    return;
  }

  // Measure positions
  const navRect     = navLogo.getBoundingClientRect();
  const contentRect = introContent.getBoundingClientRect();

  // Make the page visible underneath (still hidden by intro overlay)
  page.classList.add('show');

  // Compute target transform
  const targetX = navRect.left - contentRect.left;
  const targetY = navRect.top  - contentRect.top;
  const targetScale = navRect.height / contentRect.height;

  // Fade the tagline first — nav doesn't have one
  introTag.style.transition = 'opacity 0.32s ease, transform 0.32s ease';
  introTag.style.opacity = '0';
  introTag.style.transform = 'translateY(-6px)';

  // Wait a beat, then FLIP
  setTimeout(() => {
    introContent.style.transition = 'transform 1s cubic-bezier(0.65, 0, 0.35, 1)';
    introContent.style.transform =
      `translate(${targetX}px, ${targetY}px) scale(${targetScale})`;

    // Crossfade intro background
    intro.style.transition = 'background-color 0.6s ease 0.2s';
    intro.style.backgroundColor = 'transparent';
    intro.classList.add('done');

    // Once the FLIP lands, hide intro entirely → real nav logo shows in place
    setTimeout(() => {
      intro.style.display = 'none';
    }, 1100);
  }, 220);
}

runIntro();

/* ════════════════════════════════════════
   COUNTERS — driven by real Supabase data
   ────────────────────────────────────────
   Calls nexora_public_stats() (RPC, anon-callable).
   The HTML starts at 0 so nothing fake is ever shown;
   the counter animates from 0 → real number once fetched.
════════════════════════════════════════ */
function animateCounter(el, target, suffix, duration) {
  const start = performance.now();
  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(eased * target).toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* Pull the four hero counters from Supabase. The RPC returns a single
   JSON row of aggregate counts — never any user data, so it's safe to
   call anonymously. If Supabase isn't configured the counters stay at 0. */
async function fetchPublicStats() {
  const cfg = window.NEXORA_CONFIG || {};
  if (!cfg.SUPABASE_URL || /^YOUR-/.test(cfg.SUPABASE_URL) || !window.supabase) return null;
  try {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const { data, error } = await sb.rpc('nexora_public_stats');
    if (error) { console.warn('[stats]', error); return null; }
    return data;
  } catch (e) { console.warn('[stats]', e); return null; }
}

(async function hydrateStats() {
  const stats = await fetchPublicStats();
  /* Map RPC keys → DOM stat labels */
  const map = {
    'Active RFQs':     stats ? stats.active_rfqs    : 0,
    'Verified Units':  stats ? stats.verified_units : 0,
    'Early Adopters':  stats ? stats.total_adopters : 0,
    'Export Markets':  stats ? stats.markets        : 0
  };
  document.querySelectorAll('.stat-item').forEach(item => {
    const label = (item.querySelector('.stat-label') || {}).textContent || '';
    const value = item.querySelector('.stat-value');
    if (!value) return;
    const target = map[label] != null ? Number(map[label]) : 0;
    value.dataset.target = String(target);
    value.textContent = '0' + (value.dataset.suffix || '');
  });

  /* Adopters strip ("500+ early adopters and counting") */
  const adopters = document.querySelector('.adopters-text');
  if (adopters) {
    const n = map['Early Adopters'] || 0;
    adopters.textContent = n > 0
      ? `${n.toLocaleString()} ${n === 1 ? 'adopter' : 'adopters'} and counting`
      : 'Be one of the first to join.';
  }

  /* Now arm the IntersectionObserver to animate when each enters view */
  const counterObserver = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const target = parseInt(el.dataset.target || '0', 10);
      animateCounter(el, target, el.dataset.suffix || '', 1400);
      counterObserver.unobserve(el);
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('.stat-value[data-target]').forEach(el => counterObserver.observe(el));
})();

/* ════════════════════════════════════════
   ✦ SCROLL REVEALS
════════════════════════════════════════ */
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      revealObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

document.querySelectorAll('.reveal, .reveal-stagger').forEach(el => revealObserver.observe(el));

/* ════════════════════════════════════════
   ✦ INDUSTRY ILLUSTRATION PARALLAX
════════════════════════════════════════ */
if (window.gsap && window.ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger);

  // Bridge circuit (existing)
  const circuitPath = document.getElementById('circuit-path');
  const circuitDot  = document.getElementById('circuit-dot');
  const bridgeLeft  = document.getElementById('bridge-left');
  const bridgeRight = document.getElementById('bridge-right');

  if (circuitPath && bridgeLeft && bridgeRight) {
    ScrollTrigger.create({
      trigger: '#bridge',
      start: 'top 80%',
      end:   'bottom 60%',
      scrub: 0.6,
      onUpdate: self => {
        const p = self.progress;
        circuitPath.style.strokeDashoffset = 500 * (1 - p);
        if (p > 0.05) bridgeLeft.classList.add('lit');
        if (p > 0.55) bridgeRight.classList.add('lit');
        if (p > 0.85) circuitDot.classList.add('lit');
        else circuitDot.classList.remove('lit');
      }
    });
  }

  /* ── Showcase: pinned product · scroll-driven crossfade + transforms ─── */
  const showcase = document.getElementById('showcase');
  if (showcase) {
    const panels = showcase.querySelectorAll('.showcase-panel');
    const layers = showcase.querySelectorAll('.product-layer');
    const dots   = showcase.querySelectorAll('.showcase-progress .dot');

    function activate(industry) {
      layers.forEach(l => l.classList.toggle('is-active', l.dataset.industry === industry));
      dots.forEach(d   => d.classList.toggle('is-active', d.dataset.industry === industry));
    }

    // Activation: as each panel passes the viewport center, swap the
    // active product. onEnter handles scroll-down; onEnterBack handles
    // scroll-up so the crossfade reverses cleanly.
    panels.forEach(panel => {
      ScrollTrigger.create({
        trigger: panel,
        start:   'top center',
        end:     'bottom center',
        onEnter:     () => activate(panel.dataset.industry),
        onEnterBack: () => activate(panel.dataset.industry)
      });
    });

    // Per-panel transform on its matching product image.
    // The image rotates, scales and translates vertically as the
    // user scrolls through the panel — the "moves with scroll" feel.
    if (!REDUCED) {
      panels.forEach(panel => {
        const img = showcase.querySelector(
          `.product-layer[data-industry="${panel.dataset.industry}"] img`
        );
        if (!img) return;
        gsap.fromTo(img,
          { rotation: -10, scale: 0.92, yPercent: 10 },
          {
            rotation: 8,
            scale: 1.06,
            yPercent: -8,
            ease: 'none',
            scrollTrigger: {
              trigger: panel,
              start: 'top bottom',
              end:   'bottom top',
              scrub: 0.8
            }
          }
        );
      });

      // Stat number tightens letter-spacing as it scrolls into focus
      showcase.querySelectorAll('.showcase-stat').forEach(stat => {
        gsap.fromTo(stat,
          { letterSpacing: '-0.025em' },
          {
            letterSpacing: '-0.055em',
            scrollTrigger: {
              trigger: stat,
              start: 'top 90%',
              end:   'top 30%',
              scrub: 1
            }
          }
        );
      });
    }
  }
}

/* ════════════════════════════════════════
   SCROLL: STEPPER
════════════════════════════════════════ */
const steps = document.querySelectorAll('.step');
const progressEl = document.getElementById('stepper-progress');
function updateStepper() {
  const section = document.getElementById('process-section');
  if (!section || !progressEl) return;
  const rect = section.getBoundingClientRect();
  const windowH = window.innerHeight;
  const scrolled = Math.max(0, windowH * 0.5 - rect.top);
  const pct = Math.min(100, (scrolled / rect.height) * 100 * 1.4);
  progressEl.style.height = pct + '%';
  steps.forEach(step => {
    if (step.getBoundingClientRect().top < windowH * 0.65) step.classList.add('active');
  });
}
let stepTick = false;
window.addEventListener('scroll', () => {
  if (!stepTick) {
    stepTick = true;
    requestAnimationFrame(() => { updateStepper(); stepTick = false; });
  }
}, { passive: true });
updateStepper();

/* ════════════════════════════════════════
   BENEFIT CARDS REVEAL
════════════════════════════════════════ */
const cardObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const i = Array.from(e.target.parentElement.children).indexOf(e.target);
    e.target.style.transitionDelay = (i * 0.08) + 's';
    e.target.style.opacity = '1';
    e.target.style.transform = 'translateY(0)';
    cardObserver.unobserve(e.target);
  });
}, { threshold: 0.15 });

document.querySelectorAll('.card-wrap').forEach(c => {
  c.style.opacity = '0';
  c.style.transform = 'translateY(18px)';
  c.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  cardObserver.observe(c);
});

/* ════════════════════════════════════════
   I18N — EN / UR
════════════════════════════════════════ */
const I18N = {
  en: {
    "nav.platform": "Platform",
    "nav.partner": "Partner Now",
    "hero.badge": "Early Access · Sialkot",
    "hero.heading": "A supply chain for <em>Sialkot</em>, built for who's already there.",
    "hero.sub": "Nexora is the first digital ecosystem made for Sialkot's exporters and manufacturers — quiet, precise, and designed to be the layer your business runs on.",
    "stat.rfqs": "Active RFQs",
    "stat.units": "Verified Units",
    "stat.adopters": "Early Adopters",
    "stat.markets": "Export Markets",
    "adopters.text": "500+ early adopters and counting",
    "form.title": "Join the beta",
    "form.subtitle": "Secure your spot for early access.",
    "form.name": "Full name",
    "form.name.ph": "Enter your name",
    "form.company": "Company",
    "form.company.ph": "Company name",
    "form.role": "Role",
    "form.role.select": "Select role",
    "form.role.exporter": "Exporter",
    "form.role.manufacturer": "Manufacturer",
    "form.role.supplier": "Supplier",
    "form.role.logistics": "Logistics",
    "form.whatsapp": "WhatsApp",
    "form.email": "Email",
    "form.email.ph": "name@company.co",
    "form.submit": "Secure my spot",
    "form.err.name": "Please enter your name.",
    "form.err.company": "Please enter your company name.",
    "form.err.role": "Please select your role.",
    "form.err.whatsapp": "Please enter a valid WhatsApp number.",
    "form.err.email": "Please enter a valid email.",
    "form.success.title": "Salam — you're on the list.",
    "form.success.body": "We'll reach out via WhatsApp shortly.",
    "form.success.cta": "Got it",
    "bridge.left.title": "Export House",
    "bridge.left.body": "Connect directly with global buyers. List, negotiate and confirm orders on one platform.",
    "bridge.right.title": "Manufacturer",
    "bridge.right.body": "Showcase your production capacity, receive RFQs and build verified supply relationships.",
    "industries.label": "What Sialkot makes",
    "industries.heading": "Three industries. <em>One network.</em>",
    "industries.intro": "Sialkot's 250,000+ skilled hands produce 70% of the world's high-grade sports goods, half of its surgical instruments, and some of its finest leather. Nexora is the layer that connects the people behind those numbers.",
    "industries.cta.sports": "Explore the sports network",
    "industries.cta.surgical": "Explore the surgical network",
    "industries.cta.leather": "Explore the leather network",
    "industry.sports.tag": "Sports goods",
    "industry.sports.body": "Hand-stitched footballs, boxing gloves, cricket gear — Sialkot is the world's quiet capital of professional sports manufacturing.",
    "industry.surgical.tag": "Surgical instruments",
    "industry.surgical.body": "Forceps, scissors, orthopedic tools — CE-marked precision that ships to clinics and hospitals across 60+ markets.",
    "industry.leather.tag": "Leather & goods",
    "industry.leather.body": "Full-grain motorcycle gear, premium wallets, equestrian gloves — finished by craftspeople with decades on the bench.",
    "quote.body": "Sialkot's factories make the world's match-day footballs. Nexora makes the people who make them <em>visible</em>.",
    "quote.author": "Industry Brief, 2026",
    "quote.role": "Pakistan Bureau of Statistics",
    "benefits.label": "The advantage",
    "benefits.heading": "Benefits for early partners.",
    "benefit.1.title": "Priority verification",
    "benefit.1.body": "Skip the waitlist and get your business profile verified and visible to global partners instantly.",
    "benefit.2.title": "Zero fees",
    "benefit.2.body": "Six months of zero transaction or subscription fees on the platform.",
    "benefit.3.title": "Founding member status",
    "benefit.3.body": "Exclusive profile badge and early access to every beta feature before public release.",
    "process.label": "How it works",
    "process.heading": "From registration to first deal.",
    "process.intro": "Four steps to turn your Sialkot business into a globally connected operation. Each step is verified, tracked, and supported by the Nexora team.",
    "step.1.num": "Step 01",
    "step.1.title": "Create your profile",
    "step.1.body": "Register your export house or manufacturing unit. Our verification team reviews your documentation within 48 hours.",
    "step.2.num": "Step 02",
    "step.2.title": "List products & capacity",
    "step.2.body": "Upload your product catalogue with specifications, MOQs and production timelines. Buyers search and find you.",
    "step.3.num": "Step 03",
    "step.3.title": "Receive RFQs",
    "step.3.body": "Qualified buyers from 34+ markets send verified requests for quotation directly to your dashboard.",
    "step.4.num": "Step 04",
    "step.4.title": "Close the deal",
    "step.4.body": "Negotiate, confirm samples and finalize orders — all within Nexora's secure, traceable transaction layer.",
    "trusted.label": "Trusted by industry leaders",
    "footer.tagline": "Building the future of Sialkot, one connection at a time.",
    "footer.links.1": "Infrastructure",
    "footer.links.2": "Export Policy",
    "footer.links.3": "Privacy Protocol",
    "footer.copyright": "© 2026 Sialkot Industrial Platform. All rights reserved."
  },
  ur: {
    "nav.platform": "پلیٹ فارم",
    "nav.partner": "شراکت دار بنیں",
    "hero.badge": "ابتدائی رسائی · سیالکوٹ",
    "hero.heading": "<em>سیالکوٹ</em> کے لیے ایک سپلائی چین، انہی کے لیے جو پہلے سے یہاں ہیں۔",
    "hero.sub": "نیکسورا سیالکوٹ کے ایکسپورٹرز اور مینوفیکچررز کے لیے بنایا گیا پہلا ڈیجیٹل ایکوسسٹم ہے — خاموش، درست، اور آپ کے کاروبار کی بنیاد بننے کے لیے ڈیزائن کیا گیا۔",
    "stat.rfqs": "فعال RFQs",
    "stat.units": "تصدیق شدہ یونٹس",
    "stat.adopters": "ابتدائی صارفین",
    "stat.markets": "ایکسپورٹ مارکیٹس",
    "adopters.text": "500+ ابتدائی صارفین، اور بڑھ رہے ہیں",
    "form.title": "بیٹا میں شامل ہوں",
    "form.subtitle": "ابتدائی رسائی کے لیے اپنی جگہ محفوظ کریں۔",
    "form.name": "پورا نام",
    "form.name.ph": "اپنا نام درج کریں",
    "form.company": "کمپنی",
    "form.company.ph": "کمپنی کا نام",
    "form.role": "کردار",
    "form.role.select": "کردار منتخب کریں",
    "form.role.exporter": "ایکسپورٹر",
    "form.role.manufacturer": "مینوفیکچرر",
    "form.role.supplier": "سپلائر",
    "form.role.logistics": "لاجسٹکس",
    "form.whatsapp": "واٹس ایپ",
    "form.email": "ای میل",
    "form.email.ph": "name@company.co",
    "form.submit": "میری جگہ محفوظ کریں",
    "form.err.name": "براہ کرم اپنا نام درج کریں۔",
    "form.err.company": "براہ کرم اپنی کمپنی کا نام درج کریں۔",
    "form.err.role": "براہ کرم اپنا کردار منتخب کریں۔",
    "form.err.whatsapp": "براہ کرم درست واٹس ایپ نمبر درج کریں۔",
    "form.err.email": "براہ کرم درست ای میل درج کریں۔",
    "form.success.title": "السلام علیکم — آپ فہرست میں شامل ہیں۔",
    "form.success.body": "ہم جلد ہی واٹس ایپ پر آپ سے رابطہ کریں گے۔",
    "form.success.cta": "ٹھیک ہے",
    "bridge.left.title": "ایکسپورٹ ہاؤس",
    "bridge.left.body": "عالمی خریداروں سے براہ راست رابطہ کریں۔",
    "bridge.right.title": "مینوفیکچرر",
    "bridge.right.body": "اپنی پیداواری صلاحیت دکھائیں اور تصدیق شدہ سپلائی تعلقات بنائیں۔",
    "industries.label": "سیالکوٹ کیا بناتا ہے",
    "industries.heading": "تین صنعتیں۔ <em>ایک نیٹ ورک۔</em>",
    "industries.intro": "سیالکوٹ کے 250,000+ ہنرمند ہاتھ دنیا کی 70% اعلیٰ معیار کی کھیلوں کی اشیاء، اس کے نصف سرجیکل آلات، اور بہترین چمڑے کی پیداوار کرتے ہیں۔ نیکسورا وہ تہہ ہے جو ان اعداد و شمار کے پیچھے موجود لوگوں کو جوڑتی ہے۔",
    "industries.cta.sports": "اسپورٹس نیٹ ورک دیکھیں",
    "industries.cta.surgical": "سرجیکل نیٹ ورک دیکھیں",
    "industries.cta.leather": "لیدر نیٹ ورک دیکھیں",
    "industry.sports.tag": "اسپورٹس گڈز",
    "industry.sports.body": "ہاتھ سے سلے ہوئے فٹبال، باکسنگ گلوز، کرکٹ کے سامان — سیالکوٹ دنیا کا خاموش دارالحکومت ہے۔",
    "industry.surgical.tag": "سرجیکل آلات",
    "industry.surgical.body": "فورسپس، قینچی، آرتھوپیڈک ٹولز — CE-تصدیق شدہ درستگی جو 60+ مارکیٹس میں جاتی ہے۔",
    "industry.leather.tag": "چمڑا اور سامان",
    "industry.leather.body": "موٹرسائیکل گیئر، پریمیم والٹس، گھڑ سواری کے دستانے — دہائیوں کے تجربے کے ساتھ کاریگری۔",
    "quote.body": "سیالکوٹ کے کارخانے دنیا کے میچ ڈے فٹبال بناتے ہیں۔ نیکسورا انہیں بنانے والوں کو <em>نمایاں</em> کرتا ہے۔",
    "quote.author": "صنعتی بریف، 2026",
    "quote.role": "پاکستان بیورو آف اسٹیٹسٹکس",
    "benefits.label": "فائدہ",
    "benefits.heading": "ابتدائی شراکت داروں کے لیے فوائد۔",
    "benefit.1.title": "ترجیحی تصدیق",
    "benefit.1.body": "ویٹ لسٹ چھوڑیں اور فوری طور پر تصدیق شدہ پروفائل حاصل کریں۔",
    "benefit.2.title": "صفر فیس",
    "benefit.2.body": "چھ ماہ تک بالکل صفر ٹرانزیکشن یا سبسکرپشن فیس۔",
    "benefit.3.title": "بانی ممبر کا درجہ",
    "benefit.3.body": "خصوصی پروفائل بیج اور تمام بیٹا فیچرز تک ابتدائی رسائی۔",
    "process.label": "یہ کیسے کام کرتا ہے",
    "process.heading": "رجسٹریشن سے پہلے سودے تک۔",
    "process.intro": "چار قدموں میں اپنے سیالکوٹ کے کاروبار کو عالمی طور پر منسلک آپریشن میں تبدیل کریں۔",
    "step.1.num": "قدم 01",
    "step.1.title": "اپنا پروفائل بنائیں",
    "step.1.body": "اپنا ایکسپورٹ ہاؤس یا مینوفیکچرنگ یونٹ رجسٹر کریں۔",
    "step.2.num": "قدم 02",
    "step.2.title": "مصنوعات اور صلاحیت درج کریں",
    "step.2.body": "اپنی مصنوعات کی کیٹلاگ اپ لوڈ کریں۔",
    "step.3.num": "قدم 03",
    "step.3.title": "RFQs وصول کریں",
    "step.3.body": "34+ مارکیٹوں کے تصدیق شدہ خریدار براہ راست درخواستیں بھیجتے ہیں۔",
    "step.4.num": "قدم 04",
    "step.4.title": "سودا مکمل کریں",
    "step.4.body": "محفوظ، قابل ٹریس ٹرانزیکشن لیئر کے اندر آرڈرز مکمل کریں۔",
    "trusted.label": "صنعت کے رہنماؤں کا اعتماد",
    "footer.tagline": "سیالکوٹ کا مستقبل، ایک کنکشن کے ساتھ، تعمیر کر رہے ہیں۔",
    "footer.links.1": "انفراسٹرکچر",
    "footer.links.2": "ایکسپورٹ پالیسی",
    "footer.links.3": "پرائیویسی پروٹوکول",
    "footer.copyright": "© 2026 سیالکوٹ انڈسٹریل پلیٹ فارم۔ جملہ حقوق محفوظ ہیں۔"
  }
};

function applyLanguage(lang) {
  const dict = I18N[lang] || I18N.en;
  document.documentElement.lang = lang;
  document.documentElement.dir  = (lang === 'ur') ? 'rtl' : 'ltr';

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = dict[key];
    if (val == null) return;
    const attr = el.getAttribute('data-i18n-attr');
    if (attr) el.setAttribute(attr, val);
    else if (el.getAttribute('data-i18n-html') === 'true') el.innerHTML = val;
    else el.textContent = val;
  });
  document.querySelectorAll('.lang-btn').forEach(b => {
    const isActive = b.dataset.lang === lang;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  try { localStorage.setItem('nexora-lang', lang); } catch (_) {}
  updateWhatsAppLink();
}

document.querySelectorAll('.lang-btn').forEach(b => {
  b.addEventListener('click', () => applyLanguage(b.dataset.lang));
});
(function initLang() {
  let saved = 'en';
  try { saved = localStorage.getItem('nexora-lang') || 'en'; } catch (_) {}
  if (saved !== 'en') applyLanguage(saved);
})();

/* ════════════════════════════════════════
   WHATSAPP FAB
════════════════════════════════════════ */
const WA_NUMBER = '923000000000';
function updateWhatsAppLink() {
  const fab = document.getElementById('fab-whatsapp');
  if (!fab) return;
  const roleSel = document.getElementById('f-role');
  const role = (roleSel && roleSel.value) || 'Exporter/Manufacturer';
  const lang = document.documentElement.lang || 'en';
  const msg = (lang === 'ur')
    ? `السلام علیکم نیکسورا، میں سیالکوٹ سے ${role === 'Exporter/Manufacturer' ? 'ایکسپورٹر/مینوفیکچرر' : role} ہوں اور میں ویٹ لسٹ میں شامل ہونا چاہتا ہوں۔`
    : `Salam Nexora, I am an ${role} from Sialkot and I want to join the waitlist.`;
  fab.href = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`;
}
const fRole = document.getElementById('f-role');
if (fRole) fRole.addEventListener('change', updateWhatsAppLink);
updateWhatsAppLink();

/* ════════════════════════════════════════
   LEAD FORM
════════════════════════════════════════ */
const form         = document.getElementById('lead-capture');
const submitBtn    = document.getElementById('submit-btn');
const overlay      = document.getElementById('success-overlay');
const overlayClose = document.getElementById('success-close');

function validate() {
  const fields = form.querySelectorAll('input[required], select[required]');
  let ok = true;
  let firstInvalid = null;
  fields.forEach(f => {
    const wrap = f.closest('.field');
    let bad = false;
    if (!f.value || !f.value.trim()) bad = true;
    if (!bad && f.type === 'email') bad = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value.trim());
    if (!bad && f.type === 'tel')   bad = !/^[\d\s+\-()]{7,}$/.test(f.value.trim());
    wrap.classList.toggle('invalid', bad);
    if (bad) { ok = false; if (!firstInvalid) firstInvalid = f; }
  });
  if (firstInvalid) firstInvalid.focus({ preventScroll: false });
  return ok;
}

if (form) {
  form.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('input',  () => el.closest('.field').classList.remove('invalid'));
    el.addEventListener('change', () => el.closest('.field').classList.remove('invalid'));
  });

  async function submitLead(payload) {
    if (window.NEXORA_SUBMIT) return window.NEXORA_SUBMIT(payload);
    await new Promise(r => setTimeout(r, 1100));
    console.log('[nexora] lead captured (stub):', payload);
    return { ok: true };
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate()) return;
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    const payload = {
      name:     form.name.value.trim(),
      company:  form.company.value.trim(),
      role:     form.role.value,
      whatsapp: form.whatsapp.value.trim(),
      email:    form.email.value.trim(),
      lang:     document.documentElement.lang || 'en',
      ts:       new Date().toISOString()
    };
    try {
      await submitLead(payload);
      overlay.classList.add('show');
      form.reset();
      updateWhatsAppLink();
    } catch (err) {
      console.error('[nexora] submit failed:', err);
      alert((document.documentElement.lang === 'ur')
        ? 'معاف کیجیے، کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔'
        : 'Sorry — something went wrong. Please try again.');
    } finally {
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
    }
  });

  overlayClose.addEventListener('click', () => overlay.classList.remove('show'));
}

/* "Partner Now" → scroll to form */
document.querySelectorAll('[data-scroll-to]').forEach(btn => {
  btn.addEventListener('click', e => {
    const id = btn.getAttribute('data-scroll-to');
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const first = target.querySelector('input, select');
    if (first && !IS_TOUCH) setTimeout(() => first.focus(), 600);
  });
});

/* Mobile keyboard guard */
if (IS_TOUCH && form) {
  form.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('focus', () => {
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
    });
  });
  if ('visualViewport' in window) {
    window.visualViewport.addEventListener('resize', () => {
      const active = document.activeElement;
      if (active && form.contains(active)) {
        active.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
}
