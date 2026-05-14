/* ════════════════════════════════════════
   NEXORA — Auth core
   ──────────────────────────────────────────
   Thin Supabase wrapper + RBAC helpers + the
   "Nexora Guard" route protection + sanitization
   + paper-style toast notifications.

   Public API on window.NexoraAuth:
     • signUp(email, password, profile)
     • signIn(email, password)
     • signOut()
     • getSession()
     • getCurrentUser()
     • requireAuth(allowedRoles?)
     • requireRole(role)
     • passwordStrength(pw)
     • sanitize(input)
     • sanitizeAlpha(input)        // for SCCI numbers etc.
     • toast(message, type?)
     • redirectForRole(role)
═══════════════════════════════════════════ */
(function () {
  const CFG = window.NEXORA_CONFIG || {};
  const REDIRECTS = CFG.REDIRECTS || {};
  const LOGIN_URL = CFG.LOGIN_URL || 'auth.html';

  /* ── Supabase client (lazy) ─────────────────────── */
  let _supabase = null;
  let _demoMode = false;

  function getSupabase() {
    if (_supabase !== null) return _supabase;

    const usable =
      CFG.SUPABASE_URL &&
      CFG.SUPABASE_ANON_KEY &&
      !/^YOUR-/.test(CFG.SUPABASE_URL) &&
      !/^YOUR-/.test(CFG.SUPABASE_ANON_KEY) &&
      typeof window.supabase !== 'undefined';

    if (!usable) {
      if (!CFG.ALLOW_DEMO_MODE) {
        console.error('[Nexora Auth] Supabase not configured and demo mode disabled.');
        _supabase = false;
        return false;
      }
      _demoMode = true;
      _supabase = false;
      console.info('[Nexora Auth] Running in demo mode (localStorage-backed). Wire up Supabase in js/config.js to go live.');
      return false;
    }

    _supabase = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        storageKey: 'nexora-auth-session',
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return _supabase;
  }

  /* ── Demo-mode store (localStorage) ─────────────── */
  const DEMO_USERS_KEY   = 'nexora-demo-users';
  const DEMO_SESSION_KEY = 'nexora-demo-session';

  function demoUsers()       { try { return JSON.parse(localStorage.getItem(DEMO_USERS_KEY)   || '[]'); } catch { return []; } }
  function saveDemoUsers(u)  { localStorage.setItem(DEMO_USERS_KEY,   JSON.stringify(u)); }
  function demoSession()     { try { return JSON.parse(localStorage.getItem(DEMO_SESSION_KEY) || 'null'); } catch { return null; } }
  function saveDemoSession(s){ s ? localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(DEMO_SESSION_KEY); }

  /* Simple non-cryptographic hash (demo only — real users go through Supabase). */
  function fakeHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
    return 'h' + (h >>> 0).toString(16);
  }

  /* ════════════════════════════════════════
     SANITIZATION
  ════════════════════════════════════════ */
  function sanitize(s) {
    if (s == null) return '';
    return String(s)
      .trim()
      .replace(/<[^>]*>/g, '')       // strip any HTML tags
      .replace(/[\u0000-\u001F]/g, '') // strip control chars
      .slice(0, 500);                // hard cap to prevent abuse
  }
  function sanitizeAlpha(s) {
    return sanitize(s).replace(/[^A-Z0-9\- ]/gi, '').toUpperCase();
  }
  function sanitizeEmail(s) {
    return sanitize(s).toLowerCase().replace(/\s+/g, '');
  }

  /* ════════════════════════════════════════
     PASSWORD STRENGTH
     Returns { score: 0–4, label, ok, reasons[] }
     ok ⇔ score ≥ 3 AND length ≥ 8 (high-entropy minimum).
  ════════════════════════════════════════ */
  function passwordStrength(pw) {
    pw = pw || '';
    const reasons = [];
    if (pw.length < 8) reasons.push('At least 8 characters');
    const hasLower = /[a-z]/.test(pw);
    const hasUpper = /[A-Z]/.test(pw);
    const hasDigit = /\d/.test(pw);
    const hasSym   = /[^A-Za-z0-9]/.test(pw);
    const variety = hasLower + hasUpper + hasDigit + hasSym;
    if (variety < 3) reasons.push('Mix uppercase, lowercase, numbers, and symbols');

    /* Entropy estimate: log2(charset^length) */
    let charset = 0;
    if (hasLower) charset += 26;
    if (hasUpper) charset += 26;
    if (hasDigit) charset += 10;
    if (hasSym)   charset += 32;
    const entropy = charset ? Math.log2(charset) * pw.length : 0;

    let score = 0;
    if (entropy >= 28) score = 1;
    if (entropy >= 36) score = 2;
    if (entropy >= 60) score = 3;
    if (entropy >= 80) score = 4;
    if (pw.length < 8) score = Math.min(score, 1);

    const labels = ['Too weak', 'Weak', 'Fair', 'Strong', 'Excellent'];
    return {
      score,
      label: labels[score],
      ok: score >= 3 && pw.length >= 8,
      reasons
    };
  }

  /* ════════════════════════════════════════
     PAPER-STYLE TOAST
  ════════════════════════════════════════ */
  function ensureToastStack() {
    let s = document.getElementById('nx-toast-stack');
    if (s) return s;
    s = document.createElement('div');
    s.id = 'nx-toast-stack';
    s.setAttribute('aria-live', 'polite');
    s.setAttribute('aria-atomic', 'true');
    document.body.appendChild(s);
    return s;
  }
  function toast(message, type = 'info', opts = {}) {
    const stack = ensureToastStack();
    const el = document.createElement('div');
    el.className = `nx-toast nx-toast--${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `
      <span class="nx-toast-mark" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 52 52" fill="currentColor">
          <path d="M26 3 L46 15 L46 37 L26 49 L6 37 L6 15 Z"/>
        </svg>
      </span>
      <span class="nx-toast-body">${escapeHtml(message)}</span>
      <button class="nx-toast-close" aria-label="Dismiss">×</button>
    `;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const close = () => {
      el.classList.remove('is-in');
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 320);
    };
    el.querySelector('.nx-toast-close').addEventListener('click', close);
    const timeout = opts.timeout ?? (type === 'error' ? 6000 : 4000);
    if (timeout > 0) setTimeout(close, timeout);
    return { close };
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ════════════════════════════════════════
     SUPABASE-BACKED FLOWS
  ════════════════════════════════════════ */
  async function _supaSignUp(email, password, profile) {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: profile.full_name || '',
          role:      profile.role,
          industry:  profile.industry || null,
          company:   profile.company || null
        },
        emailRedirectTo: window.location.origin + '/' + LOGIN_URL
      }
    });
    if (error) throw error;
    if (data.user) {
      /* Insert the profile row (RLS lets the user insert their own). */
      const { error: pErr } = await sb.from('profiles').insert({
        id: data.user.id,
        email,
        full_name: profile.full_name || '',
        company:   profile.company || null,
        role:      profile.role,
        industry:  profile.industry || null,
        scci_number: profile.scci_number || null,
        location:  profile.location || null,
        verified_status: false
      });
      if (pErr && !/duplicate key/i.test(pErr.message)) {
        console.warn('[Nexora Auth] profile insert failed:', pErr);
      }
    }
    return { user: data.user, session: data.session };
  }

  async function _supaSignIn(email, password) {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const profile = await _loadProfile(data.user.id);
    return { user: data.user, session: data.session, profile };
  }

  async function _supaSignOut() {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
  }

  async function _supaSession() {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session || null;
  }

  async function _loadProfile(userId) {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from('profiles').select('*').eq('id', userId).single();
    if (error) {
      console.warn('[Nexora Auth] profile load failed:', error.message);
      return null;
    }
    return data;
  }

  /* ════════════════════════════════════════
     DEMO-MODE FLOWS (localStorage fallback)
  ════════════════════════════════════════ */
  async function _demoSignUp(email, password, profile) {
    const users = demoUsers();
    const existing = users.find(u => u.email === email);
    if (existing) {
      const e = new Error('An account with this email already exists.');
      e.code = 'user_already_exists';
      throw e;
    }
    const user = {
      id: 'demo_' + Math.random().toString(36).slice(2, 11),
      email,
      pwhash: fakeHash(password),
      profile: {
        email,
        full_name: profile.full_name || '',
        company:   profile.company || null,
        role:      profile.role,
        industry:  profile.industry || null,
        scci_number: profile.scci_number || null,
        location:  profile.location || null,
        verified_status: false,
        created_at: new Date().toISOString()
      }
    };
    users.push(user);
    saveDemoUsers(users);
    const session = { user: { id: user.id, email }, profile: user.profile, ts: Date.now() };
    saveDemoSession(session);
    return { user: session.user, session, profile: user.profile };
  }

  async function _demoSignIn(email, password) {
    const users = demoUsers();
    const user = users.find(u => u.email === email);
    if (!user) {
      const e = new Error('Invalid email or password.');
      e.code = 'invalid_credentials';
      throw e;
    }
    if (user.pwhash !== fakeHash(password)) {
      const e = new Error('Invalid email or password.');
      e.code = 'invalid_credentials';
      throw e;
    }
    const session = { user: { id: user.id, email }, profile: user.profile, ts: Date.now() };
    saveDemoSession(session);
    return { user: session.user, session, profile: user.profile };
  }

  async function _demoSignOut() {
    saveDemoSession(null);
  }

  async function _demoSessionGet() {
    return demoSession();
  }

  /* ════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════ */
  async function signUp(email, password, profile) {
    email = sanitizeEmail(email);
    profile = profile || {};
    profile.full_name  = sanitize(profile.full_name);
    profile.company    = sanitize(profile.company);
    profile.location   = sanitize(profile.location);
    profile.scci_number= sanitizeAlpha(profile.scci_number);
    if (!email) throw new Error('Please provide an email address.');
    if (!password) throw new Error('Please provide a password.');
    const strength = passwordStrength(password);
    if (!strength.ok) {
      const reasons = strength.reasons.length ? ' (' + strength.reasons.join('; ') + ')' : '';
      throw new Error('Password is too weak' + reasons + '.');
    }
    if (!['manufacturer','exporter','logistics'].includes(profile.role)) {
      throw new Error('Please select a role.');
    }
    if (profile.role === 'manufacturer' && !['surgical','sports','leather'].includes(profile.industry)) {
      throw new Error('Please select your manufacturing industry.');
    }
    getSupabase();
    if (_demoMode) return _demoSignUp(email, password, profile);
    return _supaSignUp(email, password, profile);
  }

  async function signIn(email, password) {
    email = sanitizeEmail(email);
    if (!email || !password) {
      const e = new Error('Email and password are required.');
      e.code = 'missing_fields';
      throw e;
    }
    getSupabase();
    if (_demoMode) return _demoSignIn(email, password);
    return _supaSignIn(email, password);
  }

  async function signOut() {
    getSupabase();
    if (_demoMode) return _demoSignOut();
    return _supaSignOut();
  }

  /**
   * Returns { user, profile } if signed in, else null.
   * Caches the profile after the first lookup.
   */
  let _profileCache = null;
  async function getCurrentUser() {
    getSupabase();
    if (_demoMode) {
      const s = demoSession();
      return s ? { user: s.user, profile: s.profile } : null;
    }
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getUser();
    if (!data.user) return null;
    if (_profileCache && _profileCache.id === data.user.id) {
      return { user: data.user, profile: _profileCache };
    }
    const profile = await _loadProfile(data.user.id);
    _profileCache = profile;
    return { user: data.user, profile };
  }

  async function getSession() {
    getSupabase();
    if (_demoMode) return _demoSessionGet();
    return _supaSession();
  }

  function redirectForRole(role) {
    const url = REDIRECTS[role] || REDIRECTS.manufacturer || 'Nexora - Dashboard.html';
    window.location.assign(url);
  }

  /**
   * "Nexora Guard" — call from any protected page.
   * If no session, redirect to login with a paper-style toast queued
   * on the next page via sessionStorage.
   *
   * Optional `allowedRoles`: array; if the user's role is not in it
   * they get bounced to their own dashboard.
   */
  async function requireAuth(allowedRoles) {
    const me = await getCurrentUser();
    if (!me || !me.user) {
      try {
        sessionStorage.setItem('nexora-flash', JSON.stringify({
          type: 'error',
          message: 'Please sign in to continue.'
        }));
      } catch {}
      window.location.replace(LOGIN_URL);
      return null;
    }
    if (Array.isArray(allowedRoles) && allowedRoles.length) {
      const role = (me.profile && me.profile.role) || 'manufacturer';
      if (!allowedRoles.includes(role)) {
        try {
          sessionStorage.setItem('nexora-flash', JSON.stringify({
            type: 'error',
            message: 'This area is restricted to ' + allowedRoles.join(' or ') + ' accounts.'
          }));
        } catch {}
        redirectForRole(role);
        return null;
      }
    }
    return me;
  }

  function requireRole(role) {
    return requireAuth([role]);
  }

  /* Display any flash message left by the previous page (after redirect). */
  function consumeFlash() {
    try {
      const raw = sessionStorage.getItem('nexora-flash');
      if (!raw) return;
      sessionStorage.removeItem('nexora-flash');
      const flash = JSON.parse(raw);
      if (flash && flash.message) toast(flash.message, flash.type || 'info');
    } catch {}
  }
  document.addEventListener('DOMContentLoaded', consumeFlash);

  /* ────────────────────────────────────────
     "Welcome" email stub
     For Supabase, this is best done via an Edge Function or via
     Supabase Auth's built-in confirmation email (Settings → Email
     Templates → Confirm signup). The text below is the template
     copy. For now, this function logs to the console so you can
     wire it up to your email provider of choice.
  ──────────────────────────────────────── */
  function sendWelcomeEmail(profile) {
    const name = profile.full_name || 'partner';
    const body = `Salam ${name}, we've received your application to join the Nexora manufacturer network. Our team will verify your SCCI credentials shortly.`;
    console.info('[Nexora Auth] welcome email →', profile.email, '\n', body);
    /* If you have a Supabase Edge Function at /functions/v1/welcome:
       const sb = getSupabase();
       if (sb) sb.functions.invoke('welcome', { body: { email: profile.email, name } });
    */
  }

  /* ── Expose ───────────────────────────── */
  window.NexoraAuth = {
    signUp, signIn, signOut,
    getSession, getCurrentUser,
    requireAuth, requireRole,
    passwordStrength,
    sanitize, sanitizeAlpha, sanitizeEmail,
    toast, redirectForRole,
    sendWelcomeEmail,
    get demoMode() { getSupabase(); return _demoMode; }
  };
})();
