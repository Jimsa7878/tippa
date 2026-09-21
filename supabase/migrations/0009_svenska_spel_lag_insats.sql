alter table public.rounds
  alter column weekly_contribution set default 20;

update public.rounds
set weekly_contribution = 20
where status in ('draft', 'open');
