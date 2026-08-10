# NutriPilot

A mobile-first nutrition app: food diary, recipe library, user-authored food library, and an
AI coach that answers nutrition questions and estimates meals from photos.

React 19 · TypeScript · Vite 7 · Tailwind CSS 4 · Supabase · Capacitor 8 (Android)

---

## What it does

**Add food** — Search 2,463 reference foods or 792 recipes, or pick from foods you have logged
before, then set the portion and add it to breakfast, lunch, dinner or snacks. You can also add
your own ingredients and recipes here; every submission is checked by AI for physical
plausibility before it is saved, so nothing impossible gets in.

**Recipes** — Filter by diet or by ingredients you already have. On a recipe you can set how
many servings you ate and tell the app where you went heavier or lighter, and the macros follow.

**Coach** — Ask about food, weight loss, muscle gain or a plateau. Photograph a meal and the
coach estimates it; you correct anything wrong before it reaches your diary.

**Settings** — Light, dark or system theme. Delete any slice of your data, or your whole
account, permanently.

---

## Architecture

```
Capacitor (Android)
  └── React SPA
        ├── state/       AuthContext · ThemeContext · AppDataContext
        ├── services/    repositories — the only modules that touch Supabase
        ├── pages/       route-level screens
        └── components/  reusable UI
              │
              ▼
        Supabase
          ├── Postgres   reference tables (read-only) + per-user tables (RLS)
          ├── Storage    meal-photos (private, one folder per user)
          └── Edge Fns   ai-chat · submit-food · delete-account · purge-meal-photos
                              │
                              ▼
                        AI boundary (server-side keys only)
```

Pages never import the Supabase client directly, and no AI vendor detail exists outside the
Edge Functions. No API key other than the Supabase publishable key is ever shipped to a device.

### The AI model chain

Requests walk a chain of models. Within a provider it steps down through that provider's models
first, so one model running out of free quota costs a retry rather than the whole provider.

| Purpose | Chain |
| --- | --- |
| Chat and photos | Groq `llama-3.3-70b` → `gpt-oss-120b` → `qwen3.6-27b` (vision) → `gpt-oss-20b` → `llama-3.1-8b` → Gemini `2.5-flash` → `2.5-flash-lite` → `3.6-flash` |
| Food verification | OpenRouter free tier (`gpt-oss-20b` → `gemma-4-31b` → `nemotron-3-super` → `ling-3.0-tiny`) → Groq `llama-3.1-8b` |

Verification runs on a separate provider so adding a food never eats the quota the chat depends
on. Switching is **invisible** — the user is only ever told anything when every model on every
provider is exhausted, and then it says the daily limit is reached.

Requests with an image skip text-only models automatically. A 400 aborts the chain rather than
replaying a malformed request against every vendor.

Reasoning models are a trap here: left alone, `qwen3.6-27b` spends its entire output budget on a
`<think>` monologue and returns a truncated block instead of an answer. It is sent
`reasoning_effort: "none"`, its output is stripped of thought tags defensively, and a response
that is empty once stripped counts as a failure so the next model gets a turn.

### Meal photo lifecycle

1. The client resizes to ≤1280px JPEG and uploads to `meal-photos/{user_id}/…`.
2. `ai-chat` signs a short-lived URL and sends it to the model.
3. **The object is deleted from storage as soon as the request completes** — including when it
   fails.
4. A text record of what the photo contained is kept for 30 days, then purged by
   `purge-meal-photos`.

---

## Setup

```bash
npm install
cp .env.example .env        # add your Supabase URL + publishable key
npm run dev
```

### Provisioning Supabase

The schema, storage bucket, secrets and Edge Functions are already deployed to
`yhgkrbnmhgspgckvvfhe`. What follows is for a fresh project or a redeploy.

Creating tables, the storage bucket, function secrets, and deploying Edge Functions needs a
**Supabase Personal Access Token** — the publishable key cannot do any of it.

1. Generate one at <https://supabase.com/dashboard/account/tokens>.
2. Create `.env.deploy` (git-ignored):

```env
SUPABASE_ACCESS_TOKEN=sbp_...
SUPABASE_PROJECT_REF=yhgkrbnmhgspgckvvfhe
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=sk-or-v1-...
PURGE_SECRET=any-long-random-string
```

3. Run it:

```bash
npm run supabase:deploy        # migrations + secrets + all four functions
npm run supabase:db            # migrations only
npm run supabase:functions     # functions only
```

The migration is idempotent and **never touches `public.ingredients` or `public.recipes`** —
their columns, constraints, indexes and RLS state are left exactly as they are.

**Deploying by hand instead.** Without a token, run `npm run bundle:functions`: it writes
`supabase/manual/01-schema.sql`, `02-storage.sql` and self-contained copies of each Edge Function
under `supabase/manual/functions/`, generated from the real source so they cannot drift. Paste the
SQL into the Supabase SQL editor and each function into the dashboard's function editor (names
must match exactly). `purge-meal-photos` needs JWT verification switched **off** — it runs on a
schedule and is guarded by the `PURGE_SECRET` header instead.

### Verifying the live backend

```bash
npm run verify:live
```

Creates a throwaway confirmed user and asserts, against the real project: reference data reads,
profile round-trip, diary CRUD, the `recent_foods` RPC, RLS isolation, a private `meal-photos`
bucket, a real coach answer, an off-topic refusal, photo-deleted-after-analysis with a 30-day
record, and that food verification approves a real food while refusing an impossible one. It
deletes the test user afterwards.

---

## Android

The Android project is committed, so a clone can be opened in Android Studio directly.

```bash
npm run cap:sync        # build the web app and copy it into android/
npm run android:open    # open in Android Studio
npm run android:build   # assembleRelease
```

- Application ID `com.nutripilot.app`, minSdk 24, target/compile SDK 36.
- Launcher icons and splash are generated from `assets/logo.png` onto `#071F18` deep olive.
- `launchAutoHide: false` — the app hides the native splash itself once the session resolves, so
  there is no white flash and no half-drawn screen.
- Camera and photo-library permissions are declared; a device with no camera can still choose a
  photo.

To release: set a `versionCode`/`versionName` in `android/app/build.gradle`, add a signing
config, and `./gradlew bundleRelease` for the Play Console.

---

## Tests

```bash
npm test          # unit — nutrition maths, validation, theme resolution
npm run e2e       # Playwright, phone + desktop viewports
npm run lint
npm run build
```

---

## Nutrition disclaimer

Calorie targets, recipe nutrition and AI meal analysis are estimates for general information.
NutriPilot is not medical or dietetic advice. Packaged-food labels and a weighing scale are
better than any estimate when accuracy matters. The full terms are in the app, on the sign-up
screen and in Settings.
