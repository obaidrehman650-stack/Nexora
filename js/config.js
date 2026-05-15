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
  SUPABASE_URL:      'https://sjpsbshrvymlotxgurwk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqcHNic2hydnltbG90eGd1cndrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MjkzOTYsImV4cCI6MjA5NDMwNTM5Nn0.utQQa4wM3PIfRBKla_9YyMxkNyke6xfM-VqJDAfStoA',

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
