create unique index if not exists rounds_group_external_draw_key
  on public.rounds (group_id, external_draw_number)
  where external_draw_number is not null;
