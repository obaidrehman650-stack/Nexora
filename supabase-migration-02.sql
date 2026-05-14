-- ════════════════════════════════════════════════════════
-- NEXORA — Migration 02 (additive)
-- ────────────────────────────────────────────────────────
-- Run AFTER supabase-schema.sql. Paste into Supabase SQL Editor
-- and click Run. Idempotent — safe to run more than once.
--
-- Adds:
--   • profile.about / employees / capacity / founded / certifications
--   • threads + messages tables (conversations between users)
--   • notifications table (the bell in the dashboard)
--   • nexora_public_stats() RPC — anonymous, used by the landing hero
-- ════════════════════════════════════════════════════════

-- ── profiles: room for the editable fields the dashboard exposes ──
alter table public.profiles
  add column if not exists about           text,
  add column if not exists employees       text,
  add column if not exists capacity        text,
  add column if not exists founded         integer,
  add column if not exists certifications  jsonb default '[]'::jsonb;

-- ────────────────────────────────────────────────────────
-- threads — one row per (manufacturer ↔ exporter, rfq) pair
-- ────────────────────────────────────────────────────────
create table if not exists public.threads (
  id            uuid primary key default gen_random_uuid(),
  rfq_id        uuid references public.rfqs(id) on delete set null,
  exporter_id   uuid not null references auth.users(id) on delete cascade,
  manufacturer_id uuid not null references auth.users(id) on delete cascade,
  last_preview  text,
  last_at       timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (rfq_id, exporter_id, manufacturer_id)
);

create index if not exists threads_exporter_idx     on public.threads (exporter_id, last_at desc);
create index if not exists threads_manufacturer_idx on public.threads (manufacturer_id, last_at desc);

alter table public.threads enable row level security;

drop policy if exists "threads: participants only" on public.threads;
create policy "threads: participants only"
  on public.threads for all
  using ( auth.uid() = exporter_id or auth.uid() = manufacturer_id )
  with check ( auth.uid() = exporter_id or auth.uid() = manufacturer_id );

-- ────────────────────────────────────────────────────────
-- messages — actual chat lines inside a thread
-- ────────────────────────────────────────────────────────
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.threads(id) on delete cascade,
  sender_id   uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists messages_thread_idx on public.messages (thread_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "messages: thread participant read" on public.messages;
drop policy if exists "messages: thread participant write" on public.messages;

create policy "messages: thread participant read"
  on public.messages for select
  using (
    exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (t.exporter_id = auth.uid() or t.manufacturer_id = auth.uid())
    )
  );

create policy "messages: thread participant write"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.threads t
      where t.id = messages.thread_id
        and (t.exporter_id = auth.uid() or t.manufacturer_id = auth.uid())
    )
  );

-- Keep thread.last_preview / last_at in sync on every new message
create or replace function public.touch_thread_on_message()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.threads
     set last_preview = left(new.body, 140),
         last_at      = new.created_at
   where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists on_message_insert on public.messages;
create trigger on_message_insert
  after insert on public.messages
  for each row execute procedure public.touch_thread_on_message();

-- ────────────────────────────────────────────────────────
-- notifications — the bell in the dashboard topbar
-- ────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,          -- 'rfq_new' | 'quote_sent' | 'thread_reply' | 'profile_view' …
  body_html   text not null,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications: own row" on public.notifications;
create policy "notifications: own row"
  on public.notifications for all
  using ( user_id = auth.uid() )
  with check ( user_id = auth.uid() );

-- When a new RFQ is posted, fan out notifications to every
-- verified manufacturer in that industry. This is what makes
-- the dashboard feel "live".
create or replace function public.notify_new_rfq()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, body_html, link)
  select p.id,
         'rfq_new',
         '<strong>New RFQ</strong> — ' || coalesce(new.product, '') ||
           ' (' || coalesce(new.destination, '') || ')',
         '/Nexora - Dashboard.html#rfq=' || new.id::text
    from public.profiles p
   where p.role = 'manufacturer'
     and p.verified_status = true
     and (p.industry = new.industry or p.industry = 'mixed');
  return new;
end;
$$;

drop trigger if exists on_rfq_insert_notify on public.rfqs;
create trigger on_rfq_insert_notify
  after insert on public.rfqs
  for each row execute procedure public.notify_new_rfq();

-- When a quote is sent, notify the RFQ owner (exporter)
create or replace function public.notify_new_quote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  posted_by uuid;
  product   text;
begin
  select r.posted_by, r.product into posted_by, product
    from public.rfqs r where r.id = new.rfq_id;
  if posted_by is not null then
    insert into public.notifications (user_id, kind, body_html, link)
    values (
      posted_by,
      'quote_sent',
      '<strong>New quote</strong> received on ' || coalesce(product, 'your RFQ'),
      '/exporter.html#rfq=' || new.rfq_id::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_quote_insert_notify on public.quotes;
create trigger on_quote_insert_notify
  after insert on public.quotes
  for each row execute procedure public.notify_new_quote();

-- ────────────────────────────────────────────────────────
-- nexora_public_stats() — used by the landing page hero
-- Returns aggregate counts only. Callable by anonymous users.
-- ────────────────────────────────────────────────────────
create or replace function public.nexora_public_stats()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'active_rfqs',    (select count(*) from public.rfqs where status in ('open','quoted')),
    'verified_units', (select count(*) from public.profiles where role = 'manufacturer' and verified_status = true),
    'total_adopters', (select count(*) from public.profiles),
    'markets',        (select count(distinct destination) from public.rfqs)
  );
$$;

grant execute on function public.nexora_public_stats() to anon, authenticated;

-- ────────────────────────────────────────────────────────
-- Realtime — turn on postgres_changes for the live tables.
-- This is what makes new RFQs / messages appear without refresh.
-- Idempotent: skipped if the table is already in the publication.
-- ────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['rfqs','quotes','messages','notifications'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
