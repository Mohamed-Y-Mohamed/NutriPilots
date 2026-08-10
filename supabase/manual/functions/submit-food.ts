// ============================================================================
// NutriPilot Edge Function: submit-food
//
// GENERATED FILE — do not edit. Edit supabase/functions/submit-food/index.ts (and
// supabase/functions/_shared/*) then run: npm run bundle:functions
//
// This is a single-file copy for pasting into the Supabase dashboard when the
// CLI is not available. The shared modules are inlined below.
// ============================================================================


import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function preflight(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
/**
 * The single AI boundary for NutriPilot.
 *
 * Three providers, all reachable through an OpenAI-compatible endpoint:
 *
 *   chat / photos   Groq  →  OpenRouter free tier  →  Cloudflare Workers AI
 *   verification    OpenRouter free tier  →  Cloudflare  →  Groq
 *
 * Verification runs on the opposite provider so adding a food never eats the
 * quota the conversation depends on. Within a provider the chain steps down
 * through that provider's models first, so one model running out of free quota
 * costs a retry rather than the whole provider.
 *
 * Gemini was removed deliberately: `gemini-2.5-*` now returns 404 "no longer
 * available to new users", and the 3.x models reject the thinking config the
 * older ones required, so the whole fallback was silently dead.
 *
 * Nothing above this module knows which vendor answered.
 */

export type ProviderName = "groq" | "openrouter" | "cloudflare";

export interface ModelSpec {
  provider: ProviderName;
  model: string;
  /** Only vision models are considered when the request carries an image. */
  vision: boolean;
  /**
   * Reasoning models emit a <think> block and will happily spend the entire
   * output budget on it. They need to be told not to.
   */
  reasoning?: boolean;
}

export interface AiMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AiImage {
  mimeType: string;
  /** Base64 without the `data:` prefix. */
  base64: string;
  /** Signed URL, preferred so the bytes stay out of the request body. */
  url?: string;
}

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  image?: AiImage;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface AiResult {
  text: string;
  provider: ProviderName;
  model: string;
  /** Models tried and exhausted before this one answered. */
  attempts: string[];
}

/**
 * Groq answers first — it is by far the fastest. `qwen3.6-27b` is in the list
 * only because it is Groq's sole vision model; it is a reasoning model and
 * needs the flags below to produce an answer rather than a monologue.
 *
 * Every model below was called against its live API and returned a usable
 * reply. The notable absentees, and why:
 *   google/gemma-4-31b-it:free            errors on every call
 *   inclusionai/ling-3.0-tiny:free        returns an empty body
 *   @cf/openai/gpt-oss-20b                200 with no message content
 *   @cf/meta/llama-3.2-11b-vision-instruct  403 until a model agreement is
 *                                           accepted in the Cloudflare console
 */
export const CHAT_MODELS: ModelSpec[] = [
  { provider: "groq", model: "llama-3.3-70b-versatile", vision: false },
  { provider: "groq", model: "openai/gpt-oss-120b", vision: false },
  { provider: "groq", model: "qwen/qwen3.6-27b", vision: true, reasoning: true },
  { provider: "groq", model: "openai/gpt-oss-20b", vision: false },
  { provider: "groq", model: "llama-3.1-8b-instant", vision: false },
  { provider: "openrouter", model: "openai/gpt-oss-20b:free", vision: false },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", vision: false },
  { provider: "openrouter", model: "nvidia/nemotron-nano-9b-v2:free", vision: false },
  // Last-resort vision fallback. Slow and often unavailable, but a photo that
  // Groq cannot take is better served by a slow answer than by no answer.
  { provider: "openrouter", model: "nvidia/nemotron-nano-12b-v2-vl:free", vision: true },
  { provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", vision: false },
  { provider: "cloudflare", model: "@cf/meta/llama-4-scout-17b-16e-instruct", vision: true },
  { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct-fp8", vision: false },
];

/** Verification is kept off the chat quota entirely. */
export const VERIFY_MODELS: ModelSpec[] = [
  { provider: "openrouter", model: "openai/gpt-oss-20b:free", vision: false },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", vision: false },
  { provider: "openrouter", model: "nvidia/nemotron-nano-9b-v2:free", vision: false },
  { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct-fp8", vision: false },
  { provider: "groq", model: "llama-3.1-8b-instant", vision: false },
];

const KEY_NAMES: Record<ProviderName, string> = {
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cloudflare: "CLOUDFLARE_API_TOKEN",
};

/**
 * Cloudflare's URL carries the account id, so endpoints are resolved rather
 * than looked up. Its OpenAI-compatible route means one request shape serves
 * all three providers.
 */
function endpointFor(provider: ProviderName): string {
  switch (provider) {
    case "groq":
      return "https://api.groq.com/openai/v1/chat/completions";
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "cloudflare":
      return `https://api.cloudflare.com/client/v4/accounts/${
        Deno.env.get("CLOUDFLARE_ACCOUNT_ID")
      }/ai/v1/chat/completions`;
  }
}

/** Cloudflare needs an account id as well as a token; the others need only a key. */
function isConfigured(provider: ProviderName): boolean {
  if (!Deno.env.get(KEY_NAMES[provider])) return false;
  if (provider === "cloudflare") return Boolean(Deno.env.get("CLOUDFLARE_ACCOUNT_ID"));
  return true;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/**
 * A model is exhausted (not broken) when it rate limits, runs out of credit,
 * is decommissioned, or falls over. Those are worth retrying anywhere. A plain
 * 400 means this provider rejected the request itself, so its sibling models
 * will reject it identically — but a different vendor may well accept it.
 */
function isRetryable(status: number, body: string): boolean {
  if (status === 429 || status === 402 || status === 408 || status === 404) return true;
  if (status >= 500) return true;
  if (status === 403 && /quota|billing|permission/i.test(body)) return true;
  return /rate.?limit|quota|insufficient|over.?capacity|overloaded|exhausted|decommission|not.?found|unavailable/i
    .test(body);
}

export async function callAi(
  request: AiRequest,
  chain: ModelSpec[] = CHAT_MODELS,
): Promise<AiResult> {
  const needsVision = Boolean(request.image);

  const usable = chain.filter(
    (spec) => (!needsVision || spec.vision) && isConfigured(spec.provider),
  );

  if (usable.length === 0) {
    throw new AiError(
      needsVision
        ? "No vision-capable AI model is configured on the server."
        : "No AI provider is configured on the server.",
      503,
      false,
    );
  }

  const attempts: string[] = [];
  const rejectedProviders = new Set<ProviderName>();
  let lastError: unknown;

  for (const spec of usable) {
    // A provider that rejected the request outright will reject it again on
    // every sibling model. Skip to the next vendor instead of hammering it.
    if (rejectedProviders.has(spec.provider)) continue;

    const apiKey = Deno.env.get(KEY_NAMES[spec.provider])!;
    try {
      const text = await callProvider(spec, request, apiKey);
      return { text, provider: spec.provider, model: spec.model, attempts };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof AiError ? error.retryable : true;

      console.error(
        `[ai] ${spec.provider}/${spec.model} failed:`,
        error instanceof Error ? error.message.slice(0, 200) : "unknown",
        `retryable=${retryable}`,
      );

      if (!retryable) rejectedProviders.add(spec.provider);
      attempts.push(`${spec.provider}/${spec.model}`);
    }
  }

  // Every model was tried and every one failed. That is the only case the user
  // ever hears about — individual model switches are silent by design. The last
  // failure is carried through so the logs say why.
  const cause = lastError instanceof Error ? lastError.message.slice(0, 200) : "unknown";
  throw new AiError(
    `All ${attempts.length} models exhausted (${attempts.join(", ")}); last: ${cause}`,
    429,
    false,
  );
}

// ---------------------------------------------------------------------------

async function callProvider(
  spec: ModelSpec,
  request: AiRequest,
  apiKey: string,
): Promise<string> {
  // Prefer the signed URL so image bytes stay out of the request body. If the
  // provider cannot fetch it, retry once inline before giving up on this model.
  if (request.image?.url) {
    try {
      return await chatCompletion(spec, request, apiKey, request.image.url);
    } catch (error) {
      if (!(error instanceof AiError) || error.status !== 400) throw error;
      console.error(`[ai] ${spec.model} could not use the signed URL, retrying inline`);
    }
  }

  const inline = request.image
    ? `data:${request.image.mimeType};base64,${request.image.base64}`
    : undefined;
  return await chatCompletion(spec, request, apiKey, inline);
}

async function chatCompletion(
  spec: ModelSpec,
  request: AiRequest,
  apiKey: string,
  imageUrl?: string,
): Promise<string> {
  const messages: unknown[] = [{ role: "system", content: request.system }];

  request.messages.forEach((message, index) => {
    const isLast = index === request.messages.length - 1;
    if (isLast && message.role === "user" && imageUrl) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: message.text },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      });
    } else {
      messages.push({ role: message.role, content: message.text });
    }
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (spec.provider === "openrouter") {
    // OpenRouter asks callers to identify themselves for free-tier accounting.
    headers["HTTP-Referer"] = "https://nutripilot.app";
    headers["X-Title"] = "NutriPilot";
  }

  const response = await fetchWithTimeout(endpointFor(spec.provider), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: spec.model,
      messages,
      temperature: request.temperature ?? 0.3,
      max_completion_tokens: request.maxTokens ?? 900,
      // A reasoning model left alone spends the whole output budget thinking
      // and returns a truncated <think> block instead of an answer. Both flags
      // are sent because providers differ in which one they honour.
      ...(spec.reasoning ? { reasoning_format: "hidden", reasoning_effort: "none" } : {}),
      ...(request.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AiError(
      `${spec.provider} ${response.status}: ${body.slice(0, 300)}`,
      response.status,
      isRetryable(response.status, body),
    );
  }

  const completion = await response.json();

  // OpenRouter returns 200 with an error body when an upstream model fails.
  if (completion?.error) {
    const message = String(completion.error.message ?? "upstream error");
    throw new AiError(`${spec.provider}: ${message}`, 502, true);
  }

  const raw = completion?.choices?.[0]?.message?.content;
  const text = cleanModelText(typeof raw === "string" ? raw : "");

  if (!text) {
    // Usually a reasoning model that spent its whole budget thinking. The next
    // model gets a turn rather than the user getting a wall of monologue.
    const reason = completion?.choices?.[0]?.finish_reason ?? "unknown";
    throw new AiError(
      `${spec.model} returned no usable answer (finish_reason=${reason}).`,
      502,
      true,
    );
  }
  return text;
}

/**
 * Strips a model's internal monologue. Reasoning models are asked not to emit
 * one, but the flags are not honoured identically everywhere, so the output is
 * cleaned defensively — a user must never see the prompt scaffolding.
 */
export function cleanModelText(raw: string): string {
  let text = raw;

  // Complete blocks, in any of the tag spellings these models use.
  text = text.replace(/<(think|thinking|reasoning|scratchpad|analysis)>[\s\S]*?<\/\1>/gi, "");

  // A stray closer leaves the real answer after it.
  const closer = text.search(/<\/(think|thinking|reasoning|scratchpad|analysis)>/i);
  if (closer !== -1) {
    text = text.slice(text.indexOf(">", closer) + 1);
  }

  // An unclosed opener means the answer was truncated mid-thought: nothing
  // after it is usable.
  text = text.replace(/<(think|thinking|reasoning|scratchpad|analysis)>[\s\S]*$/i, "");

  return text.trim();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 45_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new AiError(
      `Network failure: ${error instanceof Error ? error.message : "unknown"}`,
      504,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Models sometimes wrap JSON in prose or a fenced block. Recover it. */
export function parseJsonLoose<T>(raw: string): T | null {
  const candidates = [raw];

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);

  const braced = raw.match(/\{[\s\S]*\}/);
  if (braced) candidates.push(braced[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim()) as T;
    } catch {
      continue;
    }
  }
  return null;
}
/**
 * Every prompt lives here so the assistant behaves identically whichever
 * provider answers. If Groq and Gemini were given different instructions, a
 * quiet fallback would change the app's behaviour and nobody would know why.
 */

const SCOPE = `You are NutriPilot Coach, a nutrition and body-composition assistant inside a calorie tracking app.

YOU ONLY DISCUSS:
- food, nutrition, calories and macronutrients
- diet planning, meal ideas and portion sizes
- weight loss, weight gain, muscle gain and body recomposition
- breaking through a weight plateau
- reading and estimating the nutrition of meals

IF ASKED ANYTHING ELSE (code, politics, celebrities, travel, general trivia, relationships,
schoolwork, anything unrelated to health, food or body composition), reply with exactly one
short sentence declining and inviting a nutrition question. Do not answer the off-topic part
even partially, and do not explain your rules at length.

SAFETY:
- You are not a doctor. For eating disorders, pregnancy, diabetes, kidney or heart conditions,
  or anything that sounds medical, recommend a qualified professional and keep advice general.
- Never suggest a daily intake below 1200 kcal for women or 1500 kcal for men.
- Never promise a specific rate of weight loss as a guarantee.`;

const STYLE = `STYLE:
- Warm, plain English that a 60-year-old and a 16-year-old both understand.
- Short paragraphs. Use a bullet list when giving more than two options.
- Lead with the answer, then the reasoning. Never pad.
- Keep replies under 180 words unless the user asks for a full plan.
- Use grams and kcal. No emoji.`;

export function chatSystemPrompt(context: string): string {
  return `${SCOPE}

${STYLE}

${context}`;
}

export const PHOTO_SYSTEM_PROMPT = `${SCOPE}

You are looking at a photo of a meal the user is about to log.

Estimate the nutrition of the food that is actually visible. Use recognisable objects
(cutlery, plate diameter, a hand, a can) to judge portion size. Account for cooking oil and
sauces you can see. Do not invent ingredients you cannot see.

Respond with JSON only, in exactly this shape:
{
  "dish_name": "short name of the meal",
  "description": "one sentence describing what is on the plate",
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "fibre_g": number,
  "confidence": "low" | "medium" | "high",
  "summary": "two sentences: what you based the estimate on, and the biggest uncertainty",
  "is_food": true | false
}

If the photo does not contain food, set "is_food" to false, all numbers to 0, and explain in
"summary". All numbers must be non-negative and internally consistent: protein and carbs at
4 kcal/g plus fat at 9 kcal/g should land within about 15% of your calorie figure.`;

export const INGREDIENT_VERIFY_PROMPT =
  `You are a food-database reviewer for a nutrition app. A user has submitted a food to add to
their personal library. Decide whether the nutrition values are physically plausible for a real
food with that name.

Check:
- Do protein x4 + carbs x4 + fat x9 land within about 20% of the stated calories?
- Are the values sane for the stated amount and unit (e.g. no 900 kcal per 100g of lettuce)?
- Does protein + carbs + fat exceed the total weight of the basis quantity?
- Does the name describe a real, recognisable food?

Respond with JSON only:
{
  "verdict": "approved" | "needs_review" | "rejected",
  "confidence": "low" | "medium" | "high",
  "reasons": ["short plain-English reason", "..."],
  "suggested": { "calories_kcal": number, "protein_g": number, "carbohydrates_g": number, "fat_g": number } | null
}

Use "approved" when the numbers are realistic. Use "needs_review" when they are questionable but
possible — include "suggested" with better values. Use "rejected" only when the food is not real
or the numbers are impossible. Keep each reason under 15 words.`;

export const RECIPE_VERIFY_PROMPT =
  `You are a recipe reviewer for a nutrition app. A user has submitted a recipe to add to their
personal library. Decide whether it is a real, cookable recipe and whether the per-serving
nutrition is approximately accurate for its ingredients.

Check:
- Is this a genuine recipe rather than nonsense or a joke entry?
- Do the listed ingredients plausibly produce the stated per-serving calories and macros?
- Do protein x4 + carbs x4 + fat x9 land within about 20% of the stated calories?
- Are the instructions coherent enough to actually follow?

Respond with JSON only:
{
  "verdict": "approved" | "needs_review" | "rejected",
  "confidence": "low" | "medium" | "high",
  "reasons": ["short plain-English reason", "..."],
  "suggested": { "calories_per_serving": number, "protein_per_serving_g": number, "carbs_per_serving_g": number, "fat_per_serving_g": number } | null
}

Use "approved" when the recipe is real and the numbers are close. Use "needs_review" when the
recipe is real but the nutrition looks off — include "suggested" with better values. Use
"rejected" only for entries that are not real recipes. Keep each reason under 15 words.`;

/**
 * One call that does three jobs at once: read the food from a photo, fill in
 * whatever the photo does not show from typical values for that food, and
 * judge whether the result is plausible. Splitting these would triple the
 * number of requests against a free tier for no benefit.
 */
export const INGREDIENT_SCAN_PROMPT =
  `You are a food-label reader and nutrition estimator for a diary app.

The user has photographed either a packaged food's nutrition label, or the food itself.

STEP 1 - IDENTIFY
Work out what the food is. Read the brand and product name if they are visible.

STEP 2 - READ WHAT IS THERE
Take every nutrition value you can actually read from the image. Convert everything to a
per-100g basis, or per-100ml for a drink. If the label is per-serving, convert it using the
serving size shown.

STEP 3 - FILL THE GAPS
For any field the image does not show, estimate it from well-known typical values for that food,
the way a reference database would. Give a single representative number, not a range. Never leave
a macro empty - a diary entry with missing macros is useless. List every field you estimated
rather than read in "estimated_fields".

STEP 4 - CHECK YOURSELF
Protein x4 plus carbs x4 plus fat x9 should land within about 20% of the calories. Correct your
numbers if they do not. Protein, carbs and fat together must not exceed 100g per 100g of food.

Respond with JSON only:
{
  "recognised": true,
  "name": "short food name",
  "brand": "brand or empty string",
  "basis_unit": "g",
  "calories_kcal": 0,
  "protein_g": 0,
  "carbohydrates_g": 0,
  "fat_g": 0,
  "saturated_fat_g": 0,
  "sugars_g": 0,
  "fibre_g": 0,
  "salt_g": 0,
  "sodium_mg": 0,
  "category": "e.g. Vegetables, Dairy, Snacks",
  "dietary_tags": ["vegan"],
  "estimated_fields": ["protein_g"],
  "read_from": "label",
  "verdict": "approved",
  "confidence": "high",
  "reasons": ["short plain-English note about anything uncertain"]
}

"basis_unit" is "g" or "ml". "read_from" is "label" or "food". "verdict" is "approved",
"needs_review" or "rejected". "confidence" is "low", "medium" or "high".

Set "recognised" to false and "verdict" to "rejected" only when the photo contains no food and no
nutrition label. Use "needs_review" when you had to estimate most of the values. Every number must
be non-negative. Keep each reason under 15 words.`;
/**
 * A client that acts as the calling user. Every query it runs is subject to
 * row level security, so a function can never read another user's rows by
 * accident.
 */
export function userClient(authorization: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
}

/** Bypasses RLS. Only for deletes/cleanup that RLS cannot express. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface AuthedUser {
  id: string;
  email: string | null;
}

/**
 * Resolves the bearer token to a real user. Returns null when the token is
 * missing, expired or invalid — callers must treat that as 401.
 */
export async function requireUser(
  request: Request,
): Promise<{ user: AuthedUser; authorization: string } | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const client = userClient(authorization);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  return {
    user: { id: data.user.id, email: data.user.email ?? null },
    authorization,
  };
}
/**
 * Adds a user-authored ingredient or recipe to their library, but only after
 * an AI plausibility review. Schema validation runs first so the model is never
 * asked to judge an incomplete payload, and the insert happens here so a
 * verdict cannot be skipped by the client.
 */







type Verdict = "approved" | "needs_review" | "rejected";

interface Review {
  verdict: Verdict;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  suggested: Record<string, number> | null;
}

const INGREDIENT_REQUIRED = [
  "name",
  "basis_quantity",
  "basis_unit",
  "calories_kcal",
  "protein_g",
  "carbohydrates_g",
  "fat_g",
] as const;

const RECIPE_REQUIRED = [
  "name",
  "servings",
  "calories_per_serving",
  "protein_per_serving_g",
  "carbs_per_serving_g",
  "fat_per_serving_g",
] as const;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authed = await requireUser(request);
  if (!authed) return json({ error: "Please sign in first." }, 401);

  let body: {
    type?: unknown;
    payload?: unknown;
    acceptWarnings?: unknown;
    mode?: unknown;
    imagePath?: unknown;
    review?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  // Scanning reads the food, fills the gaps and judges plausibility in a single
  // AI call, then hands the draft back for the user to check. Saving afterwards
  // reuses that verdict rather than paying for a second call.
  if (body.mode === "scan") {
    if (typeof body.imagePath !== "string") {
      return json({ error: "A photo is required to scan." }, 400);
    }
    if (!body.imagePath.startsWith(authed.user.id + "/")) {
      return json({ error: "That photo does not belong to you." }, 403);
    }
    return await scanIngredient(authed.authorization, body.imagePath);
  }

  const type = body.type === "recipe" ? "recipe" : body.type === "ingredient" ? "ingredient" : null;
  if (!type) return json({ error: "Specify type as 'ingredient' or 'recipe'." }, 400);

  const payload = body.payload;
  if (!payload || typeof payload !== "object") {
    return json({ error: "Missing food details." }, 400);
  }

  const record = payload as Record<string, unknown>;
  const missing = (type === "ingredient" ? INGREDIENT_REQUIRED : RECIPE_REQUIRED)
    .filter((field) => !isPresent(record[field]));

  if (missing.length > 0) {
    return json({
      error: "Some required nutrition fields are missing.",
      missing,
    }, 422);
  }

  const shapeError = type === "ingredient"
    ? validateIngredient(record)
    : validateRecipe(record);
  if (shapeError) return json({ error: shapeError }, 422);

  // A review carried back from a scan is reused: the AI has already judged
  // exactly these numbers, so a second call would buy nothing.
  const carried = carriedReview(body.review, record);

  let review: Review;
  try {
    review = carried ?? (await reviewWithAi(type, record));
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[submit-food] review unavailable", error.message);
      return json({
        error: error.status === 429
          ? "You have reached today's AI limit, so this could not be checked and nothing was saved. Please try again tomorrow."
          : "The verification service is unavailable, so nothing was saved. Please try again shortly.",
        code: error.status === 429 ? "daily_limit" : "unavailable",
      }, error.status === 429 ? 429 : 503);
    }
    throw error;
  }

  if (review.verdict === "rejected") {
    return json({ saved: false, review }, 200);
  }

  // "needs_review" still saves — it is the user's own library — but the row is
  // flagged so the UI can show a warning badge.
  if (review.verdict === "needs_review" && body.acceptWarnings !== true) {
    return json({ saved: false, review, requiresConfirmation: true }, 200);
  }

  const client = userClient(authed.authorization);
  const table = type === "ingredient" ? "user_ingredients" : "user_recipes";
  const row = type === "ingredient"
    ? buildIngredientRow(authed.user.id, record, review)
    : buildRecipeRow(authed.user.id, record, review);

  const { data, error } = await client.from(table).insert(row).select().single();

  if (error) {
    console.error("[submit-food] insert failed", error.message);
    return json({ error: `Could not save: ${error.message}` }, 400);
  }

  return json({ saved: true, review, item: data }, 201);
});

// ---------------------------------------------------------------------------

async function scanIngredient(authorization: string, imagePath: string): Promise<Response> {
  const client = userClient(authorization);

  const download = await client.storage.from("meal-photos").download(imagePath);
  if (download.error || !download.data) {
    return json({ error: "That photo could not be read. Please retake it." }, 404);
  }

  const bytes = new Uint8Array(await download.data.arrayBuffer());
  const mimeType = download.data.type || "image/jpeg";
  const signed = await client.storage.from("meal-photos").createSignedUrl(imagePath, 300);

  let result;
  try {
    result = await callAi({
      system: INGREDIENT_SCAN_PROMPT,
      messages: [{ role: "user", text: "Read this food and fill in its nutrition." }],
      image: { mimeType, base64: encodeBase64(bytes), url: signed.data?.signedUrl },
      json: true,
      maxTokens: 900,
      temperature: 0.2,
    }, CHAT_MODELS);
  } catch (error) {
    // The photo is disposable either way; never leave it in the bucket.
    await client.storage.from("meal-photos").remove([imagePath]);
    if (error instanceof AiError) {
      const exhausted = error.status === 429;
      return json({
        error: exhausted
          ? "You have reached today's AI limit. Please enter the food by hand instead."
          : "Could not read that photo. Try a clearer one, or enter the food by hand.",
      }, exhausted ? 429 : 502);
    }
    throw error;
  }

  await client.storage.from("meal-photos").remove([imagePath]);

  const parsed = parseJsonLoose<Record<string, unknown>>(result.text);
  if (!parsed) {
    return json({ error: "Could not read that photo. Please enter the food by hand." }, 502);
  }

  if (parsed.recognised === false) {
    return json({
      recognised: false,
      error: "That photo does not look like a food or a nutrition label.",
    }, 200);
  }

  const draft = {
    name: scanText(parsed.name, ""),
    brand: scanText(parsed.brand, ""),
    basis_quantity: 100,
    basis_unit: parsed.basis_unit === "ml" ? "ml" : "g",
    calories_kcal: scanNumber(parsed.calories_kcal),
    protein_g: scanNumber(parsed.protein_g),
    carbohydrates_g: scanNumber(parsed.carbohydrates_g),
    fat_g: scanNumber(parsed.fat_g),
    saturated_fat_g: scanNumber(parsed.saturated_fat_g),
    sugars_g: scanNumber(parsed.sugars_g),
    fibre_g: scanNumber(parsed.fibre_g),
    salt_g: scanNumber(parsed.salt_g),
    sodium_mg: scanNumber(parsed.sodium_mg),
    category: scanText(parsed.category, ""),
    dietary_tags: Array.isArray(parsed.dietary_tags)
      ? parsed.dietary_tags.filter((tag): tag is string => typeof tag === "string").slice(0, 11)
      : [],
  };

  const verdict = parsed.verdict === "approved" || parsed.verdict === "rejected"
    ? parsed.verdict
    : "needs_review";

  return json({
    recognised: true,
    draft,
    estimatedFields: Array.isArray(parsed.estimated_fields)
      ? parsed.estimated_fields.filter((f): f is string => typeof f === "string")
      : [],
    readFrom: parsed.read_from === "label" ? "label" : "food",
    review: {
      verdict,
      confidence: parsed.confidence === "high" || parsed.confidence === "medium"
        ? parsed.confidence
        : "low",
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((r): r is string => typeof r === "string").slice(0, 5)
        : [],
      suggested: null,
      // Ties the verdict to the exact numbers it was made against.
      fingerprint: fingerprint(draft),
    },
  }, 200);
}

/**
 * A verdict handed back from a scan is honoured only while it still describes
 * the numbers being saved. Edit a macro after scanning and it stops matching,
 * so the food goes through a normal review instead.
 */
function carriedReview(value: unknown, record: Record<string, unknown>): Review | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.fingerprint !== "string") return null;
  if (candidate.fingerprint !== fingerprint(record)) return null;

  const verdict = candidate.verdict;
  if (verdict !== "approved" && verdict !== "needs_review") return null;

  return {
    verdict,
    confidence: candidate.confidence === "high" || candidate.confidence === "medium"
      ? candidate.confidence
      : "low",
    reasons: Array.isArray(candidate.reasons)
      ? candidate.reasons.filter((r): r is string => typeof r === "string")
      : [],
    suggested: null,
  };
}

/** The values a review was actually made against. */
function fingerprint(record: Record<string, unknown>): string {
  return [
    String(record.name ?? "").trim().toLowerCase(),
    Number(record.calories_kcal ?? 0),
    Number(record.protein_g ?? 0),
    Number(record.carbohydrates_g ?? 0),
    Number(record.fat_g ?? 0),
  ].join("|");
}

function scanNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : 0;
}

function scanText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : fallback;
}

async function reviewWithAi(
  type: "ingredient" | "recipe",
  record: Record<string, unknown>,
): Promise<Review> {
  const result = await callAi({
    system: type === "ingredient" ? INGREDIENT_VERIFY_PROMPT : RECIPE_VERIFY_PROMPT,
    messages: [{ role: "user", text: JSON.stringify(record) }],
    json: true,
    maxTokens: 500,
    temperature: 0.1,
  }, VERIFY_MODELS);

  const parsed = parseJsonLoose<Partial<Review>>(result.text);
  if (!parsed) {
    // A model that cannot produce a verdict must not silently approve.
    return {
      verdict: "needs_review",
      confidence: "low",
      reasons: ["Automatic checking could not read the review result."],
      suggested: null,
    };
  }

  const verdict: Verdict = parsed.verdict === "approved" || parsed.verdict === "rejected"
    ? parsed.verdict
    : "needs_review";

  return {
    verdict,
    confidence: parsed.confidence === "high" || parsed.confidence === "medium"
      ? parsed.confidence
      : "low",
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 5)
      : [],
    suggested: parsed.suggested && typeof parsed.suggested === "object"
      ? parsed.suggested as Record<string, number>
      : null,
  };
}

function validateIngredient(record: Record<string, unknown>): string | null {
  if (String(record.name).trim().length < 2) return "Give the food a name.";
  if (!["g", "ml"].includes(String(record.basis_unit))) {
    return "Amount unit must be g or ml.";
  }
  const basis = Number(record.basis_quantity);
  if (!(basis > 0 && basis <= 5000)) return "Basis amount must be between 1 and 5000.";

  const calories = Number(record.calories_kcal);
  if (!(calories >= 0 && calories <= 2000)) {
    return "Calories per basis amount look impossible.";
  }

  const macroGrams = Number(record.protein_g) + Number(record.carbohydrates_g) + Number(record.fat_g);
  if (macroGrams > basis * 1.05) {
    return "Protein, carbs and fat together weigh more than the food itself.";
  }
  return null;
}

function validateRecipe(record: Record<string, unknown>): string | null {
  if (String(record.name).trim().length < 2) return "Give the recipe a name.";
  const servings = Number(record.servings);
  if (!(servings > 0 && servings <= 50)) return "Servings must be between 1 and 50.";
  const calories = Number(record.calories_per_serving);
  if (!(calories >= 0 && calories <= 5000)) {
    return "Calories per serving look impossible.";
  }
  const ingredients = record.ingredients;
  if (!Array.isArray(ingredients) || ingredients.length === 0) {
    return "Add at least one ingredient.";
  }
  return null;
}

function buildIngredientRow(
  userId: string,
  record: Record<string, unknown>,
  review: Review,
) {
  return {
    user_id: userId,
    name: String(record.name).trim().slice(0, 160),
    brand: optionalText(record.brand, 120),
    food_type: "ingredient",
    basis_quantity: Number(record.basis_quantity),
    basis_unit: String(record.basis_unit),
    calories_kcal: nonNegative(record.calories_kcal),
    protein_g: nonNegative(record.protein_g),
    carbohydrates_g: nonNegative(record.carbohydrates_g),
    fat_g: nonNegative(record.fat_g),
    saturated_fat_g: optionalNumber(record.saturated_fat_g),
    sugars_g: optionalNumber(record.sugars_g),
    fibre_g: optionalNumber(record.fibre_g),
    salt_g: optionalNumber(record.salt_g),
    sodium_mg: optionalNumber(record.sodium_mg),
    category: optionalText(record.category, 80),
    dietary_tags: Array.isArray(record.dietary_tags)
      ? record.dietary_tags.filter((tag): tag is string => typeof tag === "string").slice(0, 11)
      : null,
    notes: optionalText(record.notes, 500),
    verification: review,
    verified_at: new Date().toISOString(),
  };
}

function buildRecipeRow(
  userId: string,
  record: Record<string, unknown>,
  review: Review,
) {
  const ingredients = Array.isArray(record.ingredients) ? record.ingredients : [];
  return {
    user_id: userId,
    name: String(record.name).trim().slice(0, 160),
    description: optionalText(record.description, 600),
    image_url: optionalText(record.image_url, 500),
    servings: Number(record.servings),
    prep_time_minutes: optionalInt(record.prep_time_minutes),
    cook_time_minutes: optionalInt(record.cook_time_minutes),
    instructions: optionalText(record.instructions, 6000),
    calories_per_serving: nonNegative(record.calories_per_serving),
    protein_per_serving_g: nonNegative(record.protein_per_serving_g),
    carbs_per_serving_g: nonNegative(record.carbs_per_serving_g),
    fat_per_serving_g: nonNegative(record.fat_per_serving_g),
    fibre_per_serving_g: optionalNumber(record.fibre_per_serving_g),
    saturated_fat_per_serving_g: optionalNumber(record.saturated_fat_per_serving_g),
    sugar_per_serving_g: optionalNumber(record.sugar_per_serving_g),
    sodium_per_serving_mg: optionalNumber(record.sodium_per_serving_mg),
    cuisine: optionalText(record.cuisine, 80),
    dietary_tags: Array.isArray(record.dietary_tags)
      ? record.dietary_tags.filter((tag): tag is string => typeof tag === "string").slice(0, 11)
      : null,
    ingredients,
    ingredient_count: ingredients.length,
    verification: review,
    verified_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function optionalNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function optionalInt(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function optionalText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}
