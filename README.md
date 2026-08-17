# NutriPilot

NutriPilot is a nutrition tracking application for the web and Android. It combines a food diary, recipe browsing, nutrition goals, account management and an AI-assisted coach backed by Supabase services.

Live: https://nutripilots.netlify.app

## Features

- Record food in a daily diary and manage meal entries.
- Browse recipes and view recipe details.
- Set and review nutrition goals.
- Create and manage an authenticated user account.
- Use an AI coach for nutrition-related conversations and meal-photo analysis.
- Add user-submitted ingredients and recipes through the application flow.
- Switch between light, dark and system themes.
- Delete account data through the application and public account-deletion flow.
- Run the same React application as an Android app through Capacitor.

## Tech stack

| Layer | Technology |
|---|---|
| UI | React 19, TypeScript, Tailwind CSS 4 |
| Routing | React Router 7 |
| Build | Vite 7 |
| Backend | Supabase |
| Android | Capacitor 8 |
| Unit tests | Vitest, Testing Library |
| End-to-end tests | Playwright |
| Linting | ESLint |

## Requirements

- Node.js and npm. The repository does not pin an exact Node.js version.
- A Supabase project when using a backend other than the public project configured in the source.
- Server-side provider credentials for the AI Edge Functions when deploying your own backend.
- JDK 21 and the Android toolchain for Android release builds.

## Installation

```bash
git clone https://github.com/Mohamed-Y-Mohamed/NutriPilots.git
cd NutriPilots
npm install
```

## Environment variables

Copy `.env.example` to `.env` when you want to override the public client configuration.

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
VITE_SITE_URL=https://your-site.example
```

| Variable | Required | Where to obtain it |
|---|---|---|
| `VITE_SUPABASE_URL` | Optional for the existing deployment | Supabase project settings |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Optional for the existing deployment | Supabase API settings |
| `VITE_SITE_URL` | Optional | URL of the deployed web application |

`VITE_` values are compiled into the browser bundle and are visible to users. Do not place private AI-provider credentials in them.

The deployment scripts and Supabase functions also support server-side values documented in `.env.example`, including `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `PURGE_SECRET`. Keep these server-side only.

## Running locally

```bash
npm run dev
```

Vite listens on its normal development port unless you override it.

## Building

```bash
npm run build
```

The production web build is written to `dist/`.

## Testing

```bash
npm test
npm run e2e
npm run lint
```

The repository contains Vitest unit tests and Playwright end-to-end tests.

## Deployment

`netlify.toml` configures the Netlify web build. Supabase schema and Edge Function deployment scripts are available through:

```bash
npm run supabase:deploy
npm run supabase:db
npm run supabase:functions
```

A live-backend verification script is also defined:

```bash
npm run verify:live
```

## Android

```bash
npm run cap:sync
npm run android:open
npm run android:build
```

The Android application ID is `com.nutripilots.app`. The current manifest requests `INTERNET` and `CAMERA`; broad image, video and legacy external-storage permissions are explicitly removed because existing-photo selection uses the Android photo picker.

## Licence

MIT. See [LICENSE](LICENSE).
