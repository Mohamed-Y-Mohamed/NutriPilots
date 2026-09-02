/**
 * Shared rig for the two marketing capture scripts — capture-marketing.mjs
 * (stills) and shoot-marketing.mjs (motion).
 *
 * Both drive the real app against stubbed Supabase, and both must stub it
 * *identically*: the moment the still of a screen and the clip of that same
 * screen disagree, the edit cuts between two different products.
 *
 * Nothing here touches production at runtime. The only network the app is
 * allowed is the recipe photography, which is hosted third-party — see
 * scripts/marketing-recipes.PROVENANCE.md.
 */

import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES, SESSION } from "./marketing-fixtures.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Matches the project ref baked into src/lib/supabase.ts. */
export const AUTH_STORAGE_KEY = "sb-yhgkrbnmhgspgckvvfhe-auth-token";

export const DELIVERY =
  process.env.CAPTURE_OUT_DIR ??
  resolve(process.env.USERPROFILE ?? process.env.HOME ?? ROOT, "Desktop/NutriPilot Launch Video");

/**
 * Phone must be a real phone *logical* viewport, not 1080 CSS px. The app's
 * desktop breakpoint sits below 1080, so capturing at the delivery resolution
 * renders the desktop layout at phone dimensions — which is exactly the mistake
 * that makes app videos look like they were shot in a browser window.
 *
 * 390x844 at 3x is the iPhone 14 / Pixel 8 class logical size, and lands a
 * 1170x2532 file: above the 1080 the social cut needs, so it downsamples rather
 * than upscales.
 */
export const VIEWPORTS = {
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  desktop: {
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
  },
};

/**
 * A 1x1 JPEG, used only when no real plate photo has been supplied. It shows up
 * on camera as a black square, which is why resolveMealPhoto shouts about it.
 */
const PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

const MEAL_PHOTO = resolve(ROOT, "assets/marketing/plate.jpg");

/**
 * Longest an edge-function reply is held open before it is abandoned. Longer
 * than any scene needs to linger on a loading state, short enough that a still
 * which holds and never releases does not stall the run.
 */
const HOLD_LIMIT_MS = 20_000;

/**
 * The meal photo the coach "reads" in beats 1 and 2.
 *
 * This is the one live-action asset in the whole production and it carries the
 * hook, so it cannot be generated or faked — drop a real overhead plate shot at
 * assets/marketing/plate.jpg. It has to match what the on-screen analysis says
 * it is (chicken, rice and roasted vegetables), because a mismatch there is
 * exactly the kind of thing people notice.
 */
export async function resolveMealPhoto() {
  try {
    await access(MEAL_PHOTO);
    return { buffer: await readFile(MEAL_PHOTO), real: true };
  } catch {
    console.warn(
      `\n  ! No meal photo at ${MEAL_PHOTO}\n` +
        "    Falling back to a 1x1 pixel, which shoots as a black square.\n" +
        "    Beat 1 needs a real overhead plate: chicken, rice and roasted veg.\n",
    );
    return { buffer: PIXEL_JPEG, real: false };
  }
}

/**
 * Per-run switches the stubs read. Flags on a mutable object rather than
 * re-routing, so a scene can flip behaviour after the page is already up.
 */
export function makeControl() {
  return {
    held: false,
    empty: false,
    /** Holds edge-function replies open so a loading state can be filmed. */
    holdFunctions() {
      this.held = true;
    },
    release() {
      this.held = false;
    },
    /** Makes food and recipe search return nothing — sets up the objection. */
    emptySearch(value = true) {
      this.empty = value;
    },
  };
}

/** Table name out of a PostgREST path: /rest/v1/diary_entries?select=... */
function tableFrom(url) {
  return new URL(url).pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "";
}

/** Query params PostgREST uses for shaping rather than filtering. */
const NON_FILTER_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

/**
 * Applies the subset of PostgREST filtering the app actually uses: `eq` and
 * `limit`.
 *
 * Not decoration. `getRecipe` ends in `.maybeSingle()`, which sends a plain
 * `Accept` header and then *rejects* a multi-row response — so a stub that
 * ignores `id=eq.<uuid>` and hands back the whole table turns every
 * single-row lookup in the app into "Could not load this recipe". Filtering
 * here is what makes the stub behave like a database rather than a fixture
 * dump.
 */
function applyFilters(rows, url) {
  const params = new URL(url).searchParams;
  let result = rows;

  for (const [key, raw] of params) {
    if (NON_FILTER_PARAMS.has(key)) continue;
    const [operator, ...rest] = raw.split(".");
    if (operator !== "eq") continue; // Anything else falls through unfiltered.
    const value = rest.join(".");
    result = result.filter((row) => String(row?.[key]) === value);
  }

  const limit = Number(params.get("limit"));
  return Number.isFinite(limit) && limit > 0 ? result.slice(0, limit) : result;
}

export async function stubSupabase(context, control) {
  await context.route("**/auth/v1/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(SESSION),
    }),
  );

  // Photo upload. Never let a capture put bytes in a real bucket.
  await context.route("**/storage/v1/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ Id: "capture", Key: "meal-photos/capture.jpg" }),
    }),
  );

  await context.route("**/rest/v1/**", (route) => {
    const url = route.request().url();
    const table = tableFrom(url);
    const searchable = table === "ingredients" || table === "recipes";
    const all = control.empty && searchable ? [] : (FIXTURES.tables[table] ?? []);
    const rows = applyFilters(all, url);

    // .single() sends this Accept header and wants an object, not an array.
    // .maybeSingle() does not — it takes an array and rejects it if longer
    // than one, which is why applyFilters above has to do its job.
    const wantsSingle = (route.request().headers()["accept"] ?? "").includes(
      "application/vnd.pgrst.object",
    );

    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` },
      body: JSON.stringify(wantsSingle ? (rows[0] ?? null) : rows),
    });
  });

  // Edge Functions back the coach and the add-food scan. Never let a capture
  // run bill a real one.
  await context.route("**/functions/v1/**", async (route) => {
    /**
     * Polled while held so a scene can release mid-flight and let the reply
     * land on cue, which is how the "thinking" beat gets its exact length.
     *
     * The cap matters: a still is taken *during* the hold and never releases,
     * so without it context.close() blocks on a handler that will never return
     * and the whole run hangs. Aborting after the cap is correct — by then the
     * frame is on disk and nothing is left to render.
     */
    const until = Date.now() + HOLD_LIMIT_MS;
    while (control.held && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 120));
    }
    if (control.held) return route.abort();

    let payload = {};
    try {
      payload = route.request().postDataJSON() ?? {};
    } catch {
      // Not JSON. The default below is the coach reply, which is the common case.
    }

    /**
     * Three different replies, and picking the wrong one changes what the
     * video claims the product does:
     *
     *  - `mode: "scan"`  → the add-food sheet reading a label (beat 5)
     *  - `imagePath`     → the coach reading a plate, itemised (beats 1-2)
     *  - otherwise       → the coach answering a question (beat 7)
     */
    const body =
      payload.mode === "scan"
        ? FIXTURES.ingredientScan
        : payload.imagePath
          ? FIXTURES.photoResponse
          : FIXTURES.coachResponse;

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/**
 * Error copy the app shows when something has gone wrong, as opposed to an
 * empty state it shows on purpose. Sourced from the `presentError` fallbacks
 * and Alert copy in src/.
 *
 * "No foods found" is deliberately NOT here — beat 5 needs a genuine miss, and
 * flagging it would cry wolf on the one shot that wants it.
 */
const ERROR_PATTERNS = [
  /Could not [^.\n]{3,80}\./g,
  /Please try again[^.\n]{0,40}\.?/g,
  /Something went wrong[^.\n]{0,60}/g,
  /does not look like a real (food|recipe)/g,
  /Back tomorrow/g,
  /Give the coach a second[^.\n]{0,60}/g,
  /(You are|You're) out of[^.\n]{0,60}/g,
];

/**
 * Reads any error the app is currently displaying.
 *
 * A capture that throws no exception is not a capture that worked — a screen
 * showing "Could not load this recipe" screenshots perfectly happily. Both
 * scripts call this before writing a frame, so a broken screen is reported at
 * capture time rather than found in the edit.
 */
export async function readErrorState(page) {
  return page.evaluate((sources) => {
    const text = document.body.innerText ?? "";
    const hits = new Set();
    for (const source of sources) {
      for (const match of text.match(new RegExp(source, "g")) ?? []) hits.add(match.trim());
    }
    return [...hits];
  }, ERROR_PATTERNS.map((pattern) => pattern.source));
}

export async function seedSession(context) {
  await context.addInitScript(
    ([key, session]) => {
      localStorage.setItem(
        key,
        JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) + 3600 }),
      );
    },
    [AUTH_STORAGE_KEY, SESSION],
  );
}
