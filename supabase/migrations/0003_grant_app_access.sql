grant usage on schema public to anon, authenticated;

grant select on public.groups to anon, authenticated;
grant select on public.group_members to anon, authenticated;
grant select on public.rounds to anon, authenticated;
grant select on public.matches to anon, authenticated;
grant select on public.predictions to anon, authenticated;
grant select on public.payments to anon, authenticated;

grant execute on function public.is_group_member(uuid) to anon, authenticated;
grant execute on function public.create_group_with_code(text, text, text) to anon, authenticated;
grant execute on function public.join_group_by_code(text, text) to anon, authenticated;
