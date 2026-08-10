-- ============================================================================
-- NutriPilot — verification
--
-- Run this after steps 1 and 2. Every row should say PASS.
-- Read-only: it changes nothing.
-- ============================================================================

with expected_tables (name) as (
  values ('user_profiles'), ('user_ingredients'), ('user_recipes'),
         ('diary_entries'), ('chat_messages'), ('meal_photo_analyses')
),
table_check as (
  select
    '1. tables created' as check,
    count(*) filter (where t.table_name is not null) || ' of 6' as detail,
    count(*) filter (where t.table_name is not null) = 6 as ok
  from expected_tables e
  left join information_schema.tables t
    on t.table_schema = 'public' and t.table_name = e.name
),
rls_check as (
  select
    '2. row level security enabled' as check,
    count(*) || ' of 6' as detail,
    count(*) = 6 as ok
  from pg_tables p
  join expected_tables e on e.name = p.tablename
  where p.schemaname = 'public' and p.rowsecurity
),
policy_check as (
  select
    '3. per-user policies (4 each)' as check,
    count(*) || ' of 24' as detail,
    count(*) = 24 as ok
  from pg_policies p
  join expected_tables e on e.name = p.tablename
  where p.schemaname = 'public'
),
diary_columns as (
  select
    '4. diary_entries extended' as check,
    string_agg(column_name, ', ' order by column_name) as detail,
    count(*) = 8 as ok
  from information_schema.columns
  where table_schema = 'public' and table_name = 'diary_entries'
    and column_name in ('recipe_id','user_ingredient_id','user_recipe_id',
                        'source','servings','fibre','notes','updated_at')
),
model_columns as (
  select
    '5. model/provider columns' as check,
    count(*) || ' of 4' as detail,
    count(*) = 4 as ok
  from information_schema.columns
  where table_schema = 'public'
    and (table_name, column_name) in (
      ('chat_messages','provider'), ('chat_messages','model'),
      ('meal_photo_analyses','provider'), ('meal_photo_analyses','model')
    )
),
rpc_check as (
  select
    '6. recent_foods RPC' as check,
    coalesce(string_agg(p.proname, ', '), 'missing') as detail,
    count(*) = 1 as ok
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'recent_foods'
),
bucket_check as (
  select
    '7. meal-photos bucket, private' as check,
    coalesce(
      (select case when public then 'EXISTS BUT PUBLIC' else 'private, '
        || (file_size_limit / 1048576) || ' MB' end
       from storage.buckets where id = 'meal-photos'),
      'missing') as detail,
    exists (select 1 from storage.buckets where id = 'meal-photos' and not public) as ok
),
storage_policy_check as (
  select
    '8. storage policies' as check,
    count(*) || ' of 3' as detail,
    count(*) = 3 as ok
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('meal_photos_select_own','meal_photos_insert_own','meal_photos_delete_own')
),
reference_check as (
  select
    '9. reference data untouched' as check,
    (select count(*) from public.ingredients) || ' ingredients, '
      || (select count(*) from public.recipes) || ' recipes' as detail,
    (select count(*) from public.ingredients) > 2000
      and (select count(*) from public.recipes) > 700 as ok
)
select
  check,
  case when ok then 'PASS' else 'FAIL' end as result,
  detail
from (
  select * from table_check
  union all select * from rls_check
  union all select * from policy_check
  union all select * from diary_columns
  union all select * from model_columns
  union all select * from rpc_check
  union all select * from bucket_check
  union all select * from storage_policy_check
  union all select * from reference_check
) checks
order by check;
