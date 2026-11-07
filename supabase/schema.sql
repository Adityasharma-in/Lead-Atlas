-- ============================================================
-- Lead Atlas — Supabase schema
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- It is safe to run again: every object is created conditionally.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Profiles (one row per authenticated user)
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  company text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The Apify token belongs to the account, not the local server. The owner-only
-- RLS policies below are what keep this column private.
alter table public.profiles
  add column if not exists apify_token text;

comment on column public.profiles.apify_token is
  'Per-account Apify API token. Read and written only by the signed-in owner through RLS.';

-- ------------------------------------------------------------
-- Saved reports (a scan or an imported file)
-- ------------------------------------------------------------
create table if not exists public.lead_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  niche text,
  location text,
  source text not null default 'scan' check (source in ('scan', 'import')),
  run_id text,
  lead_count integer not null default 0 check (lead_count >= 0),
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Leads (the durable copy of every extracted row)
-- `payload` keeps the full normalized lead so future fields survive.
-- ------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.lead_reports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lead_key text not null,
  business_name text,
  category text,
  address text,
  city text,
  phone text,
  email text,
  website text,
  rating numeric(3, 1),
  review_count integer,
  outreach_status text not null default 'to-contact'
    check (outreach_status in ('to-contact', 'contacted', 'do-not-contact')),
  outreach_note text check (outreach_note is null or char_length(outreach_note) <= 280),
  contacted_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, lead_key)
);

create index if not exists lead_reports_user_created_idx
  on public.lead_reports (user_id, created_at desc);
create index if not exists leads_user_report_idx
  on public.leads (user_id, report_id);
create index if not exists leads_outreach_idx
  on public.leads (user_id, outreach_status);
create index if not exists leads_business_name_idx
  on public.leads (user_id, business_name);

-- ------------------------------------------------------------
-- Call-script library (one row per account)
-- `scripts` is the same normalized array the editor already uses, so one
-- atomic write keeps the whole library (and its default script) in sync.
-- ------------------------------------------------------------
create table if not exists public.script_libraries (
  user_id uuid primary key references auth.users (id) on delete cascade,
  active_id text,
  scripts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint script_libraries_scripts_array
    check (jsonb_typeof(scripts) = 'array'),
  constraint script_libraries_active_id_length
    check (active_id is null or char_length(active_id) <= 80)
);

comment on table public.script_libraries is
  'Per-account cold-call script library. Owner-only RLS; scripts is a normalized JSON array.';

-- ------------------------------------------------------------
-- updated_at maintenance
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists lead_reports_touch_updated_at on public.lead_reports;
create trigger lead_reports_touch_updated_at
  before update on public.lead_reports
  for each row execute function public.touch_updated_at();

drop trigger if exists leads_touch_updated_at on public.leads;
create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function public.touch_updated_at();

drop trigger if exists script_libraries_touch_updated_at on public.script_libraries;
create trigger script_libraries_touch_updated_at
  before update on public.script_libraries
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Create a profile automatically when someone signs up
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- Row Level Security — users can only ever touch their own rows
-- ------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.lead_reports enable row level security;
alter table public.leads enable row level security;
alter table public.script_libraries enable row level security;

drop policy if exists "profiles: owner can read" on public.profiles;
create policy "profiles: owner can read"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: owner can insert" on public.profiles;
create policy "profiles: owner can insert"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles: owner can update" on public.profiles;
create policy "profiles: owner can update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "reports: owner can read" on public.lead_reports;
create policy "reports: owner can read"
  on public.lead_reports for select
  using (auth.uid() = user_id);

drop policy if exists "reports: owner can insert" on public.lead_reports;
create policy "reports: owner can insert"
  on public.lead_reports for insert
  with check (auth.uid() = user_id);

drop policy if exists "reports: owner can update" on public.lead_reports;
create policy "reports: owner can update"
  on public.lead_reports for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "reports: owner can delete" on public.lead_reports;
create policy "reports: owner can delete"
  on public.lead_reports for delete
  using (auth.uid() = user_id);

drop policy if exists "leads: owner can read" on public.leads;
create policy "leads: owner can read"
  on public.leads for select
  using (auth.uid() = user_id);

drop policy if exists "leads: owner can insert" on public.leads;
create policy "leads: owner can insert"
  on public.leads for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.lead_reports r
      where r.id = report_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "leads: owner can update" on public.leads;
create policy "leads: owner can update"
  on public.leads for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.lead_reports r
      where r.id = report_id and r.user_id = auth.uid()
    )
  );

drop policy if exists "leads: owner can delete" on public.leads;
create policy "leads: owner can delete"
  on public.leads for delete
  using (auth.uid() = user_id);

drop policy if exists "scripts: owner can read" on public.script_libraries;
create policy "scripts: owner can read"
  on public.script_libraries for select
  using (auth.uid() = user_id);

drop policy if exists "scripts: owner can insert" on public.script_libraries;
create policy "scripts: owner can insert"
  on public.script_libraries for insert
  with check (auth.uid() = user_id);

drop policy if exists "scripts: owner can update" on public.script_libraries;
create policy "scripts: owner can update"
  on public.script_libraries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "scripts: owner can delete" on public.script_libraries;
create policy "scripts: owner can delete"
  on public.script_libraries for delete
  using (auth.uid() = user_id);
