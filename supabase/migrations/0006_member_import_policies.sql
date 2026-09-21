create policy "members can create rounds"
  on public.rounds for insert
  with check (public.is_group_member(group_id));

create policy "members can update rounds"
  on public.rounds for update
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

create policy "members can create matches"
  on public.matches for insert
  with check (exists (
    select 1
    from public.rounds r
    where r.id = round_id
      and public.is_group_member(r.group_id)
  ));

create policy "members can update matches"
  on public.matches for update
  using (exists (
    select 1
    from public.rounds r
    where r.id = round_id
      and public.is_group_member(r.group_id)
  ))
  with check (exists (
    select 1
    from public.rounds r
    where r.id = round_id
      and public.is_group_member(r.group_id)
  ));