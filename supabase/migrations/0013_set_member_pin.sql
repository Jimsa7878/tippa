create or replace function public.set_member_pin(target_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if target_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly four digits';
  end if;

  update public.group_members
  set pin_hash = extensions.crypt(target_pin, extensions.gen_salt('bf'))
  where user_id = auth.uid() and active;

  if not found then
    raise exception 'Member not found';
  end if;
end;
$$;

grant execute on function public.set_member_pin(text) to anon, authenticated;
