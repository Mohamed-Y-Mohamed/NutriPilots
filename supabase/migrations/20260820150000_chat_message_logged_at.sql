-- NutriPilot — remember that an estimate has already been added to the diary.
--
-- A photo estimate is stored on the assistant's chat message, and the card
-- under that message offers to log it. Whether the user had accepted lived
-- only in React state, so it survived exactly as long as the screen did.
--
-- Reopen the app and the card came back offering the same meal again, with no
-- sign it had ever been taken. Tapping it twice logged the meal twice, and the
-- second copy is indistinguishable from a real one — the user has to work out
-- from the calorie total that a day they logged correctly is now wrong.
--
-- One nullable timestamp fixes it. Null means never logged, which is what every
-- existing row means, so nothing needs backfilling.

alter table public.chat_messages add column if not exists logged_at timestamptz;

comment on column public.chat_messages.logged_at is
  'When the user added this message''s estimate to their diary. Null if they never did.';
