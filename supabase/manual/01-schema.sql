-- ============================================================================
-- NutriPilot — step 1 of 2: schema, row level security, and the My Foods RPC
--
-- GENERATED from supabase/migrations/ — do not edit here.
-- Paste the whole file into the Supabase SQL editor and run it.
-- Idempotent: safe to run more than once.
-- Does NOT touch public.ingredients or public.recipes.
-- ============================================================================

-- NutriPilot v1 — per-user data model.
--
-- Idempotent. Safe to re-run. Does NOT touch the populated reference tables
-- `public.ingredients` and `public.recipes` in any way.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- user_profiles
-- ---------------------------------------------------------------------------

create table if not exists public.user_profiles (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  display_name      text,
  age               integer,
  calculation_sex   text,
  height_cm         numeric(6,2),
  weight_kg         numeric(6,2),
  target_weight_kg  numeric(6,2),
  activity_level    text,
  goal_mode         text,
  theme             text not null default 'system',
  onboarded         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.user_profiles drop constraint if exists user_profiles_age_check;
alter table public.user_profiles add constraint user_profiles_age_check
  check (age is null or (age between 13 and 120));

alter table public.user_profiles drop constraint if exists user_profiles_sex_check;
alter table public.user_profiles add constraint user_profiles_sex_check
  check (calculation_sex is null or calculation_sex in ('female','male'));

alter table public.user_profiles drop constraint if exists user_profiles_activity_check;
alter table public.user_profiles add constraint user_profiles_activity_check
  check (activity_level is null or activity_level in ('sedentary','light','moderate','very','athlete'));

alter table public.user_profiles drop constraint if exists user_profiles_goal_check;
alter table public.user_profiles add constraint user_profiles_goal_check
  check (goal_mode is null or goal_mode in ('lose-fast','lose','maintain','lean-gain','gain'));

alter table public.user_profiles drop constraint if exists user_profiles_theme_check;
alter table public.user_profiles add constraint user_profiles_theme_check
  check (theme in ('system','light','dark'));

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- user_ingredients — user-authored foods, same shape as public.ingredients
-- ---------------------------------------------------------------------------

create table if not exists public.user_ingredients (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  brand             text,
  food_type         text not null default 'ingredient',
  basis_quantity    numeric(8,2) not null default 100,
  basis_unit        text not null default 'g',
  calories_kcal     numeric(9,2) not null,
  protein_g         numeric(9,3) not null,
  carbohydrates_g   numeric(9,3) not null,
  fat_g             numeric(9,3) not null,
  saturated_fat_g   numeric(9,3),
  sugars_g          numeric(9,3),
  fibre_g           numeric(9,3),
  salt_g            numeric(9,3),
  sodium_mg         numeric(9,2),
  category          text,
  dietary_tags      text[],
  image_url         text,
  notes             text,
  verification      jsonb,
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.user_ingredients drop constraint if exists user_ingredients_basis_unit_check;
alter table public.user_ingredients add constraint user_ingredients_basis_unit_check
  check (basis_unit in ('g','ml'));

alter table public.user_ingredients drop constraint if exists user_ingredients_nonneg_check;
alter table public.user_ingredients add constraint user_ingredients_nonneg_check
  check (
    basis_quantity > 0
    and calories_kcal >= 0 and protein_g >= 0
    and carbohydrates_g >= 0 and fat_g >= 0
  );

create index if not exists user_ingredients_user_name_idx
  on public.user_ingredients (user_id, name);

drop trigger if exists user_ingredients_set_updated_at on public.user_ingredients;
create trigger user_ingredients_set_updated_at
  before update on public.user_ingredients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- user_recipes — user-authored recipes, same shape as public.recipes
-- ---------------------------------------------------------------------------

create table if not exists public.user_recipes (
  id                            uuid primary key default gen_random_uuid(),
  user_id                       uuid not null references auth.users(id) on delete cascade,
  name                          text not null,
  description                   text,
  image_url                     text,
  servings                      numeric(6,2) not null default 1,
  prep_time_minutes             integer,
  cook_time_minutes             integer,
  instructions                  text,
  calories_per_serving          numeric(9,2) not null,
  protein_per_serving_g         numeric(9,3) not null,
  carbs_per_serving_g           numeric(9,3) not null,
  fat_per_serving_g             numeric(9,3) not null,
  fibre_per_serving_g           numeric(9,3),
  saturated_fat_per_serving_g   numeric(9,3),
  sugar_per_serving_g           numeric(9,3),
  sodium_per_serving_mg         numeric(9,2),
  cuisine                       text,
  dietary_tags                  text[],
  ingredients                   jsonb not null default '[]'::jsonb,
  ingredient_count              integer not null default 0,
  verification                  jsonb,
  verified_at                   timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

alter table public.user_recipes drop constraint if exists user_recipes_nonneg_check;
alter table public.user_recipes add constraint user_recipes_nonneg_check
  check (
    servings > 0
    and calories_per_serving >= 0 and protein_per_serving_g >= 0
    and carbs_per_serving_g >= 0 and fat_per_serving_g >= 0
  );

create index if not exists user_recipes_user_name_idx
  on public.user_recipes (user_id, name);

drop trigger if exists user_recipes_set_updated_at on public.user_recipes;
create trigger user_recipes_set_updated_at
  before update on public.user_recipes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- diary_entries — extend the table that already exists
-- ---------------------------------------------------------------------------

create table if not exists public.diary_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ingredient_id uuid,
  name          text not null,
  amount        numeric(9,2) not null,
  unit          text not null default 'g',
  meal          text not null default 'Lunch',
  calories      numeric(9,2) not null default 0,
  protein       numeric(9,3) not null default 0,
  carbs         numeric(9,3) not null default 0,
  fat           numeric(9,3) not null default 0,
  date          date not null default (now() at time zone 'utc')::date,
  created_at    timestamptz not null default now()
);

alter table public.diary_entries add column if not exists recipe_id           uuid;
alter table public.diary_entries add column if not exists user_ingredient_id  uuid references public.user_ingredients(id) on delete set null;
alter table public.diary_entries add column if not exists user_recipe_id      uuid references public.user_recipes(id) on delete set null;
alter table public.diary_entries add column if not exists source              text not null default 'ingredient';
alter table public.diary_entries add column if not exists servings            numeric(8,3);
alter table public.diary_entries add column if not exists fibre               numeric(9,3) not null default 0;
alter table public.diary_entries add column if not exists notes               text;
alter table public.diary_entries add column if not exists updated_at          timestamptz not null default now();

-- AI-photo and recipe entries have no reference ingredient.
alter table public.diary_entries alter column ingredient_id drop not null;

alter table public.diary_entries drop constraint if exists diary_entries_source_check;
alter table public.diary_entries add constraint diary_entries_source_check
  check (source in ('ingredient','recipe','user_ingredient','user_recipe','ai_photo','manual'));

alter table public.diary_entries drop constraint if exists diary_entries_meal_check;
alter table public.diary_entries add constraint diary_entries_meal_check
  check (meal in ('Breakfast','Lunch','Dinner','Snacks'));

alter table public.diary_entries drop constraint if exists diary_entries_amount_check;
alter table public.diary_entries add constraint diary_entries_amount_check
  check (amount > 0 and calories >= 0 and protein >= 0 and carbs >= 0 and fat >= 0);

create index if not exists diary_entries_user_date_idx
  on public.diary_entries (user_id, date desc);

drop trigger if exists diary_entries_set_updated_at on public.diary_entries;
create trigger diary_entries_set_updated_at
  before update on public.diary_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null,
  content     text not null default '',
  estimate    jsonb,
  provider    text,
  model       text,
  image_path  text,
  created_at  timestamptz not null default now()
);

alter table public.chat_messages drop constraint if exists chat_messages_role_check;
alter table public.chat_messages add constraint chat_messages_role_check
  check (role in ('user','assistant'));

create index if not exists chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at);

-- ---------------------------------------------------------------------------
-- meal_photo_analyses — 30-day record of what a deleted photo contained
-- ---------------------------------------------------------------------------

create table if not exists public.meal_photo_analyses (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  chat_message_id  uuid references public.chat_messages(id) on delete set null,
  storage_path     text,
  description      text not null default '',
  analysis         jsonb,
  provider         text,
  model            text,
  image_deleted_at timestamptz,
  created_at       timestamptz not null default now(),
  purge_after      timestamptz not null default (now() + interval '30 days')
);

create index if not exists meal_photo_analyses_user_created_idx
  on public.meal_photo_analyses (user_id, created_at desc);
create index if not exists meal_photo_analyses_purge_idx
  on public.meal_photo_analyses (purge_after);

-- Added after both tables exist, so an older database that predates these
-- columns is upgraded without the statements running too early.
alter table public.chat_messages       add column if not exists model text;
alter table public.meal_photo_analyses add column if not exists model text;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.user_profiles       enable row level security;
alter table public.user_ingredients    enable row level security;
alter table public.user_recipes        enable row level security;
alter table public.diary_entries       enable row level security;
alter table public.chat_messages       enable row level security;
alter table public.meal_photo_analyses enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_profiles','user_ingredients','user_recipes',
    'diary_entries','chat_messages','meal_photo_analyses'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)',
      t || '_delete_own', t);
  end loop;
end;
$$;

-- public.ingredients and public.recipes are deliberately NOT touched by this
-- migration — not their columns, constraints, indexes, or RLS state. They are
-- already populated reference data and the app only ever reads from them.

-- ---------------------------------------------------------------------------
-- "My foods" — most recently logged distinct foods for the calling user
-- ---------------------------------------------------------------------------

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
