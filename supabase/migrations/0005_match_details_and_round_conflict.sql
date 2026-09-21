alter table public.matches
  add column if not exists venue text,
  add column if not exists match_info text;

drop index if exists rounds_group_external_draw_key;

create unique index if not exists rounds_group_external_draw_key
  on public.rounds (group_id, external_draw_number);
