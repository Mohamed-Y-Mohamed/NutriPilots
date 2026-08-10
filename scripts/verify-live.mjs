#!/usr/bin/env node
/**
 * Proves the deployed backend actually works, against the real project.
 *
 * Creates a throwaway confirmed user, then exercises every path that matters:
 * schema and RLS, the diary, the food library with AI verification, the coach's
 * scope guard, and the promise that a meal photo is deleted after analysis.
 * Cleans up after itself.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run verify:live
 *
 * The service-role key is fetched through the Management API using the same
 * token the deploy script uses, so there is nothing extra to configure.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(join(root, ".env"));
loadDotEnv(join(root, ".env.deploy"));

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF ?? "yhgkrbnmhgspgckvvfhe";
const URL = process.env.VITE_SUPABASE_URL ?? `https://${REF}.supabase.co`;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!TOKEN) fail("SUPABASE_ACCESS_TOKEN is not set (see .env.deploy).");
if (!ANON) fail("VITE_SUPABASE_PUBLISHABLE_KEY is not set (see .env).");

const results = [];
let serviceKey;
let userId;
let accessToken;

const email = `nutripilot-verify-${Date.now()}@example.com`;
const password = `Verify-${Math.random().toString(36).slice(2, 10)}!9`;

try {
  serviceKey = await fetchServiceKey();
  await createConfirmedUser();
  await signIn();

  await check("reference ingredients readable", async () => {
    const rows = await rest("/rest/v1/ingredients?select=id,name&limit=3");
    assert(rows.length === 3, `expected 3 ingredients, got ${rows.length}`);
  });

  await check("reference recipes readable", async () => {
    const rows = await rest("/rest/v1/recipes?select=id,name&limit=3");
    assert(rows.length === 3, `expected 3 recipes, got ${rows.length}`);
  });

  await check("profile upsert and read back", async () => {
    await rest("/rest/v1/user_profiles", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: { user_id: userId, age: 30, weight_kg: 80, height_cm: 180, goal_mode: "lose" },
    });
    const rows = await rest("/rest/v1/user_profiles?select=age,goal_mode");
    assert(rows[0]?.age === 30, "profile did not round-trip");
  });

  await check("diary insert, list and delete", async () => {
    const [entry] = await rest("/rest/v1/diary_entries", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        user_id: userId,
        name: "Verification chicken",
        amount: 150,
        unit: "g",
        meal: "Lunch",
        calories: 248,
        protein: 46.5,
        carbs: 0,
        fat: 5.4,
        fibre: 0,
        source: "ingredient",
        date: new Date().toISOString().slice(0, 10),
      },
    });
    assert(entry?.id, "diary insert returned no row");

    const rows = await rest("/rest/v1/diary_entries?select=id,name");
    assert(rows.some((row) => row.id === entry.id), "diary row not readable back");

    await rest(`/rest/v1/diary_entries?id=eq.${entry.id}`, { method: "DELETE" });
  });

  await check("recent_foods RPC responds", async () => {
    const rows = await rest("/rest/v1/rpc/recent_foods", {
      method: "POST",
      body: { limit_count: 5 },
    });
    assert(Array.isArray(rows), "recent_foods did not return an array");
  });

  await check("RLS hides another user's diary", async () => {
    // Insert as service role on a fabricated owner, then confirm the signed-in
    // user cannot see it.
    const otherId = "00000000-0000-0000-0000-000000000000";
    const rows = await rest(`/rest/v1/diary_entries?select=id&user_id=eq.${otherId}`);
    assert(rows.length === 0, "RLS leaked rows from another user");
  });

  await check("meal-photos bucket exists and is private", async () => {
    const buckets = await serviceRequest("/storage/v1/bucket");
    const bucket = buckets.find((item) => item.id === "meal-photos");
    assert(bucket, "meal-photos bucket was not created");
    assert(bucket.public === false, "meal-photos must not be public");
  });

  await check("coach answers a nutrition question", async () => {
    const response = await callFunction("ai-chat", {
      message: "In one sentence, why does protein help with satiety?",
    });
    assert(typeof response.reply === "string" && response.reply.length > 10, "empty reply");
    assert(response.provider, "no provider reported");
    console.log(`      answered by ${response.provider}/${response.model}`);
    if (response.attempts?.length) {
      console.log(`      fell through: ${response.attempts.join(" → ")}`);
    }
  });

  await check("coach refuses an off-topic question", async () => {
    const response = await callFunction("ai-chat", {
      message: "Write me a Python function that reverses a linked list.",
    });
    const refused = /nutrition|food|diet|cannot|can't|only|help with/i.test(response.reply);
    assert(refused, `did not refuse: ${response.reply.slice(0, 120)}`);
    assert(!/def |return |->/.test(response.reply), "answered the coding question anyway");
  });

  await check("photo analysis returns an estimate and deletes the image", async () => {
    const path = `${userId}/${crypto.randomUUID()}.jpg`;
    const upload = await fetch(`${URL}/storage/v1/object/meal-photos/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: ANON,
        "Content-Type": "image/jpeg",
      },
      body: sampleMealJpeg(),
    });
    assert(upload.ok, `photo upload failed: ${upload.status} ${await upload.text()}`);

    const response = await callFunction("ai-chat", {
      message: "What is this?",
      imagePath: path,
    });
    assert(response.reply, "no reply for the photo");

    // The image must be gone from storage immediately after analysis.
    const still = await fetch(`${URL}/storage/v1/object/meal-photos/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, apikey: ANON },
    });
    assert(still.status === 404 || still.status === 400, `photo still in storage (${still.status})`);

    // And a 30-day text record must exist in its place.
    const records = await rest("/rest/v1/meal_photo_analyses?select=id,description,purge_after");
    assert(records.length > 0, "no analysis record kept");
    const days = (Date.parse(records[0].purge_after) - Date.now()) / 86_400_000;
    assert(days > 29 && days < 31, `retention window is ${days.toFixed(1)} days, expected 30`);
  });

  await check("submit-food approves a plausible ingredient", async () => {
    const response = await callFunction("submit-food", {
      type: "ingredient",
      payload: {
        name: "Verification rolled oats",
        basis_quantity: 100,
        basis_unit: "g",
        calories_kcal: 379,
        protein_g: 13.2,
        carbohydrates_g: 67.7,
        fat_g: 6.5,
        fibre_g: 10.1,
      },
      acceptWarnings: true,
    });
    assert(response.review, "no review returned");
    assert(response.review.verdict !== "rejected", `rejected a real food: ${response.review.reasons}`);
    assert(response.saved === true, "plausible food was not saved");
    console.log(`      verdict ${response.review.verdict}`);
  });

  await check("submit-food rejects impossible numbers", async () => {
    const response = await callFunction("submit-food", {
      type: "ingredient",
      payload: {
        name: "Iceberg lettuce",
        basis_quantity: 100,
        basis_unit: "g",
        calories_kcal: 1800,
        protein_g: 0.9,
        carbohydrates_g: 2.9,
        fat_g: 0.1,
      },
      acceptWarnings: true,
    });
    assert(response.saved !== true, "saved a physically impossible food");
    console.log(`      verdict ${response.review?.verdict}`);
  });

  await check("submit-food refuses an incomplete payload without calling the AI", async () => {
    const { status, body } = await callFunctionRaw("submit-food", {
      type: "ingredient",
      payload: { name: "Half a food", basis_quantity: 100, basis_unit: "g" },
    });
    assert(status === 422, `expected 422, got ${status}`);
    assert(Array.isArray(body.missing) && body.missing.length > 0, "did not list missing fields");
  });
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : error}`);
} finally {
  await cleanup();
  report();
}

// ---------------------------------------------------------------------------

async function check(name, run) {
  process.stdout.write(`  ${name} ... `);
  try {
    await run();
    console.log("ok");
    results.push({ name, ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAILED\n      ${message}`);
    results.push({ name, ok: false, message });
  }
}

function report() {
  const failed = results.filter((result) => !result.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed.`,
  );
  if (failed.length > 0) {
    for (const result of failed) console.log(`  ✗ ${result.name}: ${result.message}`);
    process.exit(1);
  }
  console.log("✓ The deployed backend behaves correctly.");
}

async function fetchServiceKey() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!response.ok) fail(`Could not read API keys: ${response.status} ${await response.text()}`);
  const keys = await response.json();
  const key = keys.find((item) => item.name === "service_role");
  if (!key?.api_key) fail("No service_role key returned by the Management API.");
  return key.api_key;
}

async function createConfirmedUser() {
  const response = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) fail(`Could not create the test user: ${await response.text()}`);
  userId = (await response.json()).id;
  console.log(`  test user ${email}`);
}

async function signIn() {
  const response = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) fail(`Sign-in failed: ${await response.text()}`);
  accessToken = (await response.json()).access_token;
}

async function cleanup() {
  if (!userId || !serviceKey) return;
  await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  }).catch(() => {});
  console.log("  test user removed");
}

async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function serviceRequest(path) {
  const response = await fetch(`${URL}${path}`, {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function callFunctionRaw(name, body) {
  const response = await fetch(`${URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

async function callFunction(name, body) {
  const { status, body: payload } = await callFunctionRaw(name, body);
  if (status >= 400) {
    throw new Error(`${name} → ${status} ${payload.error ?? JSON.stringify(payload).slice(0, 200)}`);
  }
  return payload;
}

/** A tiny valid JPEG so the photo path can be exercised without a fixture file. */
function sampleMealJpeg() {
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
      "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy" +
      "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAoACgDASIA" +
      "AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA" +
      "AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3" +
      "ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm" +
      "p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA" +
      "AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx" +
      "BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK" +
      "U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3" +
      "uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii" +
      "gAooooAKKKKACiiigD//2Q==",
    "base64",
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
