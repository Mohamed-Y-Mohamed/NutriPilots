-- NutriPilot — let a daily target come from somewhere other than the formula.
--
-- Targets have always been derived from body stats: Mifflin–St Jeor, activity
-- multiplier, goal adjustment, fixed macro split. That is a good starting
-- point and a bad final answer. Someone who has eaten at their calculated
-- target for six weeks without moving needs a different number, and the person
-- who tells them so may be the coach, their dietitian, or their trainer.
--
-- So the figures become overridable. Null throughout means "whatever the
-- formula says", which is what every existing row means today and why no
-- backfill is needed.
--
-- targets_source records who last set them, purely so the app can say
-- "calculated from your details" or "you set these on 20 Aug" rather than
-- presenting a number with no provenance.

alter table public.user_profiles add column if not exists target_calories  numeric(9,2);
alter table public.user_profiles add column if not exists target_protein_g numeric(9,2);
alter table public.user_profiles add column if not exists target_carbs_g   numeric(9,2);
alter table public.user_profiles add column if not exists target_fat_g     numeric(9,2);
alter table public.user_profiles add column if not exists target_fibre_g   numeric(9,2);
alter table public.user_profiles add column if not exists targets_source   text;
alter table public.user_profiles add column if not exists targets_set_at   timestamptz;

alter table public.user_profiles drop constraint if exists user_profiles_targets_source_check;
alter table public.user_profiles add constraint user_profiles_targets_source_check
  check (targets_source is null or targets_source in ('coach', 'manual'));

-- The same floors the coach is told about, enforced where they cannot be
-- talked around. A model that ignores its instructions, or a typo in the
-- manual editor, must not be able to write a 400 kcal daily target.
alter table public.user_profiles drop constraint if exists user_profiles_target_range_check;
alter table public.user_profiles add constraint user_profiles_target_range_check
  check (
    target_calories is null
    or (target_calories >= 1000 and target_calories <= 8000)
  );

alter table public.user_profiles drop constraint if exists user_profiles_target_macros_check;
alter table public.user_profiles add constraint user_profiles_target_macros_check
  check (
    coalesce(target_protein_g, 0) >= 0 and coalesce(target_protein_g, 0) <= 1000
    and coalesce(target_carbs_g, 0) >= 0 and coalesce(target_carbs_g, 0) <= 2000
    and coalesce(target_fat_g,   0) >= 0 and coalesce(target_fat_g,   0) <= 1000
    and coalesce(target_fibre_g, 0) >= 0 and coalesce(target_fibre_g, 0) <= 300
  );
