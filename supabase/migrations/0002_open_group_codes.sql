alter table public.groups
  add column if not exists join_code text;

update public.groups
set join_code = lpad(floor(random() * 100000)::text, 5, '0')
where join_code is null;

alter table public.groups
  alter column join_code set not null;

create unique index if not exists groups_join_code_key
  on public.groups (join_code);

create or replace function public.create_group_with_code(
  target_name text,
  target_code text,
  member_name text
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

  insert into public.groups (name, created_by, join_code)
  values (nullif(trim(target_name), ''), auth.uid(), target_code)
  returning id into new_group_id;

  insert into public.group_members (group_id, user_id, display_name, role)
  values (new_group_id, auth.uid(), coalesce(nullif(trim(member_name), ''), 'Spelare'), 'owner');

  return new_group_id;
end;
$$;

create or replace function public.join_group_by_code(
  target_code text,
  member_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select id into target_group_id
  from public.groups
  where join_code = trim(target_code);

  if target_group_id is null then
    raise exception 'No group found for that code';
  end if;

  insert into public.group_members (group_id, user_id, display_name)
  values (target_group_id, auth.uid(), coalesce(nullif(trim(member_name), ''), 'Spelare'))
  on conflict (group_id, user_id) do update
    set display_name = excluded.display_name,
        active = true;

  return target_group_id;
end;
$$;
