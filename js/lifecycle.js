/* ════════════════════════════════════════
   NEXORA — Industrial Lifecycle (Signature Transitions)
   Surgical ➜ Sports ➜ Leather
   Scroll-pinned GSAP timeline.
   Phases (timeline-time → scroll-time):
     0.0–1.0  Surgical hold + intro
     1.0–3.0  Transition A: scissor cut, halves peel apart
     3.0–4.0  Sports hold
     4.0–6.0  Transition B: ball kick, impact, shatter
     6.0–7.5  Leather reveal + hold
═════════════════════════════════════════ */
(function () {
  const root = document.querySelector('.lifecycle');
  if (!root) return;

  // Respect reduced motion: render static fallback
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('is-reduced');
    return;
  }
  if (!window.gsap || !window.ScrollTrigger) {
    console.warn('GSAP missing — lifecycle transitions disabled');
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  const pin       = root.querySelector('.lc-pin');
  const scissor   = root.querySelector('.lc-actor--scissor');
  const ball      = root.querySelector('.lc-actor--ball');
  const cutline   = root.querySelector('.lc-cutline');
  const spark     = root.querySelector('.lc-spark');
  const halfTop   = root.querySelector('.lc-half--top');
  const halfBot   = root.querySelector('.lc-half--bottom');
  const stageSurg = root.querySelector('.lc-stage--surgical');
  const stageSport= root.querySelector('.lc-stage--sports');
  const stageLeath= root.querySelector('.lc-stage--leather');
  const ripples   = root.querySelectorAll('.lc-ripple');
  const shards    = root.querySelectorAll('.lc-shard');
  const steps     = root.querySelectorAll('.lc-step');
  const capName   = root.querySelector('.lc-caption-name');

  /* ── Set initial state ─────────────────────────── */
  gsap.set(scissor,  { xPercent: 80, yPercent: 0, scale: 1.0, rotate: 0, opacity: 0 });
  gsap.set(ball,     { xPercent: 30, yPercent: 35,  scale: 0.18, rotate: 0,   opacity: 0 });
  gsap.set(cutline,  { scaleX: 0, transformOrigin: 'right center' });
  gsap.set(spark,    { opacity: 0, xPercent: 80, yPercent: 0 });
  gsap.set(stageSport,  { opacity: 1 });
  gsap.set(stageLeath,  { opacity: 1 });
  gsap.set(halfTop,     { yPercent: 0, rotation: 0 });
  gsap.set(halfBot,     { yPercent: 0, rotation: 0 });
  gsap.set(ripples,     { opacity: 0, scale: 0 });
  gsap.set(shards,      { opacity: 0, scale: 0.3, rotate: 0, xPercent: 0, yPercent: 0 });

  // Chapter caption copy keyed to each phase
  const captions = {
    surgical: 'Sialkot Forge · Mosquito forceps · AISI 410',
    cut:      'Precision cut · #10 surgical scalpel',
    sports:   'Hand-stitched football · Size 5',
    kick:     'Match-day ball · 32-panel hex/pent',
    leather:  'Full-grain hide · Vegetable-tanned',
  };
  function setCaption(key) {
    if (!capName || capName.dataset.k === key) return;
    capName.dataset.k = key;
    capName.style.opacity = '0';
    requestAnimationFrame(() => {
      capName.textContent = captions[key];
      capName.style.transition = 'opacity 0.35s ease';
      capName.style.opacity = '1';
    });
  }
  function setStep(name) {
    steps.forEach(el => el.classList.toggle('is-active', el.dataset.stage === name));
  }

  /* ── Master timeline (scrubbed by scroll) ─────── */
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: root,
      start: 'top top',
      end: '+=520%',
      scrub: 0.6,
      pin: pin,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    }
  });

  /* ────────── PHASE 1: Surgical hold (0 → 1) ────────── */
  tl.addLabel('surgical', 0)
    .call(() => { setStep('surgical'); setCaption('surgical'); }, null, 0)
    .to({}, { duration: 1 }, 0); // dwell

  /* ────────── PHASE 2: Transition A — Precision Cut (1 → 3) ──────────
     Scissor enters from far right at upper-right angle, travels
     across to far left, rotating slightly. As it travels, the
     cutline strokes left (right→left). After it passes, the
     two halves peel apart vertically. */
  tl.addLabel('cut', 1)
    .call(() => { setCaption('cut'); }, null, 1)
    // Scalpel enters from far right at midline
    .fromTo(scissor,
      { xPercent: 80,  yPercent: 0, scale: 1.0, rotate: 0, opacity: 0 },
      { xPercent: 40,  yPercent: 0, scale: 1.0, rotate: 0, opacity: 1, duration: 0.35 }, 1)
    // Spark appears at blade tip and follows along
    .fromTo(spark,
      { xPercent: 80, yPercent: 0, opacity: 0, scale: 0.4 },
      { xPercent: 40, yPercent: 0, opacity: 0.9, scale: 1, duration: 0.35 }, 1)
    // Scalpel traverses horizontally right→left, blade tip leading
    .to(scissor,
      { xPercent: -60, yPercent: 0, rotate: 0, duration: 1.0 }, 1.35)
    .to(spark,
      { xPercent: -60, yPercent: 0, duration: 1.0 }, 1.35)
    // Cutline strokes right→left, finishing as the scalpel exits
    .to(cutline,
      { scaleX: 1, duration: 1.0 }, 1.35)
    // Halves peel apart — slight tilt for organic motion
    .to(halfTop, { yPercent: -55, rotation: -1.4, duration: 0.9 }, 1.9)
    .to(halfBot, { yPercent:  55, rotation:  1.4, duration: 0.9 }, 1.9)
    // Cutline dissolves once halves have parted
    .to(cutline, { opacity: 0, duration: 0.4 }, 2.5)
    // Scalpel exits with a small flourish
    .to(scissor,
      { xPercent: -110, yPercent: 0, rotate: 0, opacity: 0, duration: 0.4 }, 2.5)
    .to(spark, { opacity: 0, duration: 0.3 }, 2.5);

  /* ────────── PHASE 3: Sports hold (3 → 4) ────────── */
  tl.addLabel('sports', 3)
    .call(() => { setStep('sports'); setCaption('sports'); }, null, 3)
    .to({}, { duration: 1 }, 3);

  /* ────────── PHASE 4: Transition B — Kinetic Kick (4 → 6) ──────────
     Ball enters from the lower-right of the frame (as if punted
     from off-screen), spins rapidly, scales up dramatically as
     it approaches the camera, then "impacts" the screen.
     On impact: rapid scale + opacity blow-out, ripple rings,
     shatter shards fly outward, sports stage fades to reveal leather. */
  tl.addLabel('kick', 4)
    .call(() => { setCaption('kick'); }, null, 4)
    // Ball enters
    .fromTo(ball,
      { xPercent: 30, yPercent: 35, scale: 0.18, rotate: 0, opacity: 0 },
      { xPercent: 0,  yPercent: 0,  scale: 0.55, rotate: 240, opacity: 1, duration: 0.6 }, 4)
    // Approach: scales up quickly, more spin (camera approach)
    .to(ball,
      { xPercent: 0, yPercent: 0, scale: 2.2, rotate: 540, duration: 0.55, ease: 'power2.in' }, 4.6)
    // Impact: blow-out
    .to(ball,
      { scale: 6.5, rotate: 720, opacity: 0, duration: 0.20, ease: 'power3.in' }, 5.15)
    // Ripple rings burst outward (staggered)
    .fromTo(ripples,
      { scale: 0.1, opacity: 0.9 },
      { scale: 7.2, opacity: 0, duration: 0.55, stagger: 0.07, ease: 'power2.out' }, 5.15)
    // Shatter shards fly outward in radial directions
    .to(shards, {
      opacity: 1, duration: 0.05,
    }, 5.18)
    .to(shards, {
      duration: 0.65,
      ease: 'power2.out',
      xPercent: (i) => Math.cos((i / shards.length) * Math.PI * 2 - Math.PI/2) * 320,
      yPercent: (i) => Math.sin((i / shards.length) * Math.PI * 2 - Math.PI/2) * 320,
      rotate:   (i) => (i % 2 === 0 ? 180 : -180) + (i * 12),
      scale: 1.2,
    }, 5.20)
    .to(shards, { opacity: 0, duration: 0.4 }, 5.55)
    // Sports stage dissolves to reveal leather underneath
    .to(stageSport, { opacity: 0, duration: 0.55, ease: 'power2.out' }, 5.20);

  /* ────────── PHASE 5: Leather reveal + hold (6 → 7.5) ────────── */
  tl.addLabel('leather', 6)
    .call(() => { setStep('leather'); setCaption('leather'); }, null, 6)
    .to({}, { duration: 1.5 }, 6);

  /* ── Hard checkpoints when scrubbing backwards ───
     setStep / setCaption are .call() events; gsap also calls
     them on reverse-scrub so the chapter rail stays in sync. */

  // Re-measure on font load (Fraunces is variable + large)
  document.fonts && document.fonts.ready && document.fonts.ready.then(() => {
    ScrollTrigger.refresh();
  });

  // Pre-warm: jump to t=0 once everything is set
  ScrollTrigger.refresh();
})();
