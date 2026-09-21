create extension if not exists pgcrypto;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id),
  max_members integer not null default 5 check (max_members > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  external_draw_number integer,
  label text not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'locked', 'settled')),
  internal_deadline_at timestamptz not null,
  official_close_at timestamptz,
  weekly_contribution numeric(8,2) not null default 25 check (weekly_contribution >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  match_number integer not null check (match_number between 1 and 13),
  external_match_id integer,
  home_team text not null,
  away_team text not null,
  kickoff_at timestamptz,
  result text check (result in ('1', 'X', '2')),
  svenska_folket jsonb,
  unique (round_id, match_number)
);

create table if not exists public.predictions (
  round_id uuid not null references public.rounds(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  selection text not null check (selection in ('1', 'X', '2')),
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create table if not exists public.payments (
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(8,2) not null check (amount >= 0),
  status text not null default 'unpaid' check (status in ('unpaid', 'reported', 'confirmed', 'rejected')),
  updated_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.rounds enable row level security;
alter table public.matches enable row level security;
alter table public.predictions enable row level security;
alter table public.payments enable row level security;

create or replace function public.is_group_member(target_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = target_group and user_id = auth.uid() and active);
$$;

create policy "members can view their groups" on public.groups for select using (public.is_group_member(id));
create policy "members can view group members" on public.group_members for select using (public.is_group_member(group_id));
create policy "members can view rounds" on public.rounds for select using (public.is_group_member(group_id));
create policy "members can view matches" on public.matches for select using (exists (select 1 from public.rounds r where r.id = round_id and public.is_group_member(r.group_id)));
create policy "members can view predictions" on public.predictions for select using (exists (select 1 from public.rounds r where r.id = round_id and public.is_group_member(r.group_id)));
create policy "users manage own predictions" on public.predictions for insert with check (user_id = auth.uid());
create policy "users update own predictions" on public.predictions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "members can view payments" on public.payments for select using (exists (select 1 from public.rounds r where r.id = round_id and public.is_group_member(r.group_id)));
create policy "users report own payment" on public.payments for insert with check (user_id = auth.uid());
create policy "users update own payment" on public.payments for update using (user_id = auth.uid()) with check (user_id = auth.uid());
