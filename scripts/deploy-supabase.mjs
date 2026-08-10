#!/usr/bin/env node
/**
 * Provisions the NutriPilot Supabase project end to end:
 *   1. runs every migration in supabase/migrations (schema, RLS, storage bucket)
 *   2. uploads the AI keys as Edge Function secrets
 *   3. deploys the five Edge Functions
 *
 * Requires a Supabase Personal Access Token. The publishable key cannot do any
 * of this — it is a client-side read key.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run supabase:deploy
 *
 * Every step is idempotent, so re-running after a partial failure is safe.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

loadDotEnv(join(root, ".env"));
loadDotEnv(join(root, ".env.deploy"));

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF ?? "yhgkrbnmhgspgckvvfhe";
const API = "https://api.supabase.com/v1";

const FUNCTIONS = [
  "ai-chat",
  "submit-food",
  "promote-food",
  "delete-account",
  "purge-meal-photos",
];

if (!TOKEN) {
  fail(
    "SUPABASE_ACCESS_TOKEN is not set.\n\n" +
      "  1. Open https://supabase.com/dashboard/account/tokens\n" +
      "  2. Generate a new token\n" +
      "  3. Add it to .env.deploy as SUPABASE_ACCESS_TOKEN=sbp_...\n",
  );
}

const only = process.argv[2];

try {
  if (!only || only === "db") await runMigrations();
  if (!only || only === "secrets") await pushSecrets();
  if (!only || only === "functions") deployFunctions();
  console.log("\n✓ Supabase is provisioned.");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------

async function runMigrations() {
  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();

  if (files.length === 0) throw new Error("No migrations found.");

  for (const file of files) {
    process.stdout.write(`  migration ${file} ... `);
    const sql = readFileSync(join(dir, file), "utf8");
    await api(`/projects/${REF}/database/query`, { query: sql });
    console.log("ok");
  }
}

async function pushSecrets() {
  const required = ["GROQ_API_KEY", "OPENROUTER_API_KEY"];
  const optional = ["PURGE_SECRET", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];

  const secrets = [];
  for (const name of [...required, ...optional]) {
    const value = process.env[name];
    if (value) secrets.push({ name, value });
    else if (required.includes(name)) {
      throw new Error(`${name} is not set. Add it to .env.deploy.`);
    }
  }

  process.stdout.write(`  secrets (${secrets.map((s) => s.name).join(", ")}) ... `);
  await api(`/projects/${REF}/secrets`, secrets);
  console.log("ok");
}

function deployFunctions() {
  for (const name of FUNCTIONS) {
    process.stdout.write(`  function ${name} ... `);
    execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["--yes", "supabase@latest", "functions", "deploy", name, "--project-ref", REF],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: TOKEN },
      },
    );
    console.log("ok");
  }
}

async function api(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${text.slice(0, 600)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, "");
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}
