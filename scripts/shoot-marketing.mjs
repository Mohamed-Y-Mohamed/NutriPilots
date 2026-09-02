/**
 * Marketing motion capture — the video shoot.
 *
 * Films the real app being used: fingers landing on controls, sheets sliding
 * up, search filtering as it is typed, numbers rolling, the coach thinking and
 * answering. One clip per beat of the master narrative in docs/launch-video.md
 * §3, so the edit assembles rather than reshoots.
 *
 * This is the answer to "not stale images". Every frame is genuine in-app
 * footage, which is also what the Play listing requires — nothing here is a
 * mockup or a motion-graphics recreation.
 *
 *   node scripts/shoot-marketing.mjs                 # every beat, both frames
 *   node scripts/shoot-marketing.mjs B02 B06         # just those beats
 *   node scripts/shoot-marketing.mjs --frame phone   # one framing
 *
 * Expects the preview server on :4173 (npm run build && npm run preview).
 * Clips land in <delivery>/02-motion as WebM. Playwright records at the
 * viewport size, so the phone clips come out 390x844 — deliberately: motion is
 * cut at 1080 and upscaling 390 is fine for a screen recording composited onto
 * a dark field, whereas a 3x DPR video would be four times the file for detail
 * the codec throws away anyway. Stills carry the resolution; clips carry time.
 *
 * What this cannot shoot: a human hand holding a real phone, and the plate in
 * beat 1. Both are live action. See §5 of the storyboard.
 */

import { chromium } from "@playwright/test";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
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
const OUT = resolve(DELIVERY, "02-motion");

/* -------------------------------------------------------------------------- */
/* Pointer — the stand-in for a finger                                         */
/* -------------------------------------------------------------------------- */

/**
 * A visible pointer, because a screen recording with no cursor reads as a
 * demo reel rather than someone using an app. It is a soft ring rather than an
 * arrow: an arrow says desktop, a ring says touch, and the phone clips are the
 * ones that matter.
 *
 * Injected as an init script so it survives navigation, and marked
 * pointer-events:none so it can never intercept the interaction it is
 * illustrating.
 */
const POINTER_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById('__shoot_pointer')) return;
    const ring = document.createElement('div');
    ring.id = '__shoot_pointer';
    ring.style.cssText = [
      'position:fixed', 'left:0', 'top:0', 'width:34px', 'height:34px',
      'margin:-17px 0 0 -17px', 'border-radius:50%', 'pointer-events:none',
      'z-index:2147483647', 'opacity:0',
      'background:radial-gradient(circle, rgba(53,199,154,0.34) 0%, rgba(53,199,154,0.10) 60%, rgba(53,199,154,0) 70%)',
      'border:1.5px solid rgba(53,199,154,0.65)',
      'box-shadow:0 0 14px rgba(53,199,154,0.35)',
      // The app's own --ease-out. The pointer has to move like the product.
      'transition:transform 120ms cubic-bezier(0.16,1,0.3,1), opacity 220ms cubic-bezier(0.16,1,0.3,1)',
      'will-change:transform',
    ].join(';');
    document.documentElement.appendChild(ring);

    let x = 0, y = 0;
    addEventListener('mousemove', (e) => {
      x = e.clientX; y = e.clientY;
      ring.style.opacity = '1';
      ring.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(1)';
    }, true);
    addEventListener('mousedown', () => {
      ring.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(0.66)';
    }, true);
    addEventListener('mouseup', () => {
      ring.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(1)';
    }, true);
  };
  if (document.documentElement) install();
  else addEventListener('DOMContentLoaded', install);
})();
`;

/* -------------------------------------------------------------------------- */
/* Motion helpers                                                              */
/* -------------------------------------------------------------------------- */

const wait = (page, ms) => page.waitForTimeout(ms);

/**
 * Moves the pointer to an element along an eased path rather than teleporting.
 * Playwright's default click jumps straight to the target, which on camera
 * looks like the UI is operating itself.
 */
async function glide(page, locator, { steps = 22 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("glide: element has no box");
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(to.x, to.y, { steps });
  return to;
}

/** Land, press, hold a beat, release — the rhythm of an actual tap. */
async function tap(page, locator, { settle = 260 } = {}) {
  await glide(page, locator);
  await wait(page, 90);
  await page.mouse.down();
  await wait(page, 70);
  await page.mouse.up();
  await wait(page, settle);
}

/**
 * Types at a human cadence with a little jitter. Even delay reads as a machine,
 * and the search-filtering beat lives or dies on this looking real.
 */
async function type(page, locator, text, { base = 78 } = {}) {
  await tap(page, locator, { settle: 140 });
  for (const character of text) {
    await page.keyboard.type(character);
    await wait(page, base + Math.round(Math.random() * 55) - (character === " " ? 20 : 0));
  }
}

/**
 * rAF scroll with an ease-out, on the element that actually scrolls.
 * page.mouse.wheel steps in discrete notches and judders on camera.
 */
async function scroll(page, distance, { duration = 1100, selector = null } = {}) {
  await page.evaluate(
    async ([distance, duration, selector]) => {
      /**
       * The app scrolls the document, not an inner pane — every page bar the
       * coach transcript. So the document wins when it can move, and the
       * search for an inner scroller is the fallback rather than the default.
       * Getting this the wrong way round scrolls a container with nothing in
       * it and the clip sits perfectly still.
       */
      const doc = document.scrollingElement;
      const canScroll = (el) => el && el.scrollHeight > el.clientHeight + 40;
      const target =
        (selector && document.querySelector(selector)) ||
        (canScroll(doc)
          ? doc
          : [...document.querySelectorAll("*")]
              .filter(canScroll)
              .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]) ||
        doc;

      const from = target.scrollTop;
      const start = performance.now();
      // --ease-out, the same curve the app uses for entrances.
      const ease = (t) => 1 - Math.pow(1 - t, 3);

      await new Promise((done) => {
        const frame = (now) => {
          const t = Math.min((now - start) / duration, 1);
          target.scrollTop = from + distance * ease(t);
          if (t < 1) requestAnimationFrame(frame);
          else done();
        };
        requestAnimationFrame(frame);
      });
    },
    [distance, duration, selector],
  );
}

async function attachPhoto(page, photo) {
  const input = page.locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 15_000 });
  await input.setInputFiles({ name: "plate.jpg", mimeType: "image/jpeg", buffer: photo.buffer });
}

const byRole = (page, name) => page.getByRole("button", { name });

/**
 * Navigates the way a person does — by tapping the nav — rather than with
 * page.goto.
 *
 * goto reloads the SPA, which replays the splash screen. On camera that reads
 * as the app restarting halfway through the shot, and no amount of trimming
 * hides it because it lands mid-scene. Tapping keeps the router in memory and
 * gives us the real route transition, which is the thing worth filming.
 */
async function tapTab(page, label) {
  await tap(page, page.getByRole("link", { name: label, exact: true }).first(), { settle: 900 });
  await page.waitForLoadState("networkidle").catch(() => {});
}

/* -------------------------------------------------------------------------- */
/* The beats                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Each scene is one clip. `path` is where it opens; `shoot` drives it.
 *
 * Scenes run long on purpose — roughly double what the cut needs. Trimming in
 * the edit is free; discovering the pointer left frame half a second early is
 * a reshoot.
 */
const SCENES = [
  {
    id: "B02-photo-to-macros",
    path: "/coach",
    note: "Beat 2-3. Photograph the plate, the macros land.",
    shoot: async (page, { control, photo }) => {
      await wait(page, 700);
      await attachPhoto(page, photo);
      await wait(page, 900);
      // Held so the thinking state lasts long enough to cut to, then released
      // on cue so the answer lands where the VO wants it.
      control.holdFunctions();
      await type(page, page.getByPlaceholder(/Say what this is/i).first(), "What's in this?");
      await wait(page, 250);
      await tap(page, byRole(page, /^Send/i), { settle: 200 });
      await page.getByText(/Reading your photo/i).waitFor({ timeout: 10_000 });
      await wait(page, 1900);
      control.release();
      await wait(page, 2600);
      // The reply lands taller than the transcript's auto-scroll, so the
      // itemised estimate — the actual payoff — sits just under the fold.
      await scroll(page, 520, { duration: 1100 });
      await wait(page, 2600);
    },
  },
  {
    id: "B04-diary-and-search",
    path: "/today",
    note: "Beat 4. A day already filed, then 2,400 foods filtering under the cursor.",
    shoot: async (page) => {
      await wait(page, 1400);
      await scroll(page, 420, { duration: 1300 });
      await wait(page, 900);
      await scroll(page, 380, { duration: 1100 });
      await wait(page, 800);
      await tapTab(page, "Add food");
      await wait(page, 700);
      await type(page, page.getByPlaceholder(/Try chicken breast/i).first(), "chick");
      await wait(page, 2200);
    },
  },
  {
    id: "B05-not-in-there",
    path: "/diary",
    note: "Beat 5. The objection, answered — search misses, scan fills it in, app admits doubt.",
    shoot: async (page, { control, photo }) => {
      await wait(page, 900);
      // The miss has to be genuine, or the beat is a lie.
      control.emptySearch(true);
      await type(page, page.getByPlaceholder(/Try chicken breast/i).first(), "nan's rock buns");
      await wait(page, 1800);
      control.emptySearch(false);

      await tap(page, byRole(page, /Add ingredient/i), { settle: 700 });
      await byRole(page, /Scan label or food/i).waitFor({ timeout: 8000 });
      await wait(page, 900);

      control.holdFunctions();
      await tap(page, byRole(page, /Scan label or food/i), { settle: 200 });
      await attachPhoto(page, photo);
      await byRole(page, /Reading photo/i).waitFor({ timeout: 8000 });
      await wait(page, 1600);
      control.release();

      // Fields filling themselves is the payoff of the whole beat.
      await page
        .locator(`input[value="${FIXTURES.ingredientScan.draft.name}"]`)
        .waitFor({ timeout: 15_000 });
      await wait(page, 1500);

      // Then the honesty line. Hold it — nobody else shows this.
      const warning = page.getByText(/not fully confident about these numbers/i);
      await warning.waitFor({ timeout: 10_000 });
      await warning.scrollIntoViewIfNeeded();
      await wait(page, 2600);
    },
  },
  {
    id: "B06-recipes-and-portion",
    path: "/recipes",
    note: "Beat 6. 790 recipes, then nutrition recalculating as a portion changes.",
    shoot: async (page) => {
      await wait(page, 1600);
      await scroll(page, 520, { duration: 1400 });
      await wait(page, 1000);

      // Tapped, not navigated — the card opening is part of the beat.
      await tap(page, page.getByRole("link", { name: /Salmon Avocado Salad/i }).first(), {
        settle: 1400,
      });
      await page.waitForLoadState("networkidle").catch(() => {});
      await wait(page, 1600);
      await scroll(page, 640, { duration: 1300 });
      await wait(page, 900);

      /**
       * The steppers live behind "Cooked it differently?" and do not exist in
       * the DOM until it is tapped — which is also the better shot, because the
       * panel opening is what tells the viewer the adjustment is even possible.
       */
      await tap(page, byRole(page, /Cooked it differently/i), { settle: 1000 });
      await wait(page, 700);

      /**
       * "Less / Usual / More" per ingredient, with the nutrition rolling after
       * each tap. Three different ingredients rather than three taps on one, so
       * the totals visibly climb instead of toggling back and forth.
       */
      const more = page.getByRole("button", { name: "More", exact: true });
      await more.first().waitFor({ timeout: 8000 });
      const count = Math.min(await more.count(), 3);
      for (let i = 0; i < count; i += 1) {
        await tap(page, more.nth(i), { settle: 1200 });
      }
      await wait(page, 2200);
    },
  },
  {
    id: "B07-coach-turn",
    path: "/coach",
    note: "Beat 7. The turn — the scale stops moving, so ask.",
    shoot: async (page, { control }) => {
      await wait(page, 1200);
      await scroll(page, 300, { duration: 900 });
      await wait(page, 700);
      control.holdFunctions();
      await type(
        page,
        page.getByPlaceholder(/Ask about food/i).first(),
        "I have been the same weight for 3 weeks",
        { base: 62 },
      );
      await wait(page, 350);
      await tap(page, byRole(page, /^Send/i), { settle: 200 });
      await wait(page, 2100);
      control.release();
      await wait(page, 3600);
    },
  },
  {
    id: "B08-targets-and-ring",
    path: "/goals",
    note: "Beat 8. Targets built from you, measured against everything logged.",
    shoot: async (page) => {
      await wait(page, 1500);
      await scroll(page, 480, { duration: 1300 });
      await wait(page, 1100);
      await tapTab(page, "Today");
      // The count-up on the rings is the whole point — let it finish.
      await wait(page, 3200);
    },
  },
  {
    id: "B09-montage",
    path: "/today",
    note: "Beat 9. Fast montage, 12-16 frames a screen in the cut. Shot slow, trimmed hard.",
    /**
     * Thumbed through the tab bar rather than navigated. Beat 9 is meant to
     * read as someone flicking through the app, and the real route transitions
     * are what sell it — a goto per stop would replay the splash six times.
     */
    shoot: async (page) => {
      for (const tab of ["Add food", "Recipes", "Coach", "Today"]) {
        await tapTab(page, tab);
        await wait(page, 1100);
        await scroll(page, 260, { duration: 700 });
        await wait(page, 800);
      }
      await tap(page, page.getByRole("link", { name: "Goals", exact: true }).first(), {
        settle: 1200,
      });
      await wait(page, 1600);
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Shoot                                                                       */
/* -------------------------------------------------------------------------- */

async function shootScene(browser, { scene, frame, profile, theme, photo }) {
  const name = `${scene.id}_${frame}_${theme}`;
  const control = makeControl();
  const staging = resolve(OUT, `.staging-${name}`);

  const context = await browser.newContext({
    ...profile,
    colorScheme: theme,
    reducedMotion: "no-preference", // We want the motion; it is the product.
    recordVideo: { dir: staging, size: profile.viewport },
  });

  let page;
  try {
    await stubSupabase(context, control);
    await seedSession(context);
    await context.addInitScript(POINTER_SCRIPT);

    page = await context.newPage();
    await page.goto(`${BASE}${scene.path}`, { waitUntil: "networkidle" });
    await scene.shoot(page, { control, photo });

    // Read before closing, because closing is when the recording stops — an
    // error on screen at this point is an error in the delivered clip.
    const errors = await readErrorState(page);

    // Release anything still held, or context.close() waits on it.
    control.release();
    await context.close();

    const [recorded] = await readdir(staging);
    const target = resolve(OUT, `${name}.webm`);
    await rename(resolve(staging, recorded), target);
    await rm(staging, { recursive: true, force: true });

    if (errors.length > 0) {
      console.error(`  ERR  ${name}.webm — ${errors.join(" | ")}`);
      return { name, ok: false, reason: `error on screen: ${errors.join(" | ")}` };
    }

    console.log(`  ok   ${name}.webm`);
    return { name, ok: true };
  } catch (error) {
    const reason = error.message.split("\n")[0];
    control.release();
    await context.close().catch(() => {});
    await rm(staging, { recursive: true, force: true });
    console.error(`  FAIL ${name} — ${reason}`);
    return { name, ok: false, reason };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const frameArg = args.indexOf("--frame");
  const onlyFrame = frameArg >= 0 ? args[frameArg + 1] : null;
  const ids = args.filter((a) => !a.startsWith("--") && a !== onlyFrame);

  const scenes = ids.length > 0 ? SCENES.filter((s) => ids.some((id) => s.id.startsWith(id))) : SCENES;
  if (scenes.length === 0) throw new Error(`No scenes matched ${ids.join(", ")}`);

  const frames = Object.entries(VIEWPORTS).filter(([frame]) => !onlyFrame || frame === onlyFrame);
  if (frames.length === 0) throw new Error(`No such frame: ${onlyFrame}`);

  await mkdir(OUT, { recursive: true });
  const photo = await resolveMealPhoto();

  const browser = await chromium.launch();
  const results = [];

  // Dark only. It is the hero look, the montage flashes light for one beat and
  // that flash comes from the stills — filming every scene twice doubles the
  // shoot for footage the edit would not use.
  const theme = "dark";

  for (const [frame, profile] of frames) {
    console.log(`\n${frame} / ${theme}`);
    for (const scene of scenes) {
      results.push(await shootScene(browser, { scene, frame, profile, theme, photo }));
    }
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  await writeFile(resolve(OUT, "_shoot-report.md"), renderReport(results, failed, photo, scenes));

  console.log(`\n${results.length - failed.length}/${results.length} clips in ${OUT}`);
  if (!photo.real) {
    console.log("! Meal photo is the placeholder — beats 2 and 5 show a black square.");
  }
  if (failed.length > 0) {
    console.log(`${failed.length} failed — see _shoot-report.md`);
    process.exitCode = 1;
  }
}

function renderReport(results, failed, photo, scenes) {
  const lines = [
    "# Shoot report",
    "",
    `Generated ${new Date().toISOString()}`,
    "",
    `${results.length - failed.length} of ${results.length} clips recorded.`,
    "",
    "Source footage, not cuts. Every clip runs long — trim in the edit.",
    "",
  ];

  if (!photo.real) {
    lines.push(
      "> **Meal photo missing.** `assets/marketing/plate.jpg` does not exist, so the",
      "> photo beats show a black square. Drop a real overhead plate in — chicken,",
      "> rice and roasted veg, to match the on-screen analysis — and reshoot",
      "> `B02` and `B05`.",
      "",
    );
  }

  if (failed.length > 0) {
    lines.push("## Failed", "");
    for (const r of failed) lines.push(`- \`${r.name}\` — ${r.reason}`);
    lines.push("");
  }

  lines.push("## Scenes", "");
  for (const scene of scenes) lines.push(`- **${scene.id}** — ${scene.note}`);
  lines.push("", "## Files", "");
  for (const r of results) lines.push(`- ${r.ok ? "ok" : "FAIL"} \`${r.name}.webm\``);

  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
