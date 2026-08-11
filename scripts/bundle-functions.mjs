#!/usr/bin/env node
/**
 * Produces self-contained copies of each Edge Function for people deploying
 * through the Supabase dashboard, which has no `_shared` folder.
 *
 * Generated rather than hand-copied so the pasteable versions cannot drift
 * away from the real source.
 *
 *   npm run bundle:functions
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const functionsDir = join(root, "supabase", "functions");
const outDir = join(root, "supabase", "manual", "functions");

const sharedDir = join(functionsDir, "_shared");

const EXTERNAL_IMPORT = /^import\s[\s\S]*?from\s+["'](?:jsr:|npm:|https:)[^"']+["'];?$/gm;
// Entries reach shared code as ../_shared/x.ts; shared modules reach each other
// as ./x.ts. Both forms disappear once the module is inlined.
const SHARED_IMPORT = /^import\s[\s\S]*?from\s+["'](?:\.\.\/_shared\/|\.\/)[^"']+["'];?$/gm;
const SHARED_SPECIFIER = /from\s+["'](?:\.\.\/_shared\/|\.\/)([^"']+)["']/g;

/**
 * The shared modules a source file needs, deepest dependency first.
 *
 * Discovered by reading the imports rather than kept in a list here: a list
 * goes stale the moment a shared module is added, and the failure is silent —
 * the bundle simply omits the code and only breaks when someone pastes it into
 * the dashboard. That is exactly how `version.ts` went missing.
 */
function collectShared(source, seen = new Set(), order = []) {
  for (const [, dep] of source.matchAll(SHARED_SPECIFIER)) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    collectShared(readFileSync(join(sharedDir, dep), "utf8"), seen, order);
    order.push(dep);
  }
  return order;
}

/**
 * Fails the build if the bundle uses something it never defines.
 *
 * Inlining is textual, so a missed module produces a file that looks fine and
 * throws a ReferenceError only once deployed.
 */
function assertSelfContained(name, bundle, entry) {
  const imported = [...entry.matchAll(/^import\s*\{([^}]+)\}\s*from\s+["'](?:\.\.\/_shared\/)/gm)]
    .flatMap(([, names]) => names.split(","))
    .map((part) => part.replace(/^\s*type\s+/, "").split(/\s+as\s+/).pop().trim())
    .filter(Boolean);

  const missing = imported.filter(
    (symbol) =>
      !new RegExp(`(?:function|const|let|class|type|interface|enum)\\s+${symbol}\\b`).test(bundle),
  );

  if (missing.length) {
    throw new Error(
      `${name}.ts would not run: ${missing.join(", ")} imported but never inlined. ` +
        `Check supabase/functions/_shared/ imports resolve.`,
    );
  }
}

const targets = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name);

mkdirSync(outDir, { recursive: true });

for (const name of targets) {
  const externals = new Set();
  const parts = [];

  const entry = readFileSync(join(functionsDir, name, "index.ts"), "utf8");

  // Only the shared modules this function actually reaches, so a small function
  // does not carry the whole AI layer.
  for (const shared of collectShared(entry)) {
    parts.push(strip(readFileSync(join(sharedDir, shared), "utf8"), externals));
  }
  parts.push(strip(entry, externals));

  const header = `// ============================================================================
// NutriPilot Edge Function: ${name}
//
// GENERATED FILE — do not edit. Edit supabase/functions/${name}/index.ts (and
// supabase/functions/_shared/*) then run: npm run bundle:functions
//
// This is a single-file copy for pasting into the Supabase dashboard when the
// CLI is not available. The shared modules are inlined below.
// ============================================================================

`;

  const body = [header, [...externals].sort().join("\n"), "", ...parts].join("\n");
  const bundle = `${body.replace(/\n{4,}/g, "\n\n\n")}\n`;

  assertSelfContained(name, bundle, entry);
  writeFileSync(join(outDir, `${name}.ts`), bundle);
  console.log(`  ${name}.ts`);
}

console.log(`\n✓ ${targets.length} functions written to supabase/manual/functions/`);

writeManualSql();

/**
 * Splits the migration into two pastes. Storage is separate because creating
 * policies on `storage.objects` needs a privilege the SQL editor has but a
 * plain connection may not — if step 2 fails, only step 2 has to be redone
 * through the dashboard UI.
 */
function writeManualSql() {
  const migrationsDir = join(root, "supabase", "migrations");
  const file = readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort().at(-1);
  const sql = readFileSync(join(migrationsDir, file), "utf8");

  const marker = "-- Storage: meal-photos (private, one folder per user)";
  const start = sql.lastIndexOf("-- ---", sql.indexOf(marker));
  const end = sql.indexOf('-- "My foods"');
  const endBlock = sql.lastIndexOf("-- ---", end);

  if (start < 0 || endBlock < 0) {
    throw new Error("Could not locate the storage block in the migration.");
  }

  const storage = sql.slice(start, endBlock);
  const schema = sql.slice(0, start) + sql.slice(endBlock);

  const note = (title, body) =>
    `-- ============================================================================\n` +
    `-- ${title}\n--\n` +
    body.split("\n").map((line) => `-- ${line}`).join("\n") +
    `\n-- ============================================================================\n\n`;

  writeFileSync(
    join(root, "supabase", "manual", "01-schema.sql"),
    note(
      "NutriPilot — step 1 of 2: schema, row level security, and the My Foods RPC",
      "GENERATED from supabase/migrations/ — do not edit here.\n" +
        "Paste the whole file into the Supabase SQL editor and run it.\n" +
        "Idempotent: safe to run more than once.\n" +
        "Does NOT touch public.ingredients or public.recipes.",
    ) + schema.trim() + "\n",
  );

  writeFileSync(
    join(root, "supabase", "manual", "02-storage.sql"),
    note(
      "NutriPilot — step 2 of 2: the private meal-photos bucket and its policies",
      "GENERATED from supabase/migrations/ — do not edit here.\n" +
        "Run step 1 first. Paste this into the Supabase SQL editor and run it.\n" +
        "If it fails on permissions, create the bucket in Storage instead:\n" +
        "  name 'meal-photos', Public OFF, 10 MB limit, image/jpeg image/png image/webp",
    ) + storage.trim() + "\n",
  );

  console.log("✓ SQL written to supabase/manual/01-schema.sql and 02-storage.sql");
}

/** Hoists external imports and drops `_shared` ones, which are inlined instead. */
function strip(source, externals) {
  for (const match of source.match(EXTERNAL_IMPORT) ?? []) {
    externals.add(match.trim().replace(/;?$/, ";"));
  }
  return source.replace(EXTERNAL_IMPORT, "").replace(SHARED_IMPORT, "").trim();
}
