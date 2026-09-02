# NutriPilot — launch video

Script, storyboard and shot list. One asset set, one master narrative, four cuts.

Status: **assets captured, edit not started.**

- **Stills** — all 16 shots, phone and desktop, dark and light. 64 files.
- **Motion** — 7 clips, one per beat, phone and desktop, dark. Real interactions
  with a visible touch pointer. 14 files.
- Both regenerate from the app in one command each, so they can be reshot after
  any UI change rather than curated by hand.

```
npm run build && npm run preview -- --port 4173
node scripts/capture-marketing.mjs          # stills  -> 02-screens
node scripts/shoot-marketing.mjs            # motion  -> 02-motion
node scripts/refresh-marketing-recipes.mjs  # re-pull recipe fixtures
```

**Three things still block the edit, and all three need a human:**

1. **The plate photo.** `assets/marketing/plate.jpg` does not exist, so beats 1,
   2 and 5 currently show a black square where the meal should be. See §5.
2. **Recipe licensing.** Every recipe on screen is third-party, and one has no
   recorded licence at all. See §5.
3. **Music, and the 1024×500 Play feature graphic.** Both unchanged from below.

---

## 1. Positioning

Every calorie tracker is admin. Search, scroll, pick the wrong entry, guess the
portion, give up by Thursday.

**NutriPilot's angle: the logging disappears.** Photograph the plate, the macros
land. That is the entire pitch and it is the only thing the hook should say.

Everything else — 2,400+ foods, 790+ recipes, the coach, the targets — is proof
that arrives *after* the hook, never before it.

### Claims we can make

Taken from `src/pages/LandingPage.tsx`, where every claim is already backed by
shipped data. Do not invent numbers beyond these.

| Claim | Source |
|---|---|
| 2,400+ reference foods | Landing page, reference data |
| 790+ recipes | Landing page, recipe book |
| Photo → calories, protein, carbs, fat | `meal_photo_analyses`, Coach page |
| Add a food that is not listed — scan a label, scan a dish, or describe it | `AddIngredientSheet`, `user_ingredients` |
| Add a recipe that is not listed | `AddRecipeSheet`, `user_recipes` |
| The app says when the AI is unsure | "not fully confident" copy in both sheets |
| AI coach, plain English | `chat_messages`, Coach page |
| Targets from height/weight/activity/goal | Goals page |
| Web and Android, same app | Capacitor build |

**Not claimable:** user counts, ratings, "#1", pricing, weight-loss outcomes,
testimonials. None of it is knowable and all of it is a Play Store rejection
risk.

---

## 2. Art direction

The brand already has taste. Do not invent a second visual system for video —
pull straight from `src/styles.css` so the film and the app are obviously the
same product.

**Dark mode is the hero.** Near-black canvas, bright brand green, lime accent —
current, premium, and it makes food photography the only warm thing on screen.
That contrast is the whole look.

| Token | Value | Use in video |
|---|---|---|
| `--color-olive-deep` | `#040f0c` | Background field, letterbox |
| `--color-canvas` (dark) | `#0c0f0c` | Screen surround |
| `--color-brand` (dark) | `#35c79a` | Primary accent, UI highlights, key type |
| `--color-lime` | `#c9e86b` | Single accent — numbers hitting target only |
| `--color-ink` (dark) | `#ecefe9` | On-screen type |
| `--color-macro-protein` | `#17966f` | Macro bar, protein |
| `--color-macro-carbs` | `#c9e86b` | Macro bar, carbs |
| `--color-macro-fat` | `#d99a4f` | Macro bar, fat |

**Motion language — use the app's own curves.** These are already defined and
already the reason the UI feels deliberate. Reusing them is what makes the video
feel native rather than made in a template.

- Entrances / exits: `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out`)
- On-screen morphs: `cubic-bezier(0.77, 0, 0.175, 1)` (`--ease-in-out`)
- Anything sliding from an edge: `cubic-bezier(0.32, 0.72, 0, 1)` (`--ease-drawer`)

Never ease-in on a UI element. It starts slow at exactly the moment the eye
arrives.

**Numbers count up.** The app ships `src/lib/useCountUp.ts`. The video must do
the same — macro figures roll to their value, they do not cut to it. This is the
single detail that will read as "real product" rather than "mockup".

**Type:** two weights of one grotesque, and **one monospace for every number on
screen**, set with tabular figures. Macro values, calorie counts and timecodes
are data, and data wears mono — it stops digits jittering as they count up,
which is the one thing that would give the whole effect away. Tight tracking
(−2% to −3%) at display sizes. Hold every line long enough to read twice —
roughly 1s + 0.3s per word.

**Ink is never pure white.** `--color-ink` at `#ecefe9` is already correct —
`#ffffff` on near-black blooms under H.264 and reads harsh. Do not "fix" it.

### One tone, one flourish

Pick a single direction and commit — a blend reads as indecision. This one is
**clinical-warm**: near-black clinical surround, precise mono data, and food as
the only warm, organic thing in frame. That tension is the idea.

- **Hero flourish (one only):** the count-up. Macros resolving from a photo.
- **Supporting flourish (one only):** screens tilting in depth on the push-ins.
- Nothing else gets to move on its own. No particles, no shader background, no
  ambient drift. On a nutrition app they would read as decoration, and
  decoration is what makes motion graphics look templated.

### Macro palette — validated, not eyeballed

The macro tokens were run through the dataviz palette validator against their
own surfaces. Findings that change how the video is cut:

| Check | Dark | Light |
|---|---|---|
| Colourblind separation | **PASS** — worst pair ΔE 12.1 (deutan) | **PASS** — ΔE 14.7 |
| Chroma floor | PASS | PASS |
| Contrast vs surface | PASS, all ≥ 3:1 | **WARN** — carbs 1.34:1, fat 2.36:1 |
| Lightness band | **FAIL** — carbs `#a9c95a` at L 0.789 | **FAIL** — carbs `#c9e86b` at L 0.883 |

**What this means for the edit:**

1. **Always direct-label the macro bars.** The validator permits the lightness
   and contrast failures only with secondary encoding — a visible label beside
   the mark. The count-up numbers already do this job, so keep a number next to
   every bar in every frame where bars appear. Never a bare colour-only chart.
2. **Watch the lime under compression.** Carbs is the brightest element in the
   dark look, sitting on near-black. That is precisely the combination H.264
   banding and macroblocking punish. Cap it, grade it down slightly for video,
   and check the export at the delivery bitrate rather than in the timeline.
3. **Prefer the dark shots for any macro-bar close-up.** In light mode the lime
   bar is barely visible against the surface, which is exactly the moment the
   video is asking people to look at it.

> **Flagged, out of scope:** that light-mode 1.34:1 contrast is a real
> legibility problem in the shipped app, not only in the video. Worth raising
> separately. Not touched here.

**Grayscale check before locking the grade.** Desaturate the whole timeline —
if the macro bars stop being distinguishable, the edit is leaning on colour
alone and the labels are not doing enough.

**Screen treatment:** flat screenshots on a dark field, 3–6° tilt, subtle
depth-of-field falloff, slow push-in. No skeuomorphic phone bezels with glare —
that reads 2015. A thin `--color-line` edge and a soft contact shadow is enough.

---

## 3. Master narrative — 60s

This is the spine. Every other cut is a subset of these beats, never a
re-invention.

**Shape:** Hook → context → escalation → turn → resolution
**VO budget:** ~150 words. That is far less than it sounds.

| # | Time | Picture | Audio / text |
|---|---|---|---|
| 1 | 0:00–0:02 | **Cold open on the payoff.** Overhead of a real plate. A hand raises a phone into frame, already moving. Shutter. | Hard music start on frame 1. No logo. |
| 2 | 0:02–0:05 | Cut to phone screen: *"Reading your photo…"* Then macro figures **count up** — kcal, protein, carbs, fat — lime landing last. | VO: "Photograph the plate. That's the logging." |
| 3 | 0:05–0:09 | Pull back. The entry drops into the diary under Lunch. Day's totals recalculate live. | VO: "No searching. No guessing the portion." |
| 4 | 0:09–0:15 | **Context.** Diary scrolls — breakfast, lunch, snack filed. Cut to the search field: type three letters, 2,400+ foods filter under the cursor. | VO: "When you do want to search, there are 2,400 foods to search." |
| 5 | 0:15–0:23 | **The objection, answered.** Search returns nothing useful. Cut to the add sheet: *"Scan label or food"* → camera → fields fill themselves. Then the alternative: *"Describe it instead"*, typed in plain English. Hold one beat on the honesty line: *"The AI is not fully confident about these numbers."* | VO: "Not in there? Add it. Scan the label, or just describe it." |
| 6 | 0:23–0:30 | **Escalation.** Recipes grid. Open one. Drag a portion slider — nutrition recalculates ingredient by ingredient, numbers rolling. | VO: "790 recipes. Change any portion, the nutrition follows." |
| 7 | 0:30–0:40 | **The turn.** Coach screen. The real prompt types itself in: *"I have been the same weight for 3 weeks — what should I change?"* Answer streams back in plain English. | VO: "And when the scale stops moving, ask." |
| 8 | 0:40–0:47 | Goals screen. Height, weight, activity, target resolve into daily numbers. Cut to Dashboard: *"Energy left"* ring closing. | VO: "Targets built from you. Measured against everything you log." |
| 9 | 0:47–0:54 | Fast montage on beat — 5 or 6 screens, 12–16 frames each, all pushing the same direction. Light mode flashes once for range. | Music build. No VO. |
| 10 | 0:54–1:00 | Screens settle to one. Logo resolves. URL. *Web and Android.* | VO: "NutriPilot. Stop logging. Start eating." Then silence + logo hold 1.5s. |

### Why beat 5 sits exactly there

"My food isn't in it" is the single biggest reason people abandon a calorie
tracker, and it is the thought a viewer has *the instant* you show them a search
box in beat 4. Answering it one beat later — before they have finished forming
the objection — is worth more than any feature you could put in that slot.

Three ways in, and the beat should show all three because each kills a different
excuse: **scan the label** (packaged food), **scan the dish** (a recipe or a
plate), **describe it in words** (everything else). Land on the plain-English
one — *"Chicken curry with rice and a side salad. Serves 4."* — because that is
the one nobody expects to work.

Hold the *"not fully confident"* line for a full beat. Every competitor hides
model uncertainty; showing it reads as confidence, not weakness, and it is the
kind of detail people screenshot.

**Anti-patterns being avoided here:** no logo sting before the hook (beat 1 is
food, not branding), no slow fade from black, no feature list read aloud in
order, best material at 0:02 not 0:45.

---

## 4. The four cuts

All derived from the master. Shoot once, reframe in post.

### A. Landing page hero — 16:9, 20s loop, silent

Beats **1 → 2 → 3 → 6 → 9**. Drop all VO.

- **Silent by design.** No audio track at all in the file.
- Must **loop seamlessly** — last frame matches first. End on the same plate
  overhead the film opened on.
- On-screen type carries the meaning: three lines maximum across the whole loop.
- `muted`, `playsinline`, `preload="none"`, poster frame mandatory.
- **Keep it under 2MB.** A 12MB hero loop destroys mobile LCP and this is a
  nutrition app people open on phones.
- Deliver WebM/AV1 with H.264/MP4 fallback.

### B. Google Play listing + YouTube promo — 16:9, ~75s

**One asset, not two.** The Play listing promo video *is* a YouTube URL — there
is a single video slot, so the store listing and the YouTube promo are the same
file. It is hosted on YouTube and linked from Play.

The constraint that shapes the whole edit: **Play autoplays only the first 30
seconds, muted, inline.** After that the viewer must tap to keep watching. So
this is not a 75-second film — it is a **complete 30-second film with a 45-second
reward attached.**

- **0:00–0:30 — must stand alone.** Beats 1 → 2 → 3 → 4 → 5. Someone who never
  taps has still seen the whole pitch: photo-to-macros, the diary, the search,
  and "not in there? add it". Beat 5 matters most here — Play traffic is people
  comparing trackers, and "does it have my food" is the comparison they are
  running.
- **0:30–1:15 — the reward.** Beats 6 → 7 → 8 → 9 → 10. Recipes, the coach, the
  targets, the resolve. Slightly more generous holds; this audience chose to be
  here.

**Play requirements, checked against current guidance:**

| Requirement | Setting |
|---|---|
| Hosting | YouTube video URL — not a playlist or channel link, no extra params, not shortened |
| Visibility | Public or unlisted, and embedding must be enabled |
| Monetisation | **Off.** Ads disqualify the video from showing |
| Age restriction | None, or it will not display |
| Orientation | Landscape 1920×1080. Portrait risks black bars in the listing |
| Authenticity | ≥80% genuine in-app footage; real UI within the first 10s |
| Prohibited | "#1"-style claims, direct CTAs, pricing, unlicensed third-party assets |

- **A feature graphic is a hard dependency.** Play will not show a promo video
  without a 1024×500 feature graphic — the play button is overlaid on it. **Keep
  the centre clear of text or logo**, because the button lands there. This does
  not exist yet; see §5.
- Captions burned in and manually corrected — auto-captions mangle "NutriPilot",
  and that is the one word that matters.

> **Worth knowing before committing:** adding a promo video shrinks the portrait
> screenshots in the listing and measurably reduces gallery scroll rate. A
> mediocre video is worse than no video. If this one is not excellent, ship the
> screenshots alone and add the video later.

### C. Social — 9:16, 20s

Beats **1 → 2 → 7 → 10**, everything else cut.

- **Hook in 1 second.** Open mid-shutter. The macros must be counting up by
  0:02 or it is dead.
- Shoot 16:9 with a 9:16 safe zone so this is a reframe, not a reshoot.
- **Centre-safe:** platform UI eats roughly the top 12% and bottom 20%. Nothing
  meaningful in either band.
- Captions burned in, large, high contrast.
- Produce **three alternate hooks** on the same body — the plate, the coach
  question, and the "same weight for 3 weeks" line as a cold text open. Cheap to
  make, and hook is the only variable that matters on cold traffic.

### D. Product Hunt — 16:9, 60s

The master film as written, with VO. **This is a re-cut of B, not a new shoot** —
same footage, same VO, trimmed to 60s.

What changes is what Play forbids and Product Hunt expects:

- A **direct CTA** is allowed and should be there. Play prohibits one.
- Pricing and positioning can be spoken. Play prohibits both.
- No 30-second front-load constraint — this audience watches linearly, so the
  beats can breathe in their written order.
- Beat 8 (Goals/targets) earns its place here and in B's reward half only.
- Mix: VO −12 to −6 dBFS peaks, music ducked 15–20 dB under it, master ≈ −14 LUFS.

---

## 5. Shot list — captured

All sixteen exist, in `02-screens`. Captured at two viewports so both ratios
come from one pass:

- **Desktop** 1920×1080 @2× (16:9 master)
- **Phone** 390×844 @3× → 1170×2532 files (9:16)

> The phone viewport is **390 logical pixels, not 1080**. The app's desktop
> breakpoint sits below 1080, so capturing at the delivery resolution renders
> the *desktop* layout at phone dimensions. The first pass made exactly this
> mistake and all 28 files were unusable.

Both in **dark** (hero) and **light** (one flash in beat 8).

| # | Screen | State needed | Used in beat |
|---|---|---|---|
| S1 | Coach | Photo attached, *"Reading your photo…"* visible | 2 |
| S2 | Coach | Analysis returned, macro breakdown shown | 2 |
| S3 | Diary | Populated day — breakfast, lunch, snack, totals | 3, 4 |
| S4 | Diary | Food search open, partial query, results filtered | 4 |
| S5 | Recipes | Grid, populated | 6 |
| S6 | Recipe detail | Portion control mid-drag, nutrition visible | 6 |
| S7 | Coach | The "3 weeks" conversation, answer rendered | 7 |
| S8 | Goals | Targets resolved to daily numbers | 8 |
| S9 | Dashboard | *"Energy left"* ring partially closed | 8, 9 |
| S10 | Landing | Hero, dark | 9, 10 |
| S11 | Diary | Search with **no useful result** — sets up the objection | 5 |
| S12 | Add ingredient sheet | Empty, *"Scan label or food"* affordance visible | 5 |
| S13 | Add ingredient sheet | *"Reading photo…"* mid-scan | 5 |
| S14 | Add ingredient sheet | Fields auto-filled from the scan | 5 |
| S15 | Add ingredient sheet | *"The AI is not fully confident about these numbers."* | 5 |
| S16 | Add recipe sheet | *"Describe it instead"* with the plain-English example typed | 5 |

S1, S2, S4 and S11–S16 are UI states, not data states, so a URL cannot reach
them. `capture-marketing.mjs` drives each one through a per-shot `prepare(page)`
hook — opening sheets, typing queries, attaching photos, holding loading states
open. Nine of the sixteen shots need it.

**Two states are behind affordances that are easy to miss:**

- The portion steppers (S6) do not exist in the DOM until **"Cooked it
  differently?"** is tapped. A plain screenshot of the recipe route shows a page
  with nothing adjustable on it.
- **"Reading your photo…"** (S1) only renders while a send is in flight.
  Attaching a photo is not enough — it has to be sent, and the composer needs
  text first, because the send button carries `aria-disabled` while empty.

### Motion — `02-motion`

Seven clips, one per beat, in `shoot-marketing.mjs`. These are the answer to
"not stale images": real interactions, recorded, with a soft ring standing in
for a finger — it moves along an eased path and scales on press, so the footage
reads as someone using the app rather than the UI operating itself.

| Clip | Beats | What happens |
|---|---|---|
| `B02-photo-to-macros` | 1–3 | Photo attached, sent, "Reading your photo…", itemised estimate with Add to diary |
| `B04-diary-and-search` | 4 | Day scrolled, tab to Add food, search typed and filtering |
| `B05-not-in-there` | 5 | Genuine search miss → scan → fields fill → "not fully confident" |
| `B06-recipes-and-portion` | 6 | Grid scrolled, card tapped, adjustments opened, portions raised |
| `B07-coach-turn` | 7 | The "3 weeks" question typed and answered |
| `B08-targets-and-ring` | 8 | Goals scrolled, tab to Today, rings counting up |
| `B09-montage` | 9 | Thumbed through the tab bar, five screens |

Clips run roughly double what the cut needs — trimming is free, discovering the
pointer left frame half a second early is a reshoot.

**Navigation is by tapping, never `page.goto`.** A goto reloads the SPA and
replays the splash screen mid-clip, which reads as the app restarting.

**What this cannot shoot: a human hand.** A real hand holding a real phone is
live action — a camera and a person, or a licensed stock clip. The pointer is a
stand-in, not a substitute. If hands are wanted in the film, they are shot the
same day as the plate in beat 1.

**Every screen must be populated.** Empty states are fatal in a marketing video
— and the existing e2e helper (`e2e/landing-signed-in.spec.ts`) seeds a session
but mocks `/rest/v1/**` with `[]`, so it produces exactly the empty screens we
cannot use.

### Capture options

| | Seeded Playwright capture | Live account via browser |
|---|---|---|
| Effort | Half a day — write realistic fixtures for 8 tables | An hour, mostly manual data entry |
| Data realism | Fabricated but controllable and pretty | Genuinely real |
| Repeatable | Yes — rerun after any UI change | No, manual every time |
| Play Store safety | Fine, it is the real UI with demo data | Fine |
| Risk | Fixtures drift from real schema | Account may hold private data |

Tables needing fixtures for the Playwright route: `diary_entries`,
`ingredients`, `recipes`, `user_profiles`, `weight_logs`, `chat_messages`,
`meal_photo_analyses`.

**Recommendation: seeded Playwright capture.** It is reusable every time the UI
changes, it never leaks real personal data into a public video, and the
`playwright.config.ts` already defines both the phone and desktop projects this
needs.

### Still needed — all three need a human

- **Food photography** for beat 1, and it is now also blocking beats 2 and 5.
  Drop it at **`assets/marketing/plate.jpg`** and both scripts pick it up
  automatically; without it they fall back to a 1×1 pixel that shoots as a
  black square, and warn loudly. One overhead plate, well lit, warm. Shoot it to
  match the on-screen analysis — **chicken, rice and roasted veg** — because a
  mismatch there is the kind of thing people notice.

- **Recipe licensing — a genuine Play risk.** Every recipe in the film is
  third-party, photography included, and Play prohibits unlicensed third-party
  assets in a promo video. Full table in
  `scripts/marketing-recipes.PROVENANCE.md`:

  | Recipe | Provider | Licence |
  |---|---|---|
  | Salmon Avocado Salad | `themealdb` | Commercial use subject to supporter terms |
  | Shakshuka | `bbc_good_food` | Commercial use subject to supporter terms |
  | Smoky Chipotle Chicken Wraps | `jalalsamfit` | Creator-attributed link |
  | Thai curry noodle soup | `themealdb` | Commercial use subject to supporter terms |
  | **Fattoush salad** | `bbc_good_food` | **none recorded** |
  | Paleo Coconut Curry Stir Fry | `allrecipes` | Source and YouTube terms |

  Clear them, or swap beat 6 for recipes whose rights you hold. Not a reason to
  fake the cards — that would breach the ≥80% genuine-footage rule instead.

  No row is user-submitted: the refresh script rejects anything stamped
  `source_provider = "manual"`, which is what `promote-food` writes when it
  promotes a user's own food into the shared tables. Nothing a real person
  entered goes near the camera.
- **Play feature graphic, 1024×500.** A hard dependency — Play will not display
  the promo video without one. Centre must stay clear for the play button.
  Does not exist in the repo.
- **Music.** Pick the track before the fine cut and edit to it. Licensed —
  Artlist or Epidemic. A strike takes down the account, not just the video.
  Must be monetisation-free, or Play drops the video.

---

### Found by shooting the real UI — product issues, not video ones

Pointing a camera at the actual app surfaced three things worth fixing in the
product. None is touched here.

1. **Food rows have no images.** 2,529 of 2,530 rows in `ingredients` have a
   null `image_url`, so every food row in the diary and in search renders the
   `ImageOff` "image unavailable" placeholder. It is visible throughout the
   montage. Recipes are fine — 816 of 816 have photography. Either source
   thumbnails or give `FoodImage` a category-based fallback that does not read
   as a broken image.
2. **The coach send button announces itself as disabled while it works.** It
   carries `aria-disabled="true"` whenever the composer is empty but stays
   deliberately tappable. Assistive tech is told it is disabled; a photo with no
   caption can genuinely be sent. The visual behaviour is right — the ARIA is
   not.
3. **Light-mode macro contrast**, already flagged in §2: carbs at 1.34:1 against
   its surface is a real legibility problem in the shipped app.

---

## 6. Review checklist

- [ ] Hook lands by 0:02 — macros moving, no logo
- [ ] Every claim traceable to the table in §1
- [ ] Motion uses the app's own easing tokens
- [ ] Numbers count up, never cut
- [ ] Every shot survives "what breaks if I remove this?"
- [ ] Captions burned in and manually corrected — check "NutriPilot"
- [ ] 9:16 respects centre-safe bands
- [ ] Hero loop is silent, seamless, under 2MB, has a poster frame
- [ ] Play Store cut contains only real UI, no prohibited claims
- [ ] Watched muted, then start to finish without skipping
