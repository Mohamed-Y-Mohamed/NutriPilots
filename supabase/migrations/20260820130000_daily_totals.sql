-- NutriPilot — one row per day, for the trends on the Today screen.
--
-- Week, month and year views all want the same thing: what a day added up to.
-- Fetching the entries themselves and summing them in the app would mean
-- pulling a year of individual foods over the wire to draw twelve bars, so the
-- summing happens here and the app receives at most one row per day.
--
-- security invoker, so row-level security decides what is visible and the
-- function cannot be used to read anyone else's diary.

create or replace function public.daily_totals(from_date date, to_date date)
returns table (
  day       date,
  calories  numeric,
  protein   numeric,
  carbs     numeric,
  fat       numeric,
  fibre     numeric,
  items     bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    d.date                              as day,
    sum(d.calories)::numeric            as calories,
    sum(d.protein)::numeric             as protein,
    sum(d.carbs)::numeric               as carbs,
    sum(d.fat)::numeric                 as fat,
    sum(coalesce(d.fibre, 0))::numeric  as fibre,
    count(*)                            as items
  from public.diary_entries d
  where d.user_id = auth.uid()
    and d.date >= from_date
    and d.date <= to_date
  group by d.date
  order by d.date;
$$;

-- Supabase grants execute to public by default, and a bare REVOKE ... FROM
-- PUBLIC does not remove the grants anon and authenticated hold in their own
-- right. Both roles have to be named for the revoke to mean anything.
revoke all on function public.daily_totals(date, date) from public, anon, authenticated;
grant execute on function public.daily_totals(date, date) to authenticated;
