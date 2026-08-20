-- NutriPilot — make diary_entries store the numbers it says it stores.
--
-- 20260810120000 declares amount, calories and the macros as numeric, but it
-- creates the table with `create table if not exists` over a table that already
-- existed. On any project deployed before that migration the declaration was
-- never applied: `create table if not exists` skips the whole statement when the
-- table is there, and `add column if not exists` only ever adds a column — it
-- never re-types one. So the file has said `numeric` while the database held
-- `integer` ever since.
--
-- Nothing noticed, because every path that logged food rounded calories to a
-- whole number on the way in (Math.round in scaleIngredient/scaleRecipe). The
-- itemised photo estimate is the first writer to send a real fraction, and it
-- fails with:
--
--   invalid input syntax for type integer: "733.1"
--
-- Rounding in the client would hide that rather than fix it, and the next
-- fractional writer would hit it again. This re-types the columns instead, so
-- the schema and the database finally agree.
--
-- Idempotent: a column already holding the right type is left alone, so this is
-- a no-op on a fresh project and re-running it costs nothing. Widening integer
-- to numeric preserves every existing value exactly.

do $$
declare
  wanted record;
  actual text;
begin
  for wanted in
    select * from (values
      ('amount',   'numeric(9,2)'),
      ('calories', 'numeric(9,2)'),
      ('protein',  'numeric(9,3)'),
      ('carbs',    'numeric(9,3)'),
      ('fat',      'numeric(9,3)'),
      ('fibre',    'numeric(9,3)'),
      ('servings', 'numeric(8,3)')
    ) as t(name, want)
  loop
    select format_type(a.atttypid, a.atttypmod)
      into actual
      from pg_attribute a
     where a.attrelid = 'public.diary_entries'::regclass
       and a.attname = wanted.name
       and a.attnum > 0
       and not a.attisdropped;

    -- A column the table does not have is not this migration's business.
    if actual is null then
      continue;
    end if;

    if actual <> wanted.want then
      execute format(
        'alter table public.diary_entries alter column %I type %s using %I::%s',
        wanted.name, wanted.want, wanted.name, wanted.want
      );
      raise notice 'diary_entries.% was %, now %', wanted.name, actual, wanted.want;
    end if;
  end loop;
end $$;

-- The amount/calories check is unaffected by the type change, but it is cheap
-- to restate and it documents what the columns are allowed to hold.
alter table public.diary_entries drop constraint if exists diary_entries_amount_check;
alter table public.diary_entries add constraint diary_entries_amount_check
  check (amount > 0 and calories >= 0 and protein >= 0 and carbs >= 0 and fat >= 0);
