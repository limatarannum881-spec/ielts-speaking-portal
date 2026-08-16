-- =====================================================================
--  IELTS AI — Supabase schema
--  Run this once in: Supabase dashboard → SQL Editor → New query → Run.
--
--  Creates two tables (profiles, test_results) protected by Row Level
--  Security so each user can only read/write their own rows.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles — one row per user (target band, name, test version)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text,
  target_band numeric,
  version     text default 'academic',
  updated_at  timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 2. test_results — one row per completed test / attempt
-- ---------------------------------------------------------------------
create table if not exists public.test_results (
  id         text primary key,          -- client-generated id (e.g. "t1700000000000")
  user_id    uuid not null references auth.users (id) on delete cascade,
  test_type  text,                      -- full | reading | listening | writing | speaking
  version    text,                      -- academic | general
  title      text,
  listening  numeric,
  reading    numeric,
  writing    numeric,
  speaking   numeric,
  overall    numeric,
  correct    int,
  total      int,
  accuracy   numeric,
  duration   text,
  status     text default 'completed',
  created_at timestamptz default now()
);

create index if not exists test_results_user_id_idx on public.test_results (user_id);

-- ---------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.test_results enable row level security;

drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "test_results_own" on public.test_results;
create policy "test_results_own" on public.test_results
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4. Auto-create a profile row whenever a user signs up
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
