create table if not exists public.round_systems (
  round_id uuid primary key references public.rounds(id) on delete cascade,
  selections jsonb not null,
  row_count integer not null check (row_count > 0),
  row_cost numeric(8,2) not null default 1 check (row_cost >= 0),
  total_cost numeric(8,2) not null check (total_cost >= 0),
  created_by uuid not null references auth.users(id),
  locked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.round_systems enable row level security;

create policy "members can view round systems" on public.round_systems
  for select using (exists (
    select 1 from public.rounds r where r.id = round_id and public.is_group_member(r.group_id)
  ));

create policy "members can create round systems" on public.round_systems
  for insert with check (exists (
    select 1 from public.rounds r where r.id = round_id and public.is_group_member(r.group_id)
  ) and created_by = auth.uid());

create policy "members can update own round systems" on public.round_systems
  for update using (created_by = auth.uid()) with check (created_by = auth.uid());

create policy "members can update payment status" on public.payments
  for update using (exists (
    select 1 from public.rounds r
    join public.group_members gm on gm.group_id = r.group_id
    where r.id = round_id and gm.user_id = auth.uid() and gm.active and gm.role in ('owner', 'admin')
  ));

drop policy if exists "members can update rounds" on public.rounds;
create policy "members can update rounds" on public.rounds
  for update using (exists (
    select 1 from public.group_members gm
    where gm.group_id = rounds.group_id and gm.user_id = auth.uid() and gm.active
  ))
  with check (exists (
    select 1 from public.group_members gm
    where gm.group_id = rounds.group_id and gm.user_id = auth.uid() and gm.active
  ));

grant select, insert, update on public.round_systems to anon, authenticated;
grant update on public.payments to anon, authenticated;
