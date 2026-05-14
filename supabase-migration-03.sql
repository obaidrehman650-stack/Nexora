-- ════════════════════════════════════════════════════════
-- NEXORA — Migration 03 (additive)
-- ────────────────────────────────────────────────────────
-- Run AFTER migration 02. Paste into Supabase SQL Editor → Run.
-- Idempotent.
--
-- Adds: nexora_delete_my_account()
--   A user-callable RPC that hard-deletes the caller's
--   auth.users row. The cascading FKs on profiles, rfqs,
--   quotes, threads, messages and notifications then wipe
--   every row they own — no orphans, no leftover bytes.
--
-- The function is `security definer` so it runs with
-- elevated privileges, but it ALWAYS scopes the delete to
-- `auth.uid()` — a user cannot delete anyone else.
-- ════════════════════════════════════════════════════════

create or replace function public.nexora_delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  /* Belt-and-braces: blow away the public-schema rows even though
     ON DELETE CASCADE handles them. This keeps the function robust
     if anyone ever drops the FK constraints. */
  delete from public.notifications where user_id        = uid;
  delete from public.messages      where sender_id      = uid;
  delete from public.threads       where exporter_id    = uid or manufacturer_id = uid;
  delete from public.quotes        where manufacturer_id = uid;
  delete from public.rfqs          where posted_by      = uid;
  delete from public.profiles      where id             = uid;

  /* Finally remove the auth row itself — invalidates every existing
     access token for this user. */
  delete from auth.users where id = uid;
end;
$$;

revoke all  on function public.nexora_delete_my_account() from public, anon;
grant execute on function public.nexora_delete_my_account() to authenticated;
