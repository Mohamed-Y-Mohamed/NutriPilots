# Deploying NutriPilot to Supabase — by hand

Everything here is copy-paste. No CLI, no access token.

Project: `yhgkrbnmhgspgckvvfhe` → <https://supabase.com/dashboard/project/yhgkrbnmhgspgckvvfhe>

Work through the steps in order. Steps 1–3 take about five minutes; step 4 is the longest
because there are four functions to paste.

> **Nothing here touches `public.ingredients` or `public.recipes`.** Your 2,463 ingredients and
> 792 recipes are read-only to this app and no statement below alters their columns,
> constraints, indexes, or RLS state.

---

## Step 1 — Create the tables and security rules

1. Open **SQL Editor** → **New query**.
2. Copy the entire contents of [`supabase/manual/01-schema.sql`](supabase/manual/01-schema.sql).
3. Paste it in and press **Run**.

Expected result: `Success. No rows returned.`

This creates `user_profiles`, `user_ingredients`, `user_recipes`, `chat_messages`,
`meal_photo_analyses`; extends the existing `diary_entries`; turns on row level security with
four owner-only policies per table; and adds the `recent_foods` function that powers the
"My foods" tab.

It is idempotent — running it twice is harmless.

---

## Step 2 — Create the private photo bucket

1. **SQL Editor** → **New query**.
2. Paste all of [`supabase/manual/02-storage.sql`](supabase/manual/02-storage.sql).
3. **Run**.

**If it fails with a permissions error on `storage.objects`**, do it through the UI instead:

1. **Storage** → **New bucket**
   - Name: `meal-photos`
   - Public bucket: **off**
   - File size limit: `10 MB`
   - Allowed MIME types: `image/jpeg, image/png, image/webp`
2. **Storage** → **Policies** → `meal-photos` → **New policy** → *For full customization*, and add
   three policies, each for role `authenticated`:

   | Operation | Policy name | Expression |
   | --- | --- | --- |
   | SELECT | `meal_photos_select_own` | `bucket_id = 'meal-photos' AND (storage.foldername(name))[1] = auth.uid()::text` |
   | INSERT | `meal_photos_insert_own` | same expression, in the **WITH CHECK** box |
   | DELETE | `meal_photos_delete_own` | same expression |

---

## Step 3 — Add the AI keys as secrets

**Edge Functions** → **Secrets** → **Add new secret**. Add these four:

| Name | Value |
| --- | --- |
| `GROQ_API_KEY` | your Groq key (`gsk_…`) |
| `GEMINI_API_KEY` | your Google Gemini key |
| `OPENROUTER_API_KEY` | your OpenRouter key (`sk-or-v1-…`) |
| `PURGE_SECRET` | any long random string you invent — see step 5 |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically;
do not add them yourself.

> These keys only ever exist here. They are never sent to a phone or included in the app bundle.

---

## Step 4 — Deploy the four Edge Functions

For each function below: **Edge Functions** → **Deploy a new function** → **Via Editor**, set the
name **exactly** as written, delete the placeholder code, paste the file, and **Deploy**.

| # | Function name | Paste this file | JWT verification |
| --- | --- | --- | --- |
| 1 | `ai-chat` | [`supabase/manual/functions/ai-chat.ts`](supabase/manual/functions/ai-chat.ts) | **on** (default) |
| 2 | `submit-food` | [`supabase/manual/functions/submit-food.ts`](supabase/manual/functions/submit-food.ts) | **on** (default) |
| 3 | `delete-account` | [`supabase/manual/functions/delete-account.ts`](supabase/manual/functions/delete-account.ts) | **on** (default) |
| 4 | `purge-meal-photos` | [`supabase/manual/functions/purge-meal-photos.ts`](supabase/manual/functions/purge-meal-photos.ts) | **OFF** — see below |

The name must match exactly; the app calls these by name.

**`purge-meal-photos` only:** after deploying, open the function → **Details** → turn
**Enforce JWT verification** *off*. It runs on a schedule with no signed-in user and is protected
by the `PURGE_SECRET` header instead.

These four files are generated from the real source (`npm run bundle:functions`) with the shared
modules inlined, because the dashboard editor has no `_shared` folder.

---

## Step 5 — Schedule the 30-day photo cleanup (optional but recommended)

Meal photos are deleted the instant analysis finishes, so this is a safety net: it purges the
30-day text records and sweeps any orphan left by a crashed request.

**SQL Editor** → run this once, replacing `YOUR_PURGE_SECRET` with the value from step 3:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'nutripilot-purge-meal-photos',
  '0 3 * * *',                       -- 03:00 every day
  $$
  select net.http_post(
    url     := 'https://yhgkrbnmhgspgckvvfhe.supabase.co/functions/v1/purge-meal-photos',
    headers := '{"Content-Type":"application/json","x-purge-secret":"YOUR_PURGE_SECRET"}'::jsonb
  );
  $$
);
```

Check it later with `select * from cron.job;`.

---

## Step 6 — Confirm it all landed

**SQL Editor** → run [`supabase/manual/03-verify.sql`](supabase/manual/03-verify.sql).

You should get nine rows, every one saying **PASS**:

```
1. tables created                 PASS   6 of 6
2. row level security enabled     PASS   6 of 6
3. per-user policies (4 each)     PASS   24 of 24
4. diary_entries extended         PASS   fibre, notes, recipe_id, …
5. model/provider columns         PASS   4 of 4
6. recent_foods RPC               PASS   recent_foods
7. meal-photos bucket, private    PASS   private, 10 MB
8. storage policies               PASS   3 of 3
9. reference data untouched       PASS   2463 ingredients, 792 recipes
```

Any `FAIL` tells you which step to redo.

---

## Step 7 — Try it end to end

```bash
npm run dev
```

1. Create an account. **Check your inbox** — email confirmation is switched on for this project,
   so you must click the link before you can sign in.
2. **Goals** → fill in your stats → Save. You should get a calorie target.
3. **Add food** → search `chicken` → pick one → set 150g → Add to diary. It should appear on
   Today.
4. **Coach** → ask *"how much protein should I eat to build muscle?"* → you should get a real
   answer within a few seconds.
5. **Coach** → ask *"write me a python function"* → it should politely refuse and steer you back
   to nutrition.
6. **Coach** → camera icon → photograph any meal → you should get an editable estimate → adjust a
   number → **Confirm & log** → it lands on Today.
7. **Add food** → *Add ingredient* → enter a real food → **Verify and save**. Then try one with
   nonsense numbers (900 kcal per 100 g of lettuce) — it should be refused.
8. **Settings** → switch the theme → it should change instantly and survive a reload.

### If something fails

Open **Edge Functions** → the function → **Logs**. The functions log the model chain, so you will
see lines like:

```
[ai] groq/qwen/qwen3.6-27b failed: groq 429: ... retryable=true
```

which means that model was out of quota and the chain moved on — that is normal and invisible to
the user. You only ever see a message in the app when **every** model on **every** provider is
exhausted, and then it says the daily limit has been reached.

| Symptom | Cause |
| --- | --- |
| "Please sign in to use the AI coach." | JWT verification is on but the app has no session — sign in again. |
| "The AI coach is unavailable right now." | A secret in step 3 is missing or misspelled. |
| "You have reached today's AI limit." | Genuinely all models exhausted. Resets daily. |
| Photo upload fails | Step 2 did not complete — check the bucket exists and is private. |
| "Could not save: new row violates row-level security" | Step 1 did not complete. Re-run it. |

---

## Later: switching to the automated path

Once you generate a Supabase access token at
<https://supabase.com/dashboard/account/tokens>, everything above collapses to one command:

```bash
# .env.deploy
SUPABASE_ACCESS_TOKEN=sbp_...
SUPABASE_PROJECT_REF=yhgkrbnmhgspgckvvfhe
GROQ_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
PURGE_SECRET=...
```

```bash
npm run supabase:deploy   # migrations + secrets + all four functions
npm run verify:live       # proves the whole backend against the real project
```

`verify:live` creates a throwaway user and asserts the diary, RLS isolation, the private bucket, a
real coach answer, an off-topic refusal, photo-deleted-after-analysis with a 30-day record, and
that food verification approves a real food while refusing an impossible one — then deletes the
test user. It is the only way to *prove* the backend works rather than assume it.
