-- ════════════════════════════════════════════════════════
-- NEXORA — Migration 04 (fix)
-- ────────────────────────────────────────────────────────
-- Fixes: "infinite recursion detected in policy for relation profiles"
--
-- Cause: two RLS policies referenced public.profiles from inside
-- their USING clause. Postgres evaluated profiles' RLS on the
-- subquery, which re-triggered the same policy, looping forever.
--
-- Fix:  a SECURITY DEFINER helper that returns the caller's own
-- profile fields without going through RLS. The policies now
-- query the helper instead of the table — no self-reference,
-- no recursion.
--
-- Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════

-- 1) Drop the recursive policies first so the new ones can replace them.
drop policy if exists "profiles: read peers" on public.profiles;
drop policy if exists "rfqs: mfg read open"  on public.rfqs;

-- 2) Helper: returns the calling user's role / industry / verified flag
--    in a single row. SECURITY DEFINER lets it bypass RLS, but the
--    function body is locked to auth.uid() so a user can only ever read
--    their own.
create or replace function public.current_profile()
returns table(role text, industry text, verified_status boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.role, p.industry, p.verified_status
  from   public.profiles p
  where  p.id = auth.uid()
  limit  1;
$$;

revoke all     on function public.current_profile() from public, anon;
grant  execute on function public.current_profile() to authenticated;

-- 3) Recreate the policies using the helper. No self-reference now.

-- Verified accounts can read basic info of other verified accounts.
create policy "profiles: read peers"
  on public.profiles for select
  using (
    verified_status = true
    and exists (
      select 1 from public.current_profile()
      where  verified_status = true
    )
  );

-- Verified manufacturers can read open RFQs matching their industry.
create policy "rfqs: mfg read open"
  on public.rfqs for select
  using (
    status in ('open','quoted')
    and exists (
      select 1 from public.current_profile() me
      where  me.role            = 'manufacturer'
        and  me.verified_status = true
        and  (me.industry = public.rfqs.industry or me.industry = 'mixed')
    )
  );
