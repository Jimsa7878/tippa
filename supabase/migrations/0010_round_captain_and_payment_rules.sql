alter table public.rounds
  add column if not exists captain_user_id uuid references auth.users(id);

update public.rounds r
set captain_user_id = g.created_by
from public.groups g
where r.group_id = g.id
  and r.captain_user_id is null;

drop policy if exists "users report own payment" on public.payments;
drop policy if exists "users update own payment" on public.payments;
create policy "users report own payment" on public.payments
  for insert with check (user_id = auth.uid() and status in ('unpaid', 'reported'));
create policy "users update own reported payment" on public.payments
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and status in ('unpaid', 'reported'));
