# Releasing NutriPilot

Three things ship independently: the **web app** (Netlify), the **backend**
(Supabase schema + Edge Functions), and the **Android app** (Play Console).

Order matters. **Backend first, always.** The web and Android clients both talk
to the same Supabase project, and an Android release stays on a user's phone
until they choose to update — so the backend has to keep working for the version
already out there. A schema change that only the new client understands breaks
everyone who has not updated yet.

---

## Before any release

```bash
npm ci          # exactly the lockfile, not a resolved-fresh tree
npm run lint
npx tsc -b
npm test
npm run build
npm audit --omit=dev --audit-level=high
```

CI runs the same commands on every push to `main` (`.github/workflows/ci.yml`).
If CI is red, nothing ships.

---

## 1. Backend (Supabase)

```bash
npm run supabase:db          # migrations
npm run supabase:functions   # edge functions
npm run verify:live          # confirms the deployed backend answers correctly
```

Requires `.env.deploy` locally — `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`
and the AI provider keys. That file is gitignored and must stay that way.

**Migrations are one-way.** There is no down-migration and rolling one back on a
live database is not a plan. Every schema change must be readable by the client
version already in the wild:

- Adding a column or table is safe.
- Renaming or dropping is not — add the new one, ship clients that write both,
  and only drop the old one a release later, once no live client references it.

`supabase/migrations/` and `supabase/CURRENT_SCHEMA.md` are deliberately kept out
of the public repository, so a fresh clone cannot provision a database. They must
exist locally before running the commands above.

---

## 2. Web (Netlify)

Netlify builds from `main`. Pushing is the deploy:

```bash
git push origin main
```

`netlify.toml` sets the build command and pins Node 22. `public/_headers` carries
HSTS, CSP and the cache policy; `public/_redirects` hands unmatched paths to the
SPA so a refresh on `/goals` resolves instead of 404ing. Both are copied into
`dist/` untouched by Vite.

**Rollback:** Netlify → Deploys → pick the previous successful deploy →
*Publish deploy*. Takes seconds and needs no rebuild. This is the fastest
rollback of the three, so if something is wrong and you are unsure which layer
caused it, roll the web back first and diagnose after.

**Watch after publishing:** load the site signed out, sign in, open the diary,
send one coach message. Check the browser console is clean and that the build
stamp in Settings matches what you just shipped.

---

## 3. Android (Play Console)

Signing is read from `android/keystore.properties` — copy
`android/keystore.properties.example` and fill it in. That file and the keystore
itself are gitignored. **The upload key cannot be replaced by reissuing it.** Back
it up somewhere that is not this machine; losing it means losing the ability to
update the app.

Bump the version in `android/app/build.gradle` before building. Play rejects a
`versionCode` it has already seen:

```gradle
versionCode 5
versionName "1.5"
```

Then:

```bash
npm run android:bundle
```

That runs the web build, copies it into the Android project, and produces
`android/app/build/outputs/bundle/release/app-release.aab`. Upload that to Play
Console. `npm run android:build` produces an APK instead — useful for sideloading
a test build, not for Play.

**Roll out in stages** (20% → 50% → 100%). Play has no instant rollback: once
users have installed a build, the only fix is a *higher* versionCode with the
problem fixed. Halting a staged rollout stops it reaching anyone new, which is
why the staged part matters.

**Watch after each stage:** Play Console → Quality → Android vitals, for crash
rate and ANR rate against the previous release.

---

## Known gaps

Honest list of what this setup does not have, so nobody assumes otherwise:

- **No error tracking.** A render crash shows the in-app fallback and logs to the
  device console, and that is all — nothing is reported anywhere you can see.
  Sentry with release tagging is the obvious fix, and the error boundary in
  `src/components/ErrorBoundary.tsx` is where it would hook in.
- **No staging environment.** One Supabase project serves development and
  production, so a migration is tested against live data by definition.
- **No uptime or latency monitoring.** You find out the backend is down when
  someone tells you.
- **Backups are whatever the Supabase plan provides**, and a restore has never
  been rehearsed. An untested backup is a hope, not a backup.

None of these block a first launch. All of them are worth closing before the user
count is high enough that finding out late is expensive.
