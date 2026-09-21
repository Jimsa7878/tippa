alter table public.group_members
  add column if not exists pin_hash text;

drop function if exists public.create_group_with_code(text, text, text);
drop function if exists public.join_group_by_code(text, text);

create or replace function public.create_group_with_code(
  target_name text,
  target_code text,
  member_name text,
  member_pin text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if target_code !~ '^[0-9]{5}$' then
    raise exception 'Group code must be exactly five digits';
  end if;

  if member_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly four digits';
  end if;

  insert into public.groups (name, created_by, join_code)
  values (nullif(trim(target_name), ''), auth.uid(), target_code)
  returning id into new_group_id;

  insert into public.group_members (group_id, user_id, display_name, role, pin_hash)
  values (new_group_id, auth.uid(), coalesce(nullif(trim(member_name), ''), 'Spelare'), 'owner', crypt(member_pin, gen_salt('bf')));

  return new_group_id;
end;
$$;

create or replace function public.join_group_by_code(
  target_code text,
  member_name text,
  member_pin text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group_id uuid;
  existing_user_id uuid;
  existing_pin_hash text;
  clean_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if member_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly four digits';
  end if;

  clean_name := coalesce(nullif(trim(member_name), ''), 'Spelare');

  select id into target_group_id
  from public.groups
  where join_code = trim(target_code);

  if target_group_id is null then
    raise exception 'No group found for that code';
  end if;

  select user_id, pin_hash
    into existing_user_id, existing_pin_hash
  from public.group_members
  where group_id = target_group_id
    and lower(display_name) = lower(clean_name)
    and active
  limit 1
  for update;

  if existing_user_id is not null then
    if existing_pin_hash is not null and existing_pin_hash <> crypt(member_pin, existing_pin_hash) then
      raise exception 'Fel PIN för den här medlemmen';
    end if;

    if existing_user_id <> auth.uid() then
      delete from public.predictions p
      using public.rounds r
      where p.user_id = auth.uid()
        and p.round_id = r.id
        and r.group_id = target_group_id;

      delete from public.payments p
      using public.rounds r
      where p.user_id = auth.uid()
        and p.round_id = r.id
        and r.group_id = target_group_id;

      delete from public.group_members
      where group_id = target_group_id and user_id = auth.uid();

      update public.predictions p
      set user_id = auth.uid()
      from public.rounds r
      where p.user_id = existing_user_id
        and p.round_id = r.id
        and r.group_id = target_group_id;

      update public.payments p
      set user_id = auth.uid()
      from public.rounds r
      where p.user_id = existing_user_id
        and p.round_id = r.id
        and r.group_id = target_group_id;

      update public.rounds
      set captain_user_id = auth.uid()
      where group_id = target_group_id and captain_user_id = existing_user_id;

      update public.groups
      set created_by = auth.uid()
      where id = target_group_id and created_by = existing_user_id;

      update public.group_members
      set user_id = auth.uid(), pin_hash = crypt(member_pin, gen_salt('bf'))
      where group_id = target_group_id and user_id = existing_user_id;
    else
      update public.group_members
      set display_name = clean_name, active = true, pin_hash = crypt(member_pin, gen_salt('bf'))
      where group_id = target_group_id and user_id = auth.uid();
    end if;
  else
    insert into public.group_members (group_id, user_id, display_name, pin_hash)
    values (target_group_id, auth.uid(), clean_name, crypt(member_pin, gen_salt('bf')))
    on conflict (group_id, user_id) do update
      set display_name = excluded.display_name,
          active = true,
          pin_hash = excluded.pin_hash;
  end if;

  return target_group_id;
end;
$$;

grant execute on function public.create_group_with_code(text, text, text, text) to anon, authenticated;
grant execute on function public.join_group_by_code(text, text, text) to anon, authenticated;

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
  set pin_hash = crypt(target_pin, gen_salt('bf'))
  where user_id = auth.uid() and active;

  if not found then
    raise exception 'Member not found';
  end if;
end;
$$;

grant execute on function public.set_member_pin(text) to anon, authenticated;
