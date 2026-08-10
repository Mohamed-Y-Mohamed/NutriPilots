-- ============================================================================
-- NutriPilot — fix for recent_foods ("My foods" tab)
--
-- The deployed function declared uuid return columns, but diary_entries.
-- ingredient_id is not uuid-typed in this project, so every call failed with
--   42P13  Final statement returns text instead of uuid at column 3.
--
-- Paste this whole file into the Supabase SQL editor and run it. Safe to
-- re-run. Nothing else in the schema is touched.
-- ============================================================================

drop function if exists public.recent_foods(integer);

create or replace function public.recent_foods(limit_count integer default 40)
returns table (
  name          text,
  source        text,
  -- Returned as text, not uuid: `diary_entries` predates this migration and its
  -- id columns are not guaranteed to be uuid-typed. Casting keeps the function
  -- working either way, and JSON renders both identically.
  ingredient_id text,
  recipe_id     text,
  user_ingredient_id text,
  user_recipe_id text,
  unit          text,
  amount        numeric,
  calories      numeric,
  protein       numeric,
  carbs         numeric,
  fat           numeric,
  last_logged   timestamptz,
  times_logged  bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    t.name, t.source, t.ingredient_id, t.recipe_id,
    t.user_ingredient_id, t.user_recipe_id,
    t.unit, t.amount, t.calories, t.protein, t.carbs, t.fat,
    t.last_logged, t.times_logged
  from (
    select distinct on (lower(d.name), d.source)
      d.name::text                as name,
      d.source::text              as source,
      d.ingredient_id::text       as ingredient_id,
      d.recipe_id::text           as recipe_id,
      d.user_ingredient_id::text  as user_ingredient_id,
      d.user_recipe_id::text      as user_recipe_id,
      d.unit::text                as unit,
      d.amount::numeric           as amount,
      d.calories::numeric         as calories,
      d.protein::numeric          as protein,
      d.carbs::numeric            as carbs,
      d.fat::numeric              as fat,
      max(d.created_at) over (partition by lower(d.name), d.source) as last_logged,
      count(*)          over (partition by lower(d.name), d.source) as times_logged
    from public.diary_entries d
    where d.user_id = auth.uid()
    order by lower(d.name), d.source, d.created_at desc
  ) t
  order by t.last_logged desc
  limit limit_count;
$$;

grant execute on function public.recent_foods(integer) to authenticated;
