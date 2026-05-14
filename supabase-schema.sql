-- ════════════════════════════════════════════════════════
-- NEXORA — Supabase schema
-- ────────────────────────────────────────────────────────
-- Paste this into the Supabase SQL editor (Database → SQL).
-- It creates the `profiles`, `rfqs` and `quotes` tables, plus
-- the Row-Level Security policies that protect access by role.
-- ════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────
-- profiles
-- One row per signed-up user. Created either by the client on
-- sign-up (NexoraAuth.signUp inserts into this table) or by the
-- handle_new_user trigger below if you prefer server-side.
-- ────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  full_name         text,
  company           text,
  role              text not null check (role in ('manufacturer','exporter','logistics')),
  industry          text     check (industry in ('surgical','sports','leather','mixed')),
  scci_number       text,
  location          text,
  verified_status   boolean  not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists profiles_role_idx     on public.profiles (role);
create index if not exists profiles_industry_idx on public.profiles (industry);

alter table public.profiles enable row level security;

drop policy if exists "profiles: own row select"   on public.profiles;
drop policy if exists "profiles: own row insert"   on public.profiles;
drop policy if exists "profiles: own row update"   on public.profiles;
drop policy if exists "profiles: read peers"       on public.profiles;

-- A user can always read/insert/update their own profile row.
create policy "profiles: own row select"
  on public.profiles for select
  using ( auth.uid() = id );

create policy "profiles: own row insert"
  on public.profiles for insert
  with check ( auth.uid() = id );

create policy "profiles: own row update"
  on public.profiles for update
  using ( auth.uid() = id );

-- Verified accounts can see basic info of other verified accounts —
-- useful when an exporter wants to see who quoted them.
create policy "profiles: read peers"
  on public.profiles for select
  using (
    verified_status = true
    and exists (
      select 1 from public.profiles me
      where me.id = auth.uid() and me.verified_status = true
    )
  );

-- ────────────────────────────────────────────────────────
-- rfqs — Requirements posted by exporters
-- ────────────────────────────────────────────────────────
create table if not exists public.rfqs (
  id            uuid primary key default gen_random_uuid(),
  posted_by     uuid not null references auth.users(id) on delete cascade,
  product       text not null,
  industry      text not null check (industry in ('surgical','sports','leather')),
  quantity      integer not null check (quantity > 0),
  unit          text not null default 'units',
  target_price  numeric(12,2),
  lead_time     text,
  destination   text not null,
  incoterm      text,
  specs         text,
  status        text not null default 'open'
                  check (status in ('draft','open','quoted','closed','won','lost')),
  created_at    timestamptz not null default now()
);

create index if not exists rfqs_industry_status_idx on public.rfqs (industry, status);
create index if not exists rfqs_posted_by_idx        on public.rfqs (posted_by);

alter table public.rfqs enable row level security;

drop policy if exists "rfqs: owner read"    on public.rfqs;
drop policy if exists "rfqs: owner write"   on public.rfqs;
drop policy if exists "rfqs: mfg read open" on public.rfqs;

-- Exporters can read/write their own RFQs
create policy "rfqs: owner read"
  on public.rfqs for select
  using ( posted_by = auth.uid() );

create policy "rfqs: owner write"
  on public.rfqs for all
  using ( posted_by = auth.uid() )
  with check ( posted_by = auth.uid() );

-- Verified manufacturers can read open RFQs matching their industry
create policy "rfqs: mfg read open"
  on public.rfqs for select
  using (
    status in ('open','quoted')
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'manufacturer'
        and p.verified_status = true
        and (p.industry = public.rfqs.industry or p.industry = 'mixed')
    )
  );

-- ────────────────────────────────────────────────────────
-- quotes — Manufacturer responses to an RFQ
-- ────────────────────────────────────────────────────────
create table if not exists public.quotes (
  id              uuid primary key default gen_random_uuid(),
  rfq_id          uuid not null references public.rfqs(id) on delete cascade,
  manufacturer_id uuid not null references auth.users(id)  on delete cascade,
  unit_price      numeric(12,2) not null,
  lead_time       text,
  payment_terms   text,
  incoterm        text,
  notes           text,
  status          text not null default 'sent'
                    check (status in ('sent','seen','accepted','rejected','withdrawn')),
  created_at      timestamptz not null default now()
);

create index if not exists quotes_rfq_idx on public.quotes (rfq_id);
create index if not exists quotes_mfg_idx on public.quotes (manufacturer_id);

alter table public.quotes enable row level security;

drop policy if exists "quotes: mfg own"   on public.quotes;
drop policy if exists "quotes: rfq owner" on public.quotes;

-- Manufacturers manage their own quotes
create policy "quotes: mfg own"
  on public.quotes for all
  using ( manufacturer_id = auth.uid() )
  with check ( manufacturer_id = auth.uid() );

-- RFQ owner (exporter) can read every quote on their RFQ
create policy "quotes: rfq owner"
  on public.quotes for select
  using (
    exists (
      select 1 from public.rfqs r
      where r.id = quotes.rfq_id and r.posted_by = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────
-- Optional: auto-create a profile shell on signup
-- The client also inserts after signUp; this is a safety net
-- so an account is never left without a profile row.
-- ────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, industry, company, scci_number, location)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role',      'manufacturer'),
    nullif(new.raw_user_meta_data->>'industry',    ''),
    nullif(new.raw_user_meta_data->>'company',     ''),
    nullif(new.raw_user_meta_data->>'scci_number', ''),
    nullif(new.raw_user_meta_data->>'location',    '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ────────────────────────────────────────────────────────
-- Welcome email — Edge Function stub
-- ────────────────────────────────────────────────────────
-- Easiest path: open Supabase → Authentication → Email Templates →
-- "Confirm signup" and paste this body:
--
--   Salam {{ .Data.full_name }},
--
--   We've received your application to join the Nexora manufacturer
--   network. Our team will verify your SCCI credentials shortly.
--
--   In the meantime, browse the Bench:
--   {{ .ConfirmationURL }}
--
-- For a fully custom send (e.g. via Resend), create an Edge Function
-- at /functions/v1/welcome and invoke it from auth.js → sendWelcomeEmail.
