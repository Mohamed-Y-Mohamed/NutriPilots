/**
 * Refreshes scripts/marketing-recipes.json from production.
 *
 * The marketing capture shows real recipe cards with real photography, because
 * the Play listing requires genuine in-app footage. That means the fixture has
 * to be pulled rather than written — and re-pulled whenever the recipe rows or
 * the select list in src/services/foodSearch.ts change, or the capture will
 * quietly shoot a shape the app no longer returns.
 *
 *   node scripts/refresh-marketing-recipes.mjs
 *
 * Reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY from .env. Anon key
 * only — these are public reference rows, no service role needed.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "scripts/marketing-recipes.json");
const PROVENANCE = resolve(ROOT, "scripts/marketing-recipes.PROVENANCE.md");

/**
 * Chosen for the grid in beat 6: a photogenic hero first, then enough cuisine
 * spread that the shot does not read as a British-food app. Names rather than
 * ids so a reader can see what is being pulled and why.
 */
const WANTED = [
  "Salmon Avocado Salad",
  "Shakshuka",
  "Smoky Chipotle Chicken Wraps",
  "Thai curry noodle soup",
  "Fattoush salad",
  "Paleo Coconut Curry Stir Fry",
];

/** Must stay identical to RECIPE_FIELDS in src/services/foodSearch.ts. */
const RECIPE_FIELDS =
  "id,name,description,image_url,servings,prep_time_minutes,cook_time_minutes,instructions,calories_per_serving,protein_per_serving_g,carbs_per_serving_g,fat_per_serving_g,fibre_per_serving_g,saturated_fat_per_serving_g,sugar_per_serving_g,sodium_per_serving_mg,cholesterol_per_serving_mg,cuisine,dietary_tags,ingredient_count,ingredients,video_url,video_source_url,video_duration_seconds,video_verified_short";

async function readEnv() {
  const raw = await readFile(resolve(ROOT, ".env"), "utf8");
  return Object.fromEntries(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

/**
 * Guards against the select list drifting: if foodSearch.ts gains a column and
 * this file does not, the capture shoots a recipe missing that field and nobody
 * notices until the frame is in the edit.
 */
async function assertFieldsMatchApp() {
  const source = await readFile(resolve(ROOT, "src/services/foodSearch.ts"), "utf8");
  if (!source.includes(RECIPE_FIELDS)) {
    throw new Error(
      "RECIPE_FIELDS no longer matches src/services/foodSearch.ts.\n" +
        "Copy the RECIPE_FIELDS constant across before refreshing.",
    );
  }
}

async function main() {
  await assertFieldsMatchApp();

  const env = await readEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env");

  const query = new URLSearchParams({
    // Provenance rides along for the guards below, then gets stripped — the
    // fixture must stay in exactly the shape the app receives.
    select: `${RECIPE_FIELDS},source_provider,source_license,source_url`,
    name: `in.(${WANTED.map((n) => `"${n}"`).join(",")})`,
    // Belt and braces with the assertion below: never let the query itself
    // return user-promoted content.
    source_provider: "neq.manual",
  });

  const response = await fetch(`${url}/rest/v1/recipes?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);

  const rows = await response.json();
  const ordered = WANTED.map((name) => rows.find((row) => row.name === name));

  const missing = WANTED.filter((name, i) => !ordered[i]);
  if (missing.length > 0) {
    throw new Error(`Not found in production: ${missing.join(", ")}`);
  }

  const withoutImages = ordered.filter((row) => !row.image_url).map((row) => row.name);
  if (withoutImages.length > 0) {
    throw new Error(`No image_url, unusable on camera: ${withoutImages.join(", ")}`);
  }

  /**
   * The hard rule. `promote-food` stamps user-submitted content with
   * source_provider "manual" when it promotes it into the shared tables, so
   * that value is the only thing separating catalogue rows from something a
   * real person typed in. Nothing a user wrote goes in front of a camera.
   */
  const userSubmitted = ordered
    .filter((row) => !row.source_provider || row.source_provider === "manual")
    .map((row) => row.name);
  if (userSubmitted.length > 0) {
    throw new Error(
      `User-submitted content, refusing to use for marketing: ${userSubmitted.join(", ")}`,
    );
  }

  const provenance = ordered.map((row) => ({
    name: row.name,
    source_provider: row.source_provider,
    source_license: row.source_license ?? null,
    source_url: row.source_url ?? null,
    image_url: row.image_url,
  }));

  // Strip provenance so the fixture matches RECIPE_FIELDS exactly.
  const appShaped = ordered.map(({ source_provider, source_license, source_url, ...row }) => row);

  await writeFile(OUT, `${JSON.stringify(appShaped, null, 2)}\n`);
  await writeFile(PROVENANCE, renderProvenance(provenance));

  console.log(`Wrote ${appShaped.length} recipes to ${OUT}`);
  console.log(`Provenance and licensing written to ${PROVENANCE}\n`);

  const unlicensed = provenance.filter((row) => !row.source_license);
  for (const row of provenance) {
    console.log(`  ${row.name}`);
    console.log(`    provider ${row.source_provider} — ${row.source_license ?? "NO LICENCE RECORDED"}`);
  }
  if (unlicensed.length > 0) {
    console.log(
      `\nWARNING: ${unlicensed.length} row(s) carry no recorded licence. Play prohibits` +
        ` unlicensed third-party assets in a promo video — clear these before the edit.`,
    );
  }
}

function renderProvenance(rows) {
  const lines = [
    "# Recipe fixture provenance",
    "",
    "Generated by scripts/refresh-marketing-recipes.mjs. Do not edit by hand.",
    "",
    "Every recipe shown in the launch video comes from a third-party catalogue,",
    "including its photography. Google Play prohibits unlicensed third-party",
    "assets in a promo video, so each row below needs clearing — or replacing —",
    "before any of these frames ship. See docs/launch-video.md §5.",
    "",
    "No row here is user-submitted: the refresh script rejects anything stamped",
    "`source_provider = \"manual\"`, which is what promote-food writes when it",
    "promotes a user's own food into the shared tables.",
    "",
    "| Recipe | Provider | Licence | Image host |",
    "|---|---|---|---|",
  ];
  for (const row of rows) {
    const host = row.image_url ? new URL(row.image_url).host : "—";
    lines.push(
      `| ${row.name} | \`${row.source_provider}\` | ${row.source_license ?? "**none recorded**"} | ${host} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
