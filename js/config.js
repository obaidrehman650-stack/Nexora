/* ════════════════════════════════════════
   NEXORA — Runtime configuration
   ──────────────────────────────────────────
   Paste your Supabase project credentials here.
   They are public keys (anon key is safe to ship); RLS
   policies protect actual data on the server side.
   See supabase-schema.sql for the database setup.
════════════════════════════════════════ */
window.NEXORA_CONFIG = {
  /* From your Supabase dashboard → Settings → API */
  SUPABASE_URL:      'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-PUBLIC-ANON-KEY',

  /* If the keys above are still placeholders, the auth layer
     falls back to a local-storage "demo" mode so you can test
     the flows end-to-end before connecting Supabase. */
  ALLOW_DEMO_MODE: true,

  /* Where each role lands after a successful login */
  REDIRECTS: {
    manufacturer: 'Nexora - Dashboard.html',
    exporter:     'exporter.html',
    logistics:    'Nexora - Dashboard.html'
  },

  /* Where unauthenticated users get bounced to */
  LOGIN_URL: 'auth.html'
};
