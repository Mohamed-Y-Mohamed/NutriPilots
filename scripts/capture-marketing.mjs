/**
 * Marketing screenshot capture.
 *
 * Shoots the shot list in docs/launch-video.md §5: every key screen, populated
 * with demo data, at both the 16:9 desktop and 9:16 phone framings, in dark
 * (the hero look) and light.
 *
 * This is deliberately NOT a Playwright test. It asserts nothing — it is a
 * camera. Failures here mean a screen did not render, which you will see in
 * the output far faster than an assertion would tell you.
 *
 * Supabase is intercepted rather than hit. Two reasons, and the second is the
 * one that matters: the screens have to look the same every time they are shot,
 * and no real person's data can ever reach a marketing frame. Nothing here
 * touches production at runtime. Fixtures live in marketing-fixtures.mjs.
 *
 *   node scripts/capture-marketing.mjs
 *   node scripts/capture-marketing.mjs S12 S13     # just those shots
 *
 * Expects the preview server on :4173 (npm run build && npm run preview).
 * Shots land in the delivery folder on the Desktop, beside the storyboard and
 * the four cuts, so everything the edit needs sits in one place. Override with
 * CAPTURE_OUT_DIR.
 */

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FIXTURES } from "./marketing-fixtures.mjs";
import {
  DELIVERY,
  VIEWPORTS,
  makeControl,
  readErrorState,
  resolveMealPhoto,
  seedSession,
  stubSupabase,
} from "./marketing-harness.mjs";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://127.0.0.1:4173";
const OUT = resolve(DELIVERY, "02-screens");

/**
 * Shot ids map to the table in docs/launch-video.md §5.
 *
 * `settle` is extra wait for screens that animate in — the count-up on the
 * dashboard rings is the whole point of that shot, so it has to be allowed to
 * finish. `prepare` drives the UI into a state a URL cannot reach: opening a
 * sheet, typing a query, holding a loading state open. `themes` narrows a shot
 * to one look where the other would never be cut.
 */
const SHOTS = [
  {
    id: "S01-coach-reading",
    path: "/coach",
    settle: 400,
    /**
     * Beat 2 opens on this. The point of the frame is that the app is thinking.
     *
     * "Reading your photo…" only renders while a send is in flight, so the
     * photo has to be attached *and* sent — attaching alone leaves the composer
     * sitting there with a thumbnail and no loading state to shoot.
     */
    prepare: async (page, control, photo) => {
      await attachPhoto(page, photo);
      await composerReady(page);
      // Held only now, so the conversation itself still loads normally above.
      control.holdFunctions();
      await sendCoachMessage(page, "What's in this?");
      await page.getByText(/Reading your photo/i).waitFor({ timeout: 8000 });
    },
  },
  {
    id: "S02-coach-analysis",
    path: "/coach",
    settle: 1600,
    /**
     * The macro breakdown for a photographed plate — beat 2's payoff. It has to
     * be driven rather than seeded: the transcript fixture holds the "3 weeks"
     * conversation, and the estimate only exists as a reply to a photo.
     */
    prepare: async (page, control, photo) => {
      await attachPhoto(page, photo);
      await composerReady(page);
      await sendCoachMessage(page, "What's in this?");
      const reply = page.getByText(/Grilled chicken, rice and roasted vegetables/i).first();
      await reply.waitFor({ timeout: 15000 });
      // The reply lands taller than the transcript's auto-scroll, so the
      // itemised estimate — the actual payoff — sits just under the fold.
      await page.waitForTimeout(600);
      await reply.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        const pane = [...document.querySelectorAll("*")].find(
          (el) => el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY === "auto",
        );
        if (pane) pane.scrollTop = pane.scrollHeight;
      });
    },
  },
  { id: "S03-today", path: "/today", settle: 1600 },
  {
    id: "S04-search-filtered",
    path: "/diary",
    settle: 900,
    prepare: async (page) => {
      await typeSearch(page, "chi");
    },
  },
  { id: "S05-recipes", path: "/recipes", settle: 1600 },
  {
    id: "S06-recipe-detail",
    path: `/recipes/${FIXTURES.featuredRecipeId}`,
    settle: 1600,
    /**
     * Beat 6 is the portion adjustment, and the steppers do not exist in the
     * DOM until "Cooked it differently?" is tapped — a plain screenshot of the
     * route shows a recipe page with nothing adjustable on it.
     */
    prepare: async (page) => {
      await page.getByRole("button", { name: /Cooked it differently/i }).click();
      const more = page.getByRole("button", { name: "More", exact: true });
      await more.first().waitFor({ timeout: 8000 });
      await more.first().click();
      await more.first().scrollIntoViewIfNeeded();
    },
  },
  { id: "S07-coach", path: "/coach", settle: 1400 },
  { id: "S08-goals", path: "/goals", settle: 1200 },
  { id: "S09-dashboard", path: "/today", settle: 1600 },
  { id: "S10-landing", path: "/", settle: 900 },
  {
    id: "S11-search-empty",
    path: "/diary",
    settle: 900,
    // Sets up the objection beat 5 answers. Must genuinely return nothing.
    prepare: async (page, control) => {
      control.emptySearch();
      await typeSearch(page, "nan's rock buns");
    },
  },
  {
    id: "S12-add-sheet",
    path: "/diary",
    settle: 700,
    prepare: async (page) => {
      await openSheet(page, "Add ingredient");
      await page.getByRole("button", { name: /Scan label or food/i }).waitFor({ timeout: 8000 });
    },
  },
  {
    id: "S13-add-scanning",
    path: "/diary",
    settle: 400,
    prepare: async (page, control, photo) => {
      await openSheet(page, "Add ingredient");
      control.holdFunctions();
      await attachPhoto(page, photo);
      await page.getByRole("button", { name: /Reading photo/i }).waitFor({ timeout: 8000 });
    },
  },
  {
    id: "S14-add-filled",
    path: "/diary",
    settle: 700,
    prepare: async (page, control, photo) => {
      await openSheet(page, "Add ingredient");
      await attachPhoto(page, photo);
      await page
        .locator(`input[value="${FIXTURES.ingredientScan.draft.name}"]`)
        .waitFor({ timeout: 15000 });
    },
  },
  {
    id: "S15-add-uncertain",
    path: "/diary",
    settle: 700,
    // The honesty line. Hold it for a full beat in the edit.
    prepare: async (page, control, photo) => {
      await openSheet(page, "Add ingredient");
      await attachPhoto(page, photo);
      const warning = page.getByText(/not fully confident about these numbers/i);
      await warning.waitFor({ timeout: 15000 });
      await warning.scrollIntoViewIfNeeded();
    },
  },
  {
    id: "S16-add-recipe-describe",
    path: "/diary",
    settle: 700,
    prepare: async (page) => {
      await openSheet(page, "Add recipe");
      await page.getByRole("button", { name: /Describe it instead/i }).click();
      const box = page.getByPlaceholder(/Chicken curry with rice and a side salad/i);
      await box.waitFor({ timeout: 8000 });
      // Land on the plain-English one — nobody expects it to work.
      await box.fill("Chicken curry with rice and a side salad. Serves 4.");
      await box.scrollIntoViewIfNeeded();
    },
  },
];

/* -------------------------------------------------------------------------- */
/* UI driving                                                                  */
/* -------------------------------------------------------------------------- */

async function openSheet(page, label) {
  await page.getByRole("button", { name: new RegExp(label, "i") }).click();
}

async function typeSearch(page, query) {
  const field = page.getByPlaceholder(/Try chicken breast|Try curry/i).first();
  await field.waitFor({ timeout: 8000 });
  await field.click();
  // Typed rather than filled: the debounce and the filtering are the shot.
  await field.pressSequentially(query, { delay: 90 });
  await page.waitForTimeout(700);
}

/**
 * The web build routes "Scan label or food" at a hidden file input, so setting
 * files directly is the same path a real camera capture takes.
 *
 * Waits for attachment rather than visibility: the input is `sr-only`, and on
 * the coach page it only mounts once the conversation history has resolved —
 * `networkidle` fires well before that.
 */
async function attachPhoto(page, photo) {
  const input = page.locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 15_000 });
  await input.setInputFiles({ name: "plate.jpg", mimeType: "image/jpeg", buffer: photo.buffer });
}

async function composerReady(page) {
  await page.getByRole("button", { name: /^Send/i }).waitFor({ timeout: 8000 });
}

/**
 * The send button carries `aria-disabled` until the composer has text — it
 * stays tappable on purpose, but Playwright honours aria-disabled and will not
 * click it. Typing first is what a person does anyway.
 */
async function sendCoachMessage(page, text) {
  const composer = page.getByPlaceholder(/Ask about food|Say what this is/i).first();
  await composer.click();
  await composer.pressSequentially(text, { delay: 55 });
  await page.getByRole("button", { name: /^Send/i }).click();
}

/* -------------------------------------------------------------------------- */
/* Capture                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One context per shot rather than one per frame. Shots mutate page state —
 * an open sheet, a held request, a typed query — and a shared page would carry
 * that into the next frame. Contexts are cheap; a wrong frame found in the edit
 * is not.
 */
async function captureShot(browser, { shot, frame, profile, theme, photo }) {
  const name = `${shot.id}_${frame}_${theme}.png`;
  const control = makeControl();

  const context = await browser.newContext({
    ...profile,
    colorScheme: theme, // ThemeContext defaults to "system", so this drives it.
    reducedMotion: "no-preference", // We want the motion; it is the product.
  });

  try {
    await stubSupabase(context, control);
    await seedSession(context);

    const page = await context.newPage();
    await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle", timeout: 30_000 });

    if (shot.prepare) await shot.prepare(page, control, photo);
    await page.waitForTimeout(shot.settle);

    await page.screenshot({ path: resolve(OUT, name) });

    /**
     * A frame showing "Could not load this recipe" screenshots perfectly
     * happily. No exception thrown is not the same as a usable shot, and
     * trusting that is how two broken screens reached the delivery folder
     * already.
     */
    const errors = await readErrorState(page);
    if (errors.length > 0) {
      console.error(`  ERR  ${name} — ${errors.join(" | ")}`);
      return { name, ok: false, reason: `error on screen: ${errors.join(" | ")}` };
    }

    console.log(`  ok   ${name}`);
    return { name, ok: true };
  } catch (error) {
    const reason = error.message.split("\n")[0];
    console.error(`  FAIL ${name} — ${reason}`);
    return { name, ok: false, reason };
  } finally {
    await context.close();
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const only = process.argv.slice(2);
  const shots =
    only.length > 0
      ? SHOTS.filter((shot) => only.some((id) => shot.id.startsWith(id)))
      : SHOTS;

  if (shots.length === 0) {
    throw new Error(`No shots matched ${only.join(", ")}`);
  }

  const photo = await resolveMealPhoto();
  const browser = await chromium.launch();
  const results = [];

  for (const [frame, profile] of Object.entries(VIEWPORTS)) {
    for (const theme of ["dark", "light"]) {
      console.log(`\n${frame} / ${theme}`);
      for (const shot of shots) {
        results.push(await captureShot(browser, { shot, frame, profile, theme, photo }));
      }
    }
  }

  await browser.close();

  const failed = results.filter((result) => !result.ok);
  await writeFile(
    resolve(OUT, "_capture-report.md"),
    renderReport(results, failed),
  );

  console.log(`\n${results.length - failed.length}/${results.length} shots in ${OUT}`);
  if (failed.length > 0) {
    console.log(`${failed.length} failed — see _capture-report.md`);
    process.exitCode = 1;
  }
}

function renderReport(results, failed) {
  const lines = [
    "# Capture report",
    "",
    `Generated ${new Date().toISOString()}`,
    "",
    `${results.length - failed.length} of ${results.length} shots captured.`,
    "",
  ];
  if (failed.length > 0) {
    lines.push("## Failed", "");
    for (const result of failed) lines.push(`- \`${result.name}\` — ${result.reason}`);
    lines.push("");
  }
  lines.push("## All", "");
  for (const result of results) {
    lines.push(`- ${result.ok ? "ok" : "FAIL"} \`${result.name}\``);
  }
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
