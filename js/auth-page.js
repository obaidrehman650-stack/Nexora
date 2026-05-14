/* ════════════════════════════════════════
   NEXORA — Auth page wiring
   Slides between Log in ⇄ Sign up,
   role chooser (Manufacturer/Exporter),
   manufacturer 3-step "Audit Flow" wizard,
   live password strength,
   sanitized submission via NexoraAuth.
═══════════════════════════════════════════ */
(function () {
  const Auth = window.NexoraAuth;
  if (!Auth) { console.error('NexoraAuth missing'); return; }

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ── Tabs + slide track ───────────────────── */
  const tabs   = $('.auth-tabs');
  const track  = $('.auth-track');
  const cardWrap = $('.auth-card-wrap');

  function setView(name, animate = true) {
    tabs.dataset.active = name;
    track.dataset.view  = name;
    $$('.auth-tabs button').forEach(b => {
      const active = b.dataset.tab === name;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.auth-view').forEach(v => {
      const active = v.dataset.view === name;
      v.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
    /* Slide track via GSAP if available; fallback to CSS transform */
    const target = name === 'signup' ? '-50%' : '0%';
    if (animate && window.gsap) {
      gsap.to(track, {
        xPercent: name === 'signup' ? -50 : 0,
        duration: 0.7,
        ease: 'power3.inOut'
      });
    } else {
      track.style.transition = animate ? 'transform 0.45s cubic-bezier(0.65, 0, 0.35, 1)' : 'none';
      track.style.transform = `translateX(${target})`;
    }
    /* Move focus to the first input in the new view for accessibility */
    if (animate) {
      setTimeout(() => {
        const v = $(`.auth-view[data-view="${name}"]`);
        const first = v && v.querySelector('input, button.role-card');
        first && first.focus({ preventScroll: true });
      }, 350);
    }
  }

  $$('.auth-tabs button').forEach(b => b.addEventListener('click', () => setView(b.dataset.tab)));
  $$('[data-go]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    setView(a.dataset.go);
  }));

  // Initial state — honor ?tab=signup from the landing page CTA
  const initialTab = (new URLSearchParams(location.search).get('tab') === 'signup') ? 'signup' : 'login';
  if (window.gsap) gsap.set(track, { xPercent: initialTab === 'signup' ? -50 : 0 });
  if (initialTab === 'signup') setView('signup', false);

  /* ── Already signed in? Send them to their dashboard ───── */
  Auth.getCurrentUser().then(me => {
    if (me && me.profile) {
      Auth.toast(`Already signed in as ${me.profile.full_name || me.user.email}. Redirecting…`, 'info');
      setTimeout(() => Auth.redirectForRole(me.profile.role), 900);
    }
  }).catch(() => {});

  /* ════════════════════════════════════════
     LOGIN form
  ════════════════════════════════════════ */
  const loginForm = $('#login-form');
  const loginBtn  = $('#login-submit');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#li-email');
    const pass  = $('#li-pass');
    clearFieldErrors(loginForm);
    let bad = false;
    if (!email.value.trim() || !/^\S+@\S+\.\S+$/.test(email.value)) { fieldInvalid(email); bad = true; }
    if (!pass.value)  { fieldInvalid(pass);  bad = true; }
    if (bad) return;

    setLoading(loginBtn, true);
    try {
      const { profile } = await Auth.signIn(email.value, pass.value);
      Auth.toast(`Welcome back, ${profile?.full_name?.split(' ')[0] || 'there'}.`, 'success');
      setTimeout(() => Auth.redirectForRole(profile?.role || 'manufacturer'), 700);
    } catch (err) {
      console.warn('[login] failed:', err);
      const msg = humanizeError(err);
      Auth.toast(msg, 'error');
      if (/credential|password|invalid/i.test(msg)) {
        fieldInvalid(pass);
      }
    } finally {
      setLoading(loginBtn, false);
    }
  });

  $('#forgot-link').addEventListener('click', (e) => {
    e.preventDefault();
    const email = $('#li-email').value.trim();
    if (!email) {
      Auth.toast('Enter your email above first, then tap "Reset" again.', 'warn');
      $('#li-email').focus();
      return;
    }
    /* Supabase send-password-reset would go here. For now: queue a toast. */
    Auth.toast(`If an account exists for ${email}, a reset link is on its way.`, 'info');
  });

  /* ════════════════════════════════════════
     SIGNUP — role chooser
  ════════════════════════════════════════ */
  const roleCards = $$('.role-card');
  const fMfg = $('#signup-manufacturer');
  const fExp = $('#signup-exporter');

  function setRole(role) {
    roleCards.forEach(c => {
      const active = c.dataset.role === role;
      c.classList.toggle('is-active', active);
      c.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    if (role === 'manufacturer') {
      fMfg.style.display = '';
      fExp.style.display = 'none';
    } else {
      fMfg.style.display = 'none';
      fExp.style.display = '';
    }
  }
  roleCards.forEach(c => c.addEventListener('click', () => setRole(c.dataset.role)));

  /* ════════════════════════════════════════
     SIGNUP — Manufacturer wizard (3 steps)
  ════════════════════════════════════════ */
  const wizard = fMfg;
  const wizPanels   = $$('.wizard-panel', wizard);
  const wizProgress = $$('.wizard-progress-step', wizard);

  function gotoStep(n) {
    /* Validate the current step before moving forward */
    const current = wizPanels.findIndex(p => p.classList.contains('is-active')) + 1;
    if (n > current) {
      if (!validateWizardStep(current)) return;
    }
    /* Update progress chips */
    wizProgress.forEach(s => {
      const sn = +s.dataset.step;
      s.classList.toggle('is-active', sn === n);
      s.classList.toggle('is-done', sn < n);
    });
    /* Slide panels */
    const from = wizPanels[current - 1];
    const to   = wizPanels[n - 1];
    if (!to || from === to) return;
    const forward = n > current;
    to.classList.add('is-active');
    if (window.gsap) {
      gsap.fromTo(to,
        { xPercent: forward ? 28 : -28, opacity: 0 },
        { xPercent: 0,                  opacity: 1, duration: 0.45, ease: 'power3.out' });
      gsap.to(from, {
        xPercent: forward ? -28 : 28,
        opacity: 0,
        duration: 0.32,
        ease: 'power2.in',
        onComplete: () => {
          from.classList.remove('is-active');
          from.style.cssText = '';
          to.style.cssText = '';
        }
      });
    } else {
      from.classList.remove('is-active');
    }
    /* Focus the first field of the new panel */
    setTimeout(() => {
      const first = to.querySelector('input, button.industry-tile');
      first && first.focus({ preventScroll: true });
    }, 250);
  }

  $$('[data-wizard-next]', wizard).forEach(b => b.addEventListener('click', () => gotoStep(+b.dataset.wizardNext)));
  $$('[data-wizard-prev]', wizard).forEach(b => b.addEventListener('click', () => gotoStep(+b.dataset.wizardPrev)));

  function validateWizardStep(step) {
    clearFieldErrors(wizard);
    if (step === 1) {
      const name = $('#mf-name'), email = $('#mf-email'), pass = $('#mf-pass');
      let ok = true;
      if (!name.value.trim()) { fieldInvalid(name); ok = false; }
      if (!/^\S+@\S+\.\S+$/.test(email.value)) { fieldInvalid(email); ok = false; }
      const strength = Auth.passwordStrength(pass.value);
      if (!strength.ok) {
        fieldInvalid(pass);
        const errEl = pass.parentElement.querySelector('.field-error');
        if (errEl) errEl.textContent = strength.reasons[0] || 'Password is too weak.';
        ok = false;
      }
      return ok;
    }
    if (step === 2) {
      const company = $('#mf-company'), location = $('#mf-location'), scci = $('#mf-scci');
      let ok = true;
      if (!company.value.trim()) { fieldInvalid(company); ok = false; }
      if (!location.value.trim()) { fieldInvalid(location); ok = false; }
      if (!scci.value.trim() || scci.value.trim().length < 3) { fieldInvalid(scci); ok = false; }
      return ok;
    }
    return true;
  }

  /* Industry tile picker */
  const industryTiles = $$('.industry-tile', wizard);
  const industryHidden = $('#mf-industry');
  industryTiles.forEach(t => {
    t.addEventListener('click', () => {
      industryTiles.forEach(x => {
        const active = x === t;
        x.classList.toggle('is-active', active);
        x.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      industryHidden.value = t.dataset.industry;
      $('#mf-industry-error').style.display = 'none';
    });
  });

  /* Live password strength */
  hookPasswordMeter('#mf-pass');
  hookPasswordMeter('#ex-pass');

  function hookPasswordMeter(sel) {
    const input = $(sel);
    if (!input) return;
    const meter = input.parentElement.querySelector('.pw-meter');
    const label = input.parentElement.querySelector('.pw-meter-label strong');
    input.addEventListener('input', () => {
      const s = Auth.passwordStrength(input.value);
      if (meter) meter.dataset.score = String(s.score);
      if (label) label.textContent = input.value ? s.label : '—';
    });
  }

  /* ────────────────────────────────────────
     Manufacturer SUBMIT (step 3)
  ──────────────────────────────────────── */
  wizard.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!industryHidden.value) {
      $('#mf-industry-error').style.display = 'block';
      return;
    }
    /* Re-validate prior steps in case the user tampered */
    if (!validateWizardStep(1)) { gotoStep(1); return; }
    if (!validateWizardStep(2)) { gotoStep(2); return; }

    const btn = $('#mf-submit');
    setLoading(btn, true);

    const payload = {
      role: 'manufacturer',
      full_name: $('#mf-name').value,
      company:   $('#mf-company').value,
      location:  $('#mf-location').value,
      scci_number: $('#mf-scci').value,
      industry:  industryHidden.value
    };
    try {
      const { profile } = await Auth.signUp($('#mf-email').value, $('#mf-pass').value, payload);
      Auth.sendWelcomeEmail(profile || { ...payload, email: $('#mf-email').value });
      Auth.toast(`Salam ${payload.full_name.split(' ')[0]} — application received. We'll verify your SCCI credentials shortly.`, 'success', { timeout: 8000 });
      /* Manufacturers go to the leads feed once authenticated */
      setTimeout(() => Auth.redirectForRole('manufacturer'), 1400);
    } catch (err) {
      console.warn('[signup mfg] failed:', err);
      Auth.toast(humanizeError(err), 'error');
      setLoading(btn, false);
    }
  });

  /* ────────────────────────────────────────
     Exporter SUBMIT (1-step)
  ──────────────────────────────────────── */
  fExp.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors(fExp);
    const name    = $('#ex-name');
    const company = $('#ex-company');
    const email   = $('#ex-email');
    const country = $('#ex-country');
    const pass    = $('#ex-pass');
    let ok = true;
    if (!name.value.trim())    { fieldInvalid(name);    ok = false; }
    if (!company.value.trim()) { fieldInvalid(company); ok = false; }
    if (!/^\S+@\S+\.\S+$/.test(email.value)) { fieldInvalid(email); ok = false; }
    if (!country.value.trim()) { fieldInvalid(country); ok = false; }
    const strength = Auth.passwordStrength(pass.value);
    if (!strength.ok) {
      fieldInvalid(pass);
      const errEl = pass.parentElement.querySelector('.field-error');
      if (errEl) errEl.textContent = strength.reasons[0] || 'Password is too weak.';
      ok = false;
    }
    if (!ok) return;

    const btn = $('#ex-submit');
    setLoading(btn, true);
    try {
      await Auth.signUp(email.value, pass.value, {
        role: 'exporter',
        full_name: name.value,
        company:   company.value,
        location:  country.value
      });
      Auth.toast(`Welcome aboard, ${name.value.split(' ')[0]}. Your exporter portal is ready.`, 'success');
      setTimeout(() => Auth.redirectForRole('exporter'), 900);
    } catch (err) {
      console.warn('[signup exp] failed:', err);
      Auth.toast(humanizeError(err), 'error');
      setLoading(btn, false);
    }
  });

  /* ════════════════════════════════════════
     SMALL HELPERS
  ════════════════════════════════════════ */
  function setLoading(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-loading', !!on);
    btn.disabled = !!on;
  }
  function clearFieldErrors(scope) {
    $$('.field.invalid', scope).forEach(f => f.classList.remove('invalid'));
  }
  function fieldInvalid(input) {
    const field = input.closest('.field');
    if (field) field.classList.add('invalid');
  }
  function humanizeError(err) {
    if (!err) return 'Something went wrong. Please try again.';
    const code = err.code || err.name || '';
    const msg  = err.message || String(err);
    if (/already exists|user_already/i.test(code) || /already registered/i.test(msg))
      return 'An account with that email already exists. Try logging in instead.';
    if (/email/i.test(code) && /not.*confirmed/i.test(msg))
      return 'Your account is awaiting email confirmation. Check your inbox.';
    if (/invalid|credential|password/i.test(code) || /invalid login/i.test(msg))
      return 'Invalid email or password. Please try again.';
    if (/under.*verif|pending|not.*verified/i.test(msg))
      return 'Account under verification — we will be in touch shortly.';
    if (/network|fetch/i.test(msg))
      return 'Network hiccup. Check your connection and try again.';
    return msg.charAt(0).toUpperCase() + msg.slice(1);
  }

  /* Demo-mode banner once on first paint */
  if (Auth.demoMode) {
    setTimeout(() => Auth.toast(
      'Running in demo mode (no Supabase configured). Accounts are stored in this browser only.',
      'warn',
      { timeout: 7000 }
    ), 400);
  }
})();
