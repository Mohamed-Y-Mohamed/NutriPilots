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

/**
 * Fails the build if the bundle imports the same name twice.
 *
 * External imports are hoisted verbatim and de-duplicated by exact text, so two
 * shared modules reaching for the same symbol in different words — one
 * `import type { SupabaseClient }`, one `import { createClient, type
 * SupabaseClient }` — both survive and Deno refuses to load the file. Nothing
 * about the source looks wrong, so the failure only appears once deployed.
 */
function assertNoDuplicateImports(name, externals) {
  const seen = new Set();
  const duplicates = [];

  for (const line of externals) {
    const clause = line.match(/^import\s+(?:type\s+)?\{([^}]+)\}/);
    if (!clause) continue;
    for (const part of clause[1].split(",")) {
      const symbol = part.replace(/^\s*type\s+/, "").split(/\s+as\s+/).pop().trim();
      if (!symbol) continue;
      if (seen.has(symbol)) duplicates.push(symbol);
      seen.add(symbol);
    }
  }

  if (duplicates.length) {
    throw new Error(
      `${name}.ts would not load: ${[...new Set(duplicates)].join(", ")} imported twice. ` +
        `Two shared modules import it in different words — make them match, or have one ` +
        `derive the type from the other (ReturnType<typeof userClient>).`,
    );
  }
}

/**
 * Fails the build if the bundle declares the same name twice at top level.
 *
 * Inlining concatenates modules into one scope, so a helper that two of them
 * define privately — `nonNegative` in both `_shared/ingredients.ts` and
 * `submit-food` — becomes a duplicate declaration and Deno refuses to load the
 * file. The source is fine, every test passes, and the only symptom is a
 * BOOT_ERROR after deploying. That is precisely how it reached production once.
 */
function assertNoDuplicateDeclarations(name, bundle) {
  const declaration = /^(?:export\s+)?(?:async\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

  const seen = new Set();
  const duplicates = new Set();
  for (const [, symbol] of bundle.matchAll(declaration)) {
    if (seen.has(symbol)) duplicates.add(symbol);
    seen.add(symbol);
  }

  if (duplicates.size) {
    throw new Error(
      `${name}.ts would not boot: ${[...duplicates].join(", ")} declared twice. ` +
        `Two inlined modules define it privately — move it into one shared module ` +
        `and import it, or rename one.`,
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
  assertNoDuplicateImports(name, externals);
  assertNoDuplicateDeclarations(name, bundle);
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
  const files = readdirSync(migrationsDir).filter((n) => n.endsWith(".sql")).sort();

  const marker = "-- Storage: meal-photos (private, one folder per user)";

  // The base migration is found by its content, not by being the newest file:
  // every later migration is a follow-up that has no storage block, and picking
  // the newest would have made this throw the moment a second one was added.
  const file = files.find((n) => readFileSync(join(migrationsDir, n), "utf8").includes(marker));
  if (!file) throw new Error("No migration contains the storage block.");

  const sql = readFileSync(join(migrationsDir, file), "utf8");

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

  // Follow-up migrations go to supaUpdate/ ready to paste into the SQL editor.
  // Generated rather than hand-copied for the same reason as everything else
  // here: a copy that can drift is a copy that eventually will.
  const updateDir = join(root, "supaUpdate");
  mkdirSync(updateDir, { recursive: true });

  for (const name of files.filter((n) => n !== file)) {
    writeFileSync(
      join(updateDir, name),
      note(
        `NutriPilot update — ${name.replace(/^\d+_/, "").replace(/\.sql$/, "")}`,
        "GENERATED from supabase/migrations/ — do not edit here.\n" +
          "Paste the whole file into the Supabase SQL editor and run it.\n" +
          "Idempotent: safe to run more than once.\n" +
          "Run supabase/manual/01-schema.sql first if this is a fresh project.",
      ) + readFileSync(join(migrationsDir, name), "utf8").trim() + "\n",
    );
    console.log(`✓ SQL written to supaUpdate/${name}`);
  }
}

/** Hoists external imports and drops `_shared` ones, which are inlined instead. */
function strip(source, externals) {
  for (const match of source.match(EXTERNAL_IMPORT) ?? []) {
    externals.add(match.trim().replace(/;?$/, ";"));
  }
  return source.replace(EXTERNAL_IMPORT, "").replace(SHARED_IMPORT, "").trim();
}
