-- NutriPilot — per-user AI usage limits.
--
-- Two limits per user, both decided in one locked row:
--   a daily cap, so a month's AI budget cannot go in an afternoon;
--   a per-minute cap, so a burst cannot rate-limit the provider and surface as
--   a failure the user did nothing to cause.
--
-- Buckets are activities, not costs: "chat" covers coach messages and the dish
-- estimate, "vision" any call carrying an image, "verify" the plausibility
-- check run when a food is saved. A photo costs several times what a message
-- costs, and saving a batch of foods should not quietly cost someone their
-- conversation.
--
-- THE SHAPE OF THIS SCHEMA IS FIXED. Everything meant to change later changes
-- as data, not as DDL:
--   * new limits     update public.ai_plan_limits
--   * a new bucket   insert a row into public.ai_plan_limits
--   * a paid tier    insert its rows, then insert into public.user_plans
-- There is deliberately no CHECK constraint listing the bucket names or the
-- tier names, because that would turn adding one into a migration. The table is
-- the registry.
--
-- Idempotent, and safe to re-run over an earlier version of itself. Does NOT
-- touch public.ingredients or public.recipes.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- user_plans — which tier a user is on. Nothing sets it yet; it exists so that
-- adding a paid tier later is an insert rather than a schema change.
--
-- Deliberately its own table rather than a column on user_profiles: row level
-- security lets a user edit their own profile row, so a `plan` column there
-- could simply be rewritten to a paid tier from the client and every limit
-- below would be meaningless. This table has a read-own policy and no write
-- policy at all, so only the service role — a future payments webhook — can
-- grant a plan.
-- ---------------------------------------------------------------------------

create table if not exists public.user_plans (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  plan        text not null default 'free',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- No CHECK on `plan`: naming the tiers here would mean a migration to add one.
-- An unknown plan simply falls back to the free limits.
alter table public.user_plans drop constraint if exists user_plans_plan_check;

drop trigger if exists user_plans_set_updated_at on public.user_plans;
create trigger user_plans_set_updated_at
  before update on public.user_plans
  for each row execute function public.set_updated_at();

alter table public.user_plans enable row level security;

drop policy if exists user_plans_select_own on public.user_plans;
create policy user_plans_select_own on public.user_plans
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- ai_plan_limits — the registry. A row here is what makes a bucket exist, and
-- what its two caps are. Tune from the SQL editor without a redeploy:
--
--   update public.ai_plan_limits set daily_limit = 50, per_minute_limit = 2
--    where plan = 'free' and call_type = 'chat';
-- ---------------------------------------------------------------------------

create table if not exists public.ai_plan_limits (
  plan              text not null,
  call_type         text not null,
  daily_limit       integer not null,
  per_minute_limit  integer not null default 1,
  updated_at        timestamptz not null default now(),
  primary key (plan, call_type)
);

-- For a database created by an earlier version of this file.
alter table public.ai_plan_limits
  add column if not exists per_minute_limit integer not null default 1;
alter table public.ai_plan_limits drop constraint if exists ai_plan_limits_call_type_check;

alter table public.ai_plan_limits drop constraint if exists ai_plan_limits_positive_check;
alter table public.ai_plan_limits add constraint ai_plan_limits_positive_check
  check (daily_limit > 0 and per_minute_limit > 0);

-- Only the free tier is seeded. A paid tier is a later insert, and until one
-- exists every user resolves to these numbers.
insert into public.ai_plan_limits (plan, call_type, daily_limit, per_minute_limit) values
  ('free', 'chat',   35, 1),
  ('free', 'vision', 8,  1),
  ('free', 'verify', 30, 1)
on conflict (plan, call_type) do update
  set daily_limit      = excluded.daily_limit,
      per_minute_limit = excluded.per_minute_limit,
      updated_at       = now();

-- Any tier rows left by an earlier version of this file are removed, so the
-- seeded free numbers are the only ones in force until a paid tier is added
-- deliberately.
delete from public.ai_plan_limits where plan <> 'free';

-- Row level security with no policies at all: without it a table in `public` is
-- writable by any signed-in user through PostgREST, which would let anyone
-- raise their own limits. The functions below are security definer and owned by
-- the table owner, so they still read it.
alter table public.ai_plan_limits enable row level security;

-- ---------------------------------------------------------------------------
-- ai_usage_daily — per-user, per-day, per-bucket counters, plus the rolling
-- minute window. The day is the UTC calendar day everywhere, so the reset
-- instant is the same for everyone.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_usage_daily (
  user_id       uuid not null references auth.users(id) on delete cascade,
  usage_date    date not null default (now() at time zone 'utc')::date,
  call_type     text not null,
  count         integer not null default 0,
  -- The burst window lives on this row rather than in a table of its own: the
  -- daily check already locks the row, so the minute counter comes along for
  -- free — no second table, no second lock, no second round trip.
  window_start  timestamptz not null default date_trunc('minute', now()),
  window_count  integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (user_id, usage_date, call_type)
);

alter table public.ai_usage_daily
  add column if not exists window_start timestamptz not null default date_trunc('minute', now());
alter table public.ai_usage_daily
  add column if not exists window_count integer not null default 0;
alter table public.ai_usage_daily drop constraint if exists ai_usage_daily_call_type_check;

alter table public.ai_usage_daily drop constraint if exists ai_usage_daily_count_check;
alter table public.ai_usage_daily add constraint ai_usage_daily_count_check
  check (count >= 0 and window_count >= 0);

create index if not exists ai_usage_daily_user_date_idx
  on public.ai_usage_daily (user_id, usage_date);

alter table public.ai_usage_daily enable row level security;

drop policy if exists ai_usage_daily_select_own on public.ai_usage_daily;
create policy ai_usage_daily_select_own on public.ai_usage_daily
  for select to authenticated using (auth.uid() = user_id);

-- No insert/update/delete policy for regular users. Every write goes through
-- the security definer functions below, so a user cannot reset their own quota
-- by deleting or editing their own rows directly.

-- ---------------------------------------------------------------------------
-- Functions
--
-- Dropped before being created rather than replaced: `create or replace` cannot
-- change a function's OUT parameters, so replacing one that has gained a column
-- fails with "cannot change return type of existing function". Dropping first
-- makes this file re-runnable over any earlier version of itself.
-- ---------------------------------------------------------------------------

drop function if exists public.ai_daily_limit(text, text);
drop function if exists public.ai_limits(text, text);
drop function if exists public.ai_plan_for(uuid);
drop function if exists public.get_ai_usage(text);
drop function if exists public.try_increment_ai_usage(text);
drop function if exists public.release_ai_usage(uuid, text);
drop function if exists public.release_ai_usage(text);

-- The caps for one plan and bucket, falling back to the free tier when the plan
-- has no row of its own. Returns no row for a bucket that is not in the
-- registry, which is how the callers below detect an unknown one.
create function public.ai_limits(p_plan text, p_call_type text)
returns table(daily_limit integer, per_minute_limit integer)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exact.daily_limit, free.daily_limit),
         coalesce(exact.per_minute_limit, free.per_minute_limit)
  from (select 1) one
  left join public.ai_plan_limits exact
    on exact.plan = p_plan and exact.call_type = p_call_type
  left join public.ai_plan_limits free
    on free.plan = 'free' and free.call_type = p_call_type
  where exact.plan is not null or free.plan is not null;
$$;

-- The tier this user is on, or the free one. A function so both callers resolve
-- it identically.
create function public.ai_plan_for(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.plan from public.user_plans p where p.user_id = p_user_id), 'free');
$$;

-- ---------------------------------------------------------------------------
-- get_ai_usage — read-only. Called on Coach page load so the banner has real
-- numbers before the user has sent anything.
-- ---------------------------------------------------------------------------

create function public.get_ai_usage(p_call_type text)
returns table(used integer, daily_limit integer, resets_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_today   date := (now() at time zone 'utc')::date;
  v_limit   integer;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select l.daily_limit into v_limit
  from public.ai_limits(public.ai_plan_for(v_user_id), p_call_type) l;

  if v_limit is null then
    raise exception 'Unknown AI call type.';
  end if;

  return query
  select
    coalesce(
      (select u.count from public.ai_usage_daily u
        where u.user_id = v_user_id
          and u.usage_date = v_today
          and u.call_type = p_call_type),
      0
    ),
    v_limit,
    -- Midnight UTC tomorrow, as an instant. The date is cast to a naive
    -- timestamp first so `at time zone 'utc'` reads it as UTC rather than as
    -- whatever the session timezone happens to be.
    ((v_today + 1)::timestamp at time zone 'utc');
end;
$$;

-- ---------------------------------------------------------------------------
-- try_increment_ai_usage — the atomic "may I make this call?" check. It only
-- increments when the call is actually allowed, so a rejected attempt never
-- counts against the user, and it distinguishes the two refusals: out for the
-- day, or too many in the last minute.
-- ---------------------------------------------------------------------------

create function public.try_increment_ai_usage(p_call_type text)
returns table(
  allowed      boolean,
  used         integer,
  daily_limit  integer,
  resets_at    timestamptz,
  reason       text,
  retry_after  integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid := auth.uid();
  v_today     date := (now() at time zone 'utc')::date;
  v_minute    timestamptz := date_trunc('minute', now());
  v_limit     integer;
  v_burst     integer;
  v_count     integer;
  v_window    timestamptz;
  v_in_window integer;
  v_allowed   boolean := false;
  v_reason    text := 'ok';
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select l.daily_limit, l.per_minute_limit into v_limit, v_burst
  from public.ai_limits(public.ai_plan_for(v_user_id), p_call_type) l;

  if v_limit is null then
    raise exception 'Unknown AI call type.';
  end if;

  -- Creates today's row on the first call of the day, and locks it either way:
  -- the no-op `do update` is what takes the row lock, so two requests arriving
  -- together from the same user cannot both read the same count and both be
  -- allowed through on the last remaining call.
  insert into public.ai_usage_daily as u
    (user_id, usage_date, call_type, count, window_start, window_count)
  values (v_user_id, v_today, p_call_type, 0, v_minute, 0)
  on conflict (user_id, usage_date, call_type) do update
    set updated_at = u.updated_at
  returning u.count, u.window_start, u.window_count
  into v_count, v_window, v_in_window;

  -- A window from an earlier minute has already expired.
  if v_window is distinct from v_minute then
    v_in_window := 0;
  end if;

  if v_count >= v_limit then
    v_reason := 'daily';
  elsif v_in_window >= v_burst then
    v_reason := 'burst';
  else
    v_allowed := true;
    update public.ai_usage_daily as u
       set count        = u.count + 1,
           window_start = v_minute,
           window_count = v_in_window + 1,
           updated_at   = now()
     where u.user_id = v_user_id
       and u.usage_date = v_today
       and u.call_type = p_call_type
    returning u.count into v_count;
  end if;

  return query select
    v_allowed,
    v_count,
    v_limit,
    ((v_today + 1)::timestamp at time zone 'utc'),
    v_reason,
    -- Seconds until the burst window rolls over. Meaningless for a daily
    -- refusal, where resets_at is the number that matters.
    case when v_reason = 'burst'
      then greatest(1, ceil(extract(epoch from (v_minute + interval '1 minute' - now())))::integer)
      else 0
    end;
end;
$$;

-- ---------------------------------------------------------------------------
-- release_ai_usage — refunds one call. Used only when try_increment_ai_usage
-- allowed an attempt that then produced nothing: every AI provider exhausted,
-- or a photo that could not be read. A server-side fault must never cost the
-- user a real call.
--
-- It takes the user id explicitly and is callable ONLY by the service role. If
-- it read auth.uid() and were granted to `authenticated`, anyone could call it
-- in a loop from the browser and zero their own counter, which would make the
-- whole limiter decorative.
--
-- The minute window is given back too, so a failed call does not also cost the
-- user the following minute.
-- ---------------------------------------------------------------------------

create function public.release_ai_usage(p_user_id uuid, p_call_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_usage_daily as u
     set count        = greatest(u.count - 1, 0),
         window_count = greatest(u.window_count - 1, 0),
         updated_at   = now()
   where u.user_id = p_user_id
     and u.usage_date = (now() at time zone 'utc')::date
     and u.call_type = p_call_type;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- Every one of these has to be revoked before the intended grant means
-- anything, and revoking from PUBLIC alone is not enough. Postgres grants
-- EXECUTE to PUBLIC on any new function, and a Supabase project additionally
-- carries `alter default privileges in schema public grant all on functions to
-- anon, authenticated, service_role`. That second one is an EXPLICIT grant to
-- those roles, and `revoke ... from public` does not remove an explicit grant —
-- so anon and authenticated are named here as well.
--
-- Verified against the live project: without naming them, release_ai_usage
-- answered a call made with nothing but the app's publishable key, which would
-- have let anyone refund their own counter in a loop and ignore the limits.
-- ---------------------------------------------------------------------------

revoke all on function public.ai_limits(text, text)        from public, anon, authenticated;
revoke all on function public.ai_plan_for(uuid)            from public, anon, authenticated;
revoke all on function public.get_ai_usage(text)           from public, anon;
revoke all on function public.try_increment_ai_usage(text) from public, anon;
revoke all on function public.release_ai_usage(uuid, text) from public, anon, authenticated;

grant execute on function public.get_ai_usage(text)           to authenticated;
grant execute on function public.try_increment_ai_usage(text) to authenticated;
grant execute on function public.release_ai_usage(uuid, text) to service_role;
