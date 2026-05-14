-- ════════════════════════════════════════════════════════
-- NEXORA — Migration 05 (additive)
-- ────────────────────────────────────────────────────────
-- Adds:
--   • profiles.is_admin  (boolean, default false)
--   • public.is_admin()  (SECURITY DEFINER helper — never recurses)
--   • Admin-only RLS policies on every table (full read/write)
--   • public.nexora_admin_stats()  RPC for the overview dashboard
--
-- Bootstrap your first admin AFTER running this migration:
--
--   update public.profiles
--      set is_admin = true
--    where email = 'YOUR_EMAIL@example.com';
--
-- Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════

-- ── 1) Add the flag ──────────────────────────
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create index if not exists profiles_admin_idx
  on public.profiles (is_admin) where is_admin = true;

-- ── 2) Helper: am I an admin? ────────────────
-- SECURITY DEFINER bypasses RLS so this can't trigger recursion.
-- Body is locked to auth.uid(), so a user can only ever check
-- their own flag — never anyone else's.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

revoke all     on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

-- ── 3) Admin-override RLS policies ──────────
-- For each protected table, an extra policy that grants admins
-- the full set of operations. Drop-then-create makes the
-- migration idempotent.

drop policy if exists "profiles: admin all"      on public.profiles;
drop policy if exists "rfqs: admin all"          on public.rfqs;
drop policy if exists "quotes: admin all"        on public.quotes;
drop policy if exists "threads: admin all"       on public.threads;
drop policy if exists "messages: admin all"      on public.messages;
drop policy if exists "notifications: admin all" on public.notifications;

create policy "profiles: admin all"
  on public.profiles for all
  using      (public.is_admin())
  with check (public.is_admin());

create policy "rfqs: admin all"
  on public.rfqs for all
  using      (public.is_admin())
  with check (public.is_admin());

create policy "quotes: admin all"
  on public.quotes for all
  using      (public.is_admin())
  with check (public.is_admin());

create policy "threads: admin all"
  on public.threads for all
  using      (public.is_admin())
  with check (public.is_admin());

create policy "messages: admin all"
  on public.messages for all
  using      (public.is_admin())
  with check (public.is_admin());

create policy "notifications: admin all"
  on public.notifications for all
  using      (public.is_admin())
  with check (public.is_admin());

-- ── 4) Admin stats RPC ──────────────────────
-- Returns a single JSON object of aggregate counts for the admin
-- overview dashboard. Only admins can call it.
create or replace function public.nexora_admin_stats()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select json_build_object(
    'users_total',         (select count(*) from public.profiles),
    'users_manufacturer',  (select count(*) from public.profiles where role = 'manufacturer'),
    'users_exporter',      (select count(*) from public.profiles where role = 'exporter'),
    'users_logistics',     (select count(*) from public.profiles where role = 'logistics'),
    'users_verified',      (select count(*) from public.profiles where verified_status = true),
    'users_pending',       (select count(*) from public.profiles where verified_status = false and role = 'manufacturer'),
    'users_admins',        (select count(*) from public.profiles where is_admin = true),
    'rfqs_total',          (select count(*) from public.rfqs),
    'rfqs_open',           (select count(*) from public.rfqs where status = 'open'),
    'rfqs_quoted',         (select count(*) from public.rfqs where status = 'quoted'),
    'rfqs_won',            (select count(*) from public.rfqs where status = 'won'),
    'quotes_total',        (select count(*) from public.quotes),
    'quotes_sent',         (select count(*) from public.quotes where status = 'sent'),
    'quotes_accepted',     (select count(*) from public.quotes where status = 'accepted'),
    'threads_total',       (select count(*) from public.threads),
    'messages_total',      (select count(*) from public.messages),
    'notifications_total', (select count(*) from public.notifications),
    'rfqs_24h',            (select count(*) from public.rfqs    where created_at > now() - interval '24 hours'),
    'quotes_24h',          (select count(*) from public.quotes  where created_at > now() - interval '24 hours'),
    'signups_24h',         (select count(*) from public.profiles where created_at > now() - interval '24 hours')
  ) into result;

  return result;
end;
$$;

revoke all     on function public.nexora_admin_stats() from public, anon;
grant  execute on function public.nexora_admin_stats() to authenticated;

-- ── 5) Admin delete-user RPC ────────────────
-- Admins can delete profile rows via RLS, but auth.users sits in
-- a schema the client can't reach. This RPC bridges the gap and
-- cleans up every owned row in the process. Locked to admins;
-- raises FORBIDDEN otherwise.
create or replace function public.nexora_admin_delete_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if target = auth.uid() then
    raise exception 'Use the self-delete RPC for your own account' using errcode = '22023';
  end if;

  delete from public.notifications where user_id        = target;
  delete from public.messages      where sender_id      = target;
  delete from public.threads       where exporter_id    = target or manufacturer_id = target;
  delete from public.quotes        where manufacturer_id = target;
  delete from public.rfqs          where posted_by      = target;
  delete from public.profiles      where id             = target;
  delete from auth.users           where id             = target;
end;
$$;

revoke all     on function public.nexora_admin_delete_user(uuid) from public, anon;
grant  execute on function public.nexora_admin_delete_user(uuid) to authenticated;
