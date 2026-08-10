# NutriPilot v1 — Design Spec

Date: 2026-08-10
Status: Approved for implementation

## 1. Goal

Turn the current localStorage prototype into a production-ready, Play-Store-deployable
Capacitor app with a real Supabase backend, a dual-provider AI coach, a MyFitnessPal-style
diary, and user-owned ingredient/recipe libraries.

## 2. Verified starting state

Probed live on 2026-08-10 against `https://yhgkrbnmhgspgckvvfhe.supabase.co`:

| Fact | Value |
| --- | --- |
| `ingredients` rows | 2,463 (read-only reference) |
| `recipes` rows | 792 (read-only reference) |
| `diary_entries` | exists; columns `id, user_id, ingredient_id, name, amount, unit, meal, calories, protein, carbs, fat, date, created_at` |
| Other app tables | none |
| Storage buckets | none — `meal-photos` does not exist yet |
| Auth | email/password enabled, `mailer_autoconfirm: false` (confirmation email **required**) |
| Groq | key valid; only vision-capable model is `qwen/qwen3.6-27b` |
| Gemini | key valid; `gemini-2.5-flash` and `gemini-2.5-pro` available |

Frontend: React 19 + Vite 7 + TS 5.8, react-router 7, lucide-react, Vitest + Testing
Library. 8 pages, ~1,577 LOC, all personal data in `localStorage`.

## 3. Architecture

```
Capacitor shell (Android)
  └── React SPA
        ├── state/      AuthContext, AppDataContext, ThemeContext
        ├── services/   repositories — the only modules that touch Supabase
        ├── pages/      route-level screens
        └── components/ reusable UI primitives
              │
              ▼
        Supabase
          ├── Postgres  reference tables (read-only) + per-user tables (RLS)
          ├── Storage   meal-photos (private, per-user folder)
          └── Edge Fns  ai-chat · verify-food · delete-account · purge-meal-photos
                              │
                              ▼
                        AI boundary (server-side keys only)
                          Groq (primary) → Gemini (fallback)
```

**Dependency direction:** pages → repositories → Supabase. No page imports the Supabase
client directly. AI provider details never leave the Edge Function.

## 4. Data model

### 4.1 New / altered tables

`user_profiles` — one row per auth user. Body stats, goal mode, theme preference,
onboarding flag. PK `user_id` FK→`auth.users` ON DELETE CASCADE.

`diary_entries` — extended, not replaced:
`recipe_id`, `user_ingredient_id`, `user_recipe_id`, `source`
(`ingredient|recipe|user_ingredient|user_recipe|ai_photo|manual`), `servings`, `fibre`,
`notes`, `updated_at`. `ingredient_id` made nullable so AI-photo and recipe entries fit.

`user_ingredients` — user-authored foods. Same nutrition shape as `ingredients`
(per `basis_quantity` `basis_unit`) plus `verification` jsonb and `verified_at`.

`user_recipes` — user-authored recipes. Same per-serving nutrition shape as `recipes`
plus `ingredients` jsonb, `verification` jsonb.

`chat_messages` — AI coach history. `role`, `content`, `estimate` jsonb, `provider`,
`image_path` (nulled once the photo is deleted), `created_at`.

`meal_photo_analyses` — 30-day retention record of what a photo contained.
`description`, `analysis` jsonb, `storage_path`, `image_deleted_at`, `purge_after`.

**"My foods"** is derived from `diary_entries` (most recently logged distinct foods).
No table — deliberately avoids a redundant favourites store.

### 4.2 RLS

Every per-user table: `enable row level security` with four policies scoped to
`auth.uid() = user_id`. Storage: objects readable/writable only under
`meal-photos/{auth.uid()}/…`.

**`public.ingredients` and `public.recipes` are never touched** — not their columns,
constraints, indexes, or RLS state. They hold 2,463 and 792 populated rows and the app
only reads from them. Two constraints in their DDL shape the UI:
`ingredients.basis_quantity` is fixed at exactly 100, and `recipes.dietary_tags` must
carry exactly one base class (`vegan` | `vegetarian` | `pescatarian` | `omnivore`). The
user-recipe form mirrors that base-class rule so a user's own recipes tag consistently
with the reference set.

## 5. AI boundary

### 5.1 Provider chain

`callModel()` iterates `[groq, gemini]`. It advances to the next provider on 429, 402,
5xx, or a body containing `rate_limit` / `quota` / `insufficient` / `over capacity`.
A genuine 400 (bad request) throws immediately — falling back would just fail twice.
The response reports which provider answered so the UI can show it.

Groq: `qwen/qwen3.6-27b` (text + vision, 131k ctx).
Gemini: `gemini-2.5-flash` (`generateContent`).

### 5.2 Scope guard

A system prompt restricts the assistant to nutrition, diet, weight loss, muscle gain,
weight plateaus, and meal analysis, with an explicit instruction to decline and redirect
anything else in one short sentence. Applied identically to both providers so behaviour
does not change when fallback kicks in.

### 5.3 Photo flow

1. Client resizes to ≤1280px JPEG and uploads to `meal-photos/{uid}/{uuid}.jpg`.
2. Client calls `ai-chat` with the storage path.
3. Function signs a short-lived URL. Groq receives the URL; Gemini receives inline
   base64 (Gemini cannot fetch arbitrary URLs).
4. Model returns prose + a structured estimate.
5. Function **deletes the object from storage** and writes a `meal_photo_analyses` row
   holding the textual description for 30 days.
6. UI shows an editable estimate card — the user confirms or corrects every macro before
   anything is written to the diary.

`purge-meal-photos` deletes analyses past `purge_after` and sweeps orphaned objects.

### 5.4 Contributed-food verification

`verify-food` sends the submitted ingredient/recipe to the model and asks whether the
macros are physically plausible (4/4/9 kcal reconciliation, sane per-100g ranges) and
whether the recipe is real. Verdict `approved | needs_review | rejected` with reasons.
Client-side schema validation runs **first** — the AI never sees a payload with missing
required fields, and the AI is a plausibility gate, not the only gate.

## 6. Frontend

### 6.1 Navigation

Bottom nav (mobile, 5 items): Today · Diary · Recipes · Library · Coach.
Settings via the header avatar. Desktop keeps the sidebar with Settings and Goals added.

### 6.2 Screens

**Splash** — dark green (`#0B1F16`) full-bleed, the user's logo, minimum 900ms, native
Capacitor splash configured to the same colour so there is no flash between the two.

**Auth** — sign-up is the default screen after splash, sign-in one tap away. Handles the
`mailer_autoconfirm: false` reality with an explicit "check your inbox" state.

**Diary (Add food)** — segmented tabs: `Ingredients | Recipes | My foods`, plus
`+ Ingredient` and `+ Recipe` creation sheets. Portion editor with quick-pick amounts.

**Library** — the user's own ingredients and recipes, with verification badges,
edit/delete, and one-tap add to diary.

**Recipe detail** — servings stepper and per-ingredient scaling ("more beef, less rice"),
live-recalculated macros, then Add to diary.

**Coach** — chat with camera/gallery capture, provider badge, and an editable estimate
card that must be confirmed before it reaches the diary.

**Settings** — theme (System/Light/Dark), delete health data (granular + all), delete
account (typed confirmation), account info.

### 6.3 Theming

All colour values move into CSS custom properties defined on `:root`, overridden under
`[data-theme="dark"]` and `@media (prefers-color-scheme: dark)` when the preference is
`system`. No component reads a raw hex.

## 7. Error handling

Repositories throw typed errors; pages render inline, human-readable messages. Network
failures during diary writes queue nothing — the app reports the failure rather than
silently losing data. AI failures after both providers report which stage failed.

## 8. Testing

- Unit (Vitest): nutrition maths, recipe scaling, provider-fallback selection, food
  schema validation, theme resolution.
- Component: diary tabs, portion editor, estimate confirmation.
- Live integration: scripted calls against the deployed Edge Functions with a real test
  user, asserting Groq path, forced-Gemini fallback path, scope refusal, and photo
  delete-after-analysis.
- E2E (Playwright): splash → sign-up → log food → verify dashboard totals.

## 8.1 Delivery

Android is generated with `npx cap add android` and its launcher icons and splash are
produced from `assets/logo.png` by `@capacitor/assets`, so the native splash is the same
logo on the same `#0B1F16` green as the web splash. `launchAutoHide: false` hands the
splash over to React rather than letting it drop on a timer.

The finished project is pushed to `github.com/Mohamed-Y-Mohamed/NutriPilots`. `.env`,
`.env.deploy` and the generated `android/` directory are git-ignored; no key reaches the
repository.

## 9. Out of scope

Barcode scanning, water/exercise tracking, social features, iOS build, offline sync
queue, push notifications.

## 10. Known constraints

- Supabase provisioning requires a Personal Access Token; the publishable key cannot
  create tables, buckets, secrets, or deploy functions.
- Email confirmation is on, so a brand-new account cannot log food until confirmed.
- Groq exposes exactly one vision model, so photo analysis has no in-provider fallback —
  only the cross-provider one to Gemini.
