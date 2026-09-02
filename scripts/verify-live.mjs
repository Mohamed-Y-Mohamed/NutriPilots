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
const REF = process.env.SUPABASE_PROJECT_REF;
const URL = process.env.VITE_SUPABASE_URL ?? `https://${REF}.supabase.co`;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!TOKEN) fail("SUPABASE_ACCESS_TOKEN is not set (see .env.deploy).");
if (!ANON) fail("VITE_SUPABASE_PUBLISHABLE_KEY is not set (see .env).");
// Deliberately not defaulted. This script creates and deletes a real account,
// and a default pointed the whole thing at production for anyone who ran it
// without reading it first.
if (!REF) fail("SUPABASE_PROJECT_REF is not set — name the project to verify (see .env.deploy).");

const results = [];
let serviceKey;
let userId;
let accessToken;

const email = `nutripilot-verify-${Date.now()}@example.com`;
// randomUUID, not Math.random: teardown is best-effort, so a crash can leave
// this account alive, and the password to a live account should not come from
// a generator that is not meant to be unguessable.
const password = `Verify-${crypto.randomUUID()}!9`;

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

    // Which provider and model answered used to come back in the body and be
    // shown in Settings. It is recorded on the row and written to the function
    // logs instead: a reply that names our AI vendor tells anyone with the
    // network tab open how the coach is built.
    const leak = JSON.stringify(response).match(
      /groq|openrouter|llama|gpt-|gemini|cloudflare|"(provider|model|attempts|build)"/i,
    );
    assert(!leak, `the reply body describes the backend: ${leak?.[0]}`);
  });

  /**
   * The pair used to be written by one INSERT, and Postgres stamps every row in
   * a single statement with the same transaction clock. Ordering by created_at
   * then had nothing to break the tie, so reopening the coach could show the
   * reply above the question that prompted it.
   */
  await check("an exchange is stored in the order it happened", async () => {
    const marker = `Ordering check ${Date.now()}: reply with the single word OK.`;
    await callFunction("ai-chat", { message: marker });

    const rows = await rest(
      "/rest/v1/chat_messages?select=role,content,created_at" +
        "&order=created_at.desc,role.asc&limit=60",
    );
    const ordered = rows.reverse();

    const at = ordered.findIndex((row) => row.content === marker);
    assert(at !== -1, "the message just sent is not in the transcript");
    assert(ordered[at].role === "user", `the question came back as ${ordered[at].role}`);
    assert(ordered[at + 1]?.role === "assistant", "no answer directly below the question");
    assert(
      ordered[at].created_at !== ordered[at + 1].created_at,
      "question and answer still share a timestamp — the pair can reorder at any time",
    );
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

  // -------------------------------------------------------------------------
  // Daily AI allowances
  // -------------------------------------------------------------------------

  await check("a new user starts with the free tier's allowances", async () => {
    const [chat] = await rest("/rest/v1/rpc/get_ai_usage", {
      method: "POST",
      body: { p_call_type: "chat" },
    });
    const [vision] = await rest("/rest/v1/rpc/get_ai_usage", {
      method: "POST",
      body: { p_call_type: "vision" },
    });
    assert(chat?.daily_limit === 20, `chat limit was ${chat?.daily_limit}, expected 20`);
    assert(vision?.daily_limit === 8, `vision limit was ${vision?.daily_limit}, expected 8`);
    assert(new Date(Date.parse(chat.resets_at)).getUTCHours() === 0,
      `the reset instant is not midnight UTC: ${chat.resets_at}`);
    console.log(`      chat ${chat.used}/20, photos ${vision.used}/8`);
  });

  await check("the coach's calls were actually counted", async () => {
    // Two coach questions and one photo have been asked by this point.
    const [chat] = await rest("/rest/v1/rpc/get_ai_usage", {
      method: "POST",
      body: { p_call_type: "chat" },
    });
    const [vision] = await rest("/rest/v1/rpc/get_ai_usage", {
      method: "POST",
      body: { p_call_type: "vision" },
    });
    assert(chat.used >= 2, `chat counted ${chat.used}, expected at least 2`);
    assert(vision.used >= 1, `photos counted ${vision.used}, expected at least 1`);
    console.log(`      chat ${chat.used}/20, photos ${vision.used}/8`);
  });

  await check("nobody can refund themselves with a signed-in session", async () => {
    const { status, body } = await restRaw("/rest/v1/rpc/release_ai_usage", {
      method: "POST",
      body: { p_user_id: userId, p_call_type: "chat" },
    });
    // 404 is PostgREST hiding a function this role may not execute.
    assert(status === 404 || status === 403,
      `release_ai_usage answered ${status} ${JSON.stringify(body).slice(0, 160)}`);
  });

  await check("nobody can read the plan limit helper directly", async () => {
    const { status } = await restRaw("/rest/v1/rpc/ai_daily_limit", {
      method: "POST",
      body: { p_plan: "free", p_call_type: "chat" },
    });
    assert(status === 404 || status === 403, `ai_daily_limit answered ${status}`);
  });

  await check("nobody can raise their own daily limit", async () => {
    await restRaw("/rest/v1/ai_plan_limits?plan=eq.free&call_type=eq.chat", {
      method: "PATCH",
      body: { daily_limit: 999999 },
    });
    const [chat] = await rest("/rest/v1/rpc/get_ai_usage", {
      method: "POST",
      body: { p_call_type: "chat" },
    });
    assert(chat.daily_limit === 20, `the limit became ${chat.daily_limit} after a client write`);
  });

  await check("nobody can grant themselves premium", async () => {
    await restRaw("/rest/v1/user_plans", {
      method: "POST",
      body: { user_id: userId, plan: "premium" },
    });
    const [chat] = await rest("/rest/v1/rpc/get_ai_usage", {
      method: "POST",
      body: { p_call_type: "chat" },
    });
    assert(chat.daily_limit === 20, `the limit became ${chat.daily_limit} after a self-granted plan`);
  });

  /**
   * The free tier shipped at one call a minute on every bucket, which made a
   * follow-up question a refusal. The daily caps are what bound the spend; this
   * figure only exists to stop one client hammering the provider, and it does
   * that fine well above 1.
   */
  await check("the free tier allows a follow-up within the same minute", async () => {
    // Read as the service role: ai_plan_limits has RLS on with no policies at
    // all, so that a signed-in user cannot raise their own caps.
    const limits = await serviceRequest(
      "/rest/v1/ai_plan_limits?plan=eq.free&select=call_type,daily_limit,per_minute_limit",
    );
    const chat = limits.find((row) => row.call_type === "chat");
    assert(chat, "no free-tier chat limit row");
    assert(
      chat.per_minute_limit > 1,
      `chat is capped at ${chat.per_minute_limit}/minute — the burst-limit migration has not been applied`,
    );
    assert(chat.daily_limit === 20, `the daily cap moved to ${chat.daily_limit}, expected 20`);
    console.log(
      `      chat ${chat.daily_limit}/day at ${chat.per_minute_limit}/minute`,
    );
  });

  await check("nobody can wipe their own counters", async () => {
    const read = async () =>
      (await rest("/rest/v1/rpc/get_ai_usage", { method: "POST", body: { p_call_type: "chat" } }))[0].used;

    const before = await read();
    await restRaw("/rest/v1/ai_usage_daily?call_type=eq.chat", { method: "DELETE" });
    await restRaw("/rest/v1/ai_usage_daily?call_type=eq.chat", {
      method: "PATCH",
      body: { count: 0 },
    });
    const after = await read();
    assert(after === before, `the counter moved from ${before} to ${after} on a client write`);
  });

  await check("two simultaneous requests cannot both take the last call", async () => {
    // Put the counter one below the cap using the service role, then race it.
    await serviceWrite(
      `/rest/v1/ai_usage_daily?user_id=eq.${userId}&call_type=eq.chat`,
      { count: 19 },
    );
    const races = await Promise.all(
      Array.from({ length: 8 }, () =>
        rest("/rest/v1/rpc/try_increment_ai_usage", {
          method: "POST",
          body: { p_call_type: "chat" },
        })),
    );
    const allowed = races.filter(([row]) => row.allowed).length;
    assert(allowed === 1, `${allowed} of 8 simultaneous requests were allowed, expected 1`);
    console.log("      1 of 8 allowed; the other 7 were refused");
  });

  await check("the call after the cap is refused without touching a model", async () => {
    const [row] = await rest("/rest/v1/rpc/try_increment_ai_usage", {
      method: "POST",
      body: { p_call_type: "chat" },
    });
    assert(row.allowed === false, "a call past the cap was allowed");
    assert(row.used === 20, `used was ${row.used}, expected it to stay at 20`);
  });

  await check("the coach says so rather than calling a model", async () => {
    const { status, body } = await callFunctionRaw("ai-chat", {
      message: "How much protein is in an egg?",
    });
    assert(status === 429, `expected 429, got ${status}`);
    assert(body.code === "usage_limit", `expected usage_limit, got ${body.code}`);
    assert(body.usage?.dailyLimit === 20, "the rejection did not carry the allowance");
    console.log(`      "${String(body.error).slice(0, 88)}"`);
  });

  await check("photos still work when the coach's allowance is gone", async () => {
    const [vision] = await rest("/rest/v1/rpc/get_ai_usage", {
      method: "POST",
      body: { p_call_type: "vision" },
    });
    assert(vision.used < vision.daily_limit, "the vision bucket was drained by chat");
  });

  // -------------------------------------------------------------------------
  // Describe a dish instead of photographing it
  // -------------------------------------------------------------------------

  await check("estimate refuses an empty description before spending a call", async () => {
    const { status } = await callFunctionRaw("submit-food", { mode: "estimate", description: "  " });
    assert(status === 400, `expected 400, got ${status}`);
  });

  await check("estimate refuses an over-long description", async () => {
    const { status } = await callFunctionRaw("submit-food", {
      mode: "estimate",
      description: "rice ".repeat(400),
    });
    assert(status === 400, `expected 400, got ${status}`);
  });

  await check("estimate turns a typed dish into a reviewable recipe draft", async () => {
    // The chat bucket is exhausted by now, so hand this one call back first.
    await serviceCall("/rest/v1/rpc/release_ai_usage", { p_user_id: userId, p_call_type: "chat" });

    const response = await callFunction("submit-food", {
      mode: "estimate",
      description:
        "Chicken and rice traybake: 400g chicken thighs, 2 cups basmati rice, " +
        "1 tbsp olive oil, 1 onion, a handful of spinach. Serves 4.",
    });

    assert(response.recognised === true, `not recognised: ${response.error}`);
    const draft = response.draft;
    assert(draft, "no draft returned");

    // The recipe review card renders RecipeScan["draft"]; a missing field breaks it.
    for (const field of [
      "name", "description", "servings", "prep_time_minutes", "cook_time_minutes",
      "instructions", "cuisine", "calories_per_serving", "protein_per_serving_g",
      "carbs_per_serving_g", "fat_per_serving_g", "fibre_per_serving_g",
      "ingredients", "dietary_tags",
    ]) {
      assert(field in draft, `the draft is missing ${field}`);
    }

    assert(draft.servings === 4, `read ${draft.servings} servings, expected 4`);
    assert(Array.isArray(draft.ingredients) && draft.ingredients.length >= 3,
      `only ${draft.ingredients?.length} ingredient lines`);
    assert(draft.calories_per_serving > 150 && draft.calories_per_serving < 2000,
      `${draft.calories_per_serving} kcal per serving is not plausible`);
    assert(draft.protein_per_serving_g > 10,
      `${draft.protein_per_serving_g}g protein is too low for 400g of chicken`);
    assert(response.review?.fingerprint,
      "no fingerprint, so saving it would pay for a second AI call");

    console.log(
      `      "${draft.name}" — ${draft.calories_per_serving} kcal/serving, ` +
      `P${draft.protein_per_serving_g} C${draft.carbs_per_serving_g} F${draft.fat_per_serving_g}`,
    );
    console.log(
      `      ${response.matchedFromDatabase}/${response.totalIngredients} ingredients matched ` +
      `your own database`,
    );
    for (const item of draft.ingredients) console.log(`        · ${item}`);
  });

  await check("estimate refuses something that is not food", async () => {
    await serviceCall("/rest/v1/rpc/release_ai_usage", { p_user_id: userId, p_call_type: "chat" });
    const response = await callFunction("submit-food", {
      mode: "estimate",
      description: "a chair made of oak with four legs and a cushion",
    });
    assert(response.recognised === false,
      `it accepted furniture as a dish: ${JSON.stringify(response.draft ?? {}).slice(0, 160)}`);
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

async function restRaw(path, { method = "GET", body, headers = {} } = {}) {
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
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

/** A write only the server may make, used to set up a state worth testing. */
async function serviceWrite(path, body) {
  const response = await fetch(`${URL}${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`service write ${path} → ${response.status} ${await response.text()}`);
  }
}

async function serviceCall(path, body) {
  const response = await fetch(`${URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`service call ${path} → ${response.status} ${await response.text()}`);
  }
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
