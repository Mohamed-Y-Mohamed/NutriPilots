// ============================================================================
// NutriPilot Edge Function: ai-chat
//
// GENERATED FILE — do not edit. Edit supabase/functions/ai-chat/index.ts (and
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

/**
 * When the coach names specific meals it appends a machine-readable block, so
 * the app can offer to log them. The block is stripped before display — the
 * user only ever sees prose.
 */
const LOGGABLE = `LOGGING SUGGESTED MEALS:
When your answer names one or more specific meals or foods with a calorie figure, append this
block to the very end of your reply, after all prose:

<<<LOG
[{"name":"Chicken and chickpea traybake","ingredients":["200g chicken thighs","150g chickpeas","1 tbsp olive oil"],"calories":520,"protein_g":42,"carbs_g":30,"fat_g":22,"fibre_g":6,"servings":1}]
LOG>>>

Rules for the block:
- Only include meals you actually named in the reply. Never invent extras.
- "ingredients" lists what the calorie figure is based on, with amounts for one serving.
- One entry per meal, at most four.
- Every number is per one serving of that meal, and must be non-negative.
- Omit the block entirely when your reply names no specific meal.
- Never mention the block, and never wrap it in code fences.`;

export function chatSystemPrompt(context: string): string {
  return `${SCOPE}

${STYLE}

${LOGGABLE}

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
  "ingredients": ["3 eggs", "400g chopped tomatoes", "1 tbsp olive oil"],
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "fibre_g": number,
  "confidence": "low" | "medium" | "high",
  "summary": "two sentences: what you based the estimate on, and the biggest uncertainty",
  "is_food": true | false
}

"ingredients" is the list your calorie figure is actually based on, with the amounts you assumed
for this portion. Name what you can see, plus the cooking fat and sauces a dish like this normally
contains. This is what the user checks your estimate against, so be specific about quantities.

If the photo does not contain food, set "is_food" to false, all numbers to 0, use an empty
ingredients list, and explain in "summary". All numbers must be non-negative and internally consistent: protein and carbs at
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

/** The recipe equivalent of INGREDIENT_SCAN_PROMPT: read, fill, judge, one call. */
export const RECIPE_SCAN_PROMPT =
  `You are a recipe reader for a nutrition diary app.

The user has photographed a recipe - a page from a book, a handwritten card, a screenshot, or a
finished dish.

STEP 1 - READ
Pull out the recipe name, how many servings it makes, the ingredient list with quantities, and
the method. If a photo shows only the finished dish, identify it and reconstruct the usual
ingredients and method for that dish.

STEP 2 - NUTRITION PER SERVING
Work out calories, protein, carbohydrates, fat and fibre for ONE serving, from the ingredients
and the serving count. Never leave one empty. List anything you estimated rather than read in
"estimated_fields".

STEP 3 - CHECK YOURSELF
Protein x4 plus carbs x4 plus fat x9 should land within about 20% of the calories per serving.
Correct your numbers if they do not.

Respond with JSON only:
{
  "recognised": true,
  "name": "recipe name",
  "description": "one sentence about the dish",
  "servings": 4,
  "prep_time_minutes": 15,
  "cook_time_minutes": 30,
  "ingredients": ["400g chicken thighs", "1 tbsp olive oil"],
  "instructions": "Step one. Step two.",
  "cuisine": "Mediterranean",
  "calories_per_serving": 0,
  "protein_per_serving_g": 0,
  "carbs_per_serving_g": 0,
  "fat_per_serving_g": 0,
  "fibre_per_serving_g": 0,
  "dietary_tags": ["omnivore"],
  "estimated_fields": ["fibre_per_serving_g"],
  "verdict": "approved",
  "confidence": "high",
  "reasons": ["short note about anything uncertain"]
}

"dietary_tags" must contain exactly one of "omnivore", "vegetarian", "vegan" or "pescatarian",
plus any of "dairy-free", "gluten-free", "high-protein", "weight-loss", "high-fibre", "low-carb",
"low-fat" that apply. "verdict" is "approved", "needs_review" or "rejected". "confidence" is
"low", "medium" or "high".

Set "recognised" to false only when the photo shows no recipe and no identifiable dish. Every
number must be non-negative. Keep each reason under 15 words.`;
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
const HISTORY_LIMIT = 12;
const MAX_MESSAGE_CHARS = 2000;
const SIGNED_URL_SECONDS = 300;

interface PhotoEstimate {
  dish_name?: unknown;
  description?: unknown;
  ingredients?: unknown;
  calories?: unknown;
  protein_g?: unknown;
  carbs_g?: unknown;
  fat_g?: unknown;
  fibre_g?: unknown;
  confidence?: unknown;
  summary?: unknown;
  is_food?: unknown;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authed = await requireUser(request);
  if (!authed) return json({ error: "Please sign in to use the AI coach." }, 401);

  const { user, authorization } = authed;
  const client = userClient(authorization);

  let body: { message?: unknown; imagePath?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const imagePath = typeof body.imagePath === "string" ? body.imagePath : null;
  const message = typeof body.message === "string"
    ? body.message.trim().slice(0, MAX_MESSAGE_CHARS)
    : "";

  if (!message && !imagePath) {
    return json({ error: "Send a message or a photo." }, 400);
  }

  // A user may only ever reference a photo inside their own folder. Storage RLS
  // enforces this too; checking here turns a confusing 400 into a clear 403.
  if (imagePath && !imagePath.startsWith(`${user.id}/`)) {
    return json({ error: "That photo does not belong to you." }, 403);
  }

  try {
    return imagePath
      ? await handlePhoto({ client, userId: user.id, message, imagePath })
      : await handleChat({ client, userId: user.id, message });
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[ai-chat] model chain failed", error.message);

      // 429 means every model on every provider is out of quota. Anything else
      // is a transient fault the user should simply retry.
      if (error.status === 429) {
        return json({
          error:
            "You have reached today's AI limit. The coach will be back tomorrow — everything else in the app still works.",
          code: "daily_limit",
        }, 429);
      }

      return json({
        error: "The AI coach could not answer that. Please try again.",
      }, 502);
    }
    console.error(
      "[ai-chat] unexpected",
      error instanceof Error ? error.message : "unknown",
    );
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});

// ---------------------------------------------------------------------------
// Text conversation
// ---------------------------------------------------------------------------

async function handleChat(
  { client, userId, message }: {
    client: ReturnType<typeof userClient>;
    userId: string;
    message: string;
  },
) {
  const [context, history] = await Promise.all([
    buildContext(client, userId),
    loadHistory(client, userId),
  ]);

  const result = await callAi({
    system: chatSystemPrompt(context),
    messages: [...history, { role: "user", text: message }],
    maxTokens: 700,
    temperature: 0.4,
  });

  const { reply, suggestions } = splitSuggestions(result.text);

  const { data: inserted } = await client
    .from("chat_messages")
    .insert([
      { user_id: userId, role: "user", content: message },
      {
        user_id: userId,
        role: "assistant",
        content: reply,
        provider: result.provider,
        model: result.model,
      },
    ])
    .select("id, role, created_at");

  return json({
    reply,
    suggestions,
    provider: result.provider,
    model: result.model,
    attempts: result.attempts,
    messageIds: (inserted ?? []).map((row) => row.id),
  });
}

/**
 * Pulls the machine-readable meal block off the end of a reply. The user sees
 * prose; the app gets something it can write to the diary. A malformed block is
 * dropped rather than shown, because a stray bracket in the chat would be worse
 * than a missing button.
 */
export function splitSuggestions(raw: string): {
  reply: string;
  suggestions: Array<Record<string, unknown>>;
} {
  const match = raw.match(/<<<LOG([\s\S]*?)LOG>>>/);
  if (!match) return { reply: raw.trim(), suggestions: [] };

  const reply = raw.replace(match[0], "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return { reply, suggestions: [] };
  }

  if (!Array.isArray(parsed)) return { reply, suggestions: [] };

  const suggestions = parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, 4)
    .map((item) => ({
      name: text(item.name, "Meal", 120),
      ingredients: ingredientList(item.ingredients),
      calories: round(item.calories, 0),
      protein_g: round(item.protein_g, 1),
      carbs_g: round(item.carbs_g, 1),
      fat_g: round(item.fat_g, 1),
      fibre_g: round(item.fibre_g, 1),
      servings: round(item.servings ?? 1, 2) || 1,
    }))
    // A "meal" with no energy at all is not worth offering.
    .filter((item) => item.calories > 0);

  return { reply, suggestions };
}

// ---------------------------------------------------------------------------
// Meal photo analysis
// ---------------------------------------------------------------------------

async function handlePhoto(
  { client, userId, message, imagePath }: {
    client: ReturnType<typeof userClient>;
    userId: string;
    message: string;
    imagePath: string;
  },
) {
  const download = await client.storage.from("meal-photos").download(imagePath);
  if (download.error || !download.data) {
    return json({ error: "That photo could not be read. Please retake it." }, 404);
  }

  const bytes = new Uint8Array(await download.data.arrayBuffer());
  const mimeType = download.data.type || "image/jpeg";
  const base64 = encodeBase64(bytes);

  const signed = await client.storage
    .from("meal-photos")
    .createSignedUrl(imagePath, SIGNED_URL_SECONDS);

  const note = message
    ? `The user added this note: "${message}"`
    : "The user added no note.";

  let result;
  try {
    result = await callAi({
      system: PHOTO_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        text: `Estimate the nutrition of this meal. ${note}`,
      }],
      image: { mimeType, base64, url: signed.data?.signedUrl },
      json: true,
      maxTokens: 800,
      temperature: 0.2,
    });
  } finally {
    // The photo has served its purpose the moment the request completes —
    // including when it fails. It must not linger in storage either way.
    await deletePhoto(client, imagePath);
  }

  const parsed = parseJsonLoose<PhotoEstimate>(result.text);
  if (!parsed) {
    return json({ error: "The AI could not read that photo. Please try a clearer one." }, 502);
  }

  const isFood = parsed.is_food !== false;
  const estimate = {
    dish_name: text(parsed.dish_name, "Meal", 120),
    description: text(parsed.description, "", 300),
    ingredients: ingredientList(parsed.ingredients),
    calories: round(parsed.calories, 0),
    protein_g: round(parsed.protein_g, 1),
    carbs_g: round(parsed.carbs_g, 1),
    fat_g: round(parsed.fat_g, 1),
    fibre_g: round(parsed.fibre_g, 1),
    confidence: confidence(parsed.confidence),
    summary: text(parsed.summary, "Visual estimate; portion size may vary.", 500),
    is_food: isFood,
  };

  const reply = isFood
    ? `${estimate.dish_name} — around ${estimate.calories} kcal. ${estimate.summary}`
    : `That photo does not look like food. ${estimate.summary}`;

  const { data: messages } = await client
    .from("chat_messages")
    .insert([
      {
        user_id: userId,
        role: "user",
        content: message || "Estimate the nutrition in this meal.",
        image_path: null,
      },
      {
        user_id: userId,
        role: "assistant",
        content: reply,
        provider: result.provider,
        model: result.model,
        estimate: isFood ? estimate : null,
      },
    ])
    .select("id, role");

  const assistantId =
    (messages ?? []).find((row) => row.role === "assistant")?.id ?? null;

  // Keep a text record of what the photo contained for 30 days. The image
  // itself is already gone.
  const { data: analysis } = await client
    .from("meal_photo_analyses")
    .insert({
      user_id: userId,
      chat_message_id: assistantId,
      storage_path: imagePath,
      description: estimate.description || estimate.dish_name,
      analysis: estimate,
      provider: result.provider,
      model: result.model,
      image_deleted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  return json({
    reply,
    provider: result.provider,
    model: result.model,
    attempts: result.attempts,
    estimate: isFood ? estimate : null,
    analysisId: analysis?.id ?? null,
    messageId: assistantId,
  });
}

async function deletePhoto(
  client: ReturnType<typeof userClient>,
  imagePath: string,
) {
  const { error } = await client.storage.from("meal-photos").remove([imagePath]);
  if (error) console.error("[ai-chat] failed to delete photo", error.message);
}

// ---------------------------------------------------------------------------
// Context and history
// ---------------------------------------------------------------------------

async function buildContext(
  client: ReturnType<typeof userClient>,
  userId: string,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);

  const [profileResult, diaryResult] = await Promise.all([
    client
      .from("user_profiles")
      .select("age, calculation_sex, height_cm, weight_kg, target_weight_kg, activity_level, goal_mode")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("diary_entries")
      .select("calories, protein, carbs, fat")
      .eq("user_id", userId)
      .eq("date", today),
  ]);

  const profile = profileResult.data;
  const entries = diaryResult.data ?? [];

  const totals = entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + Number(entry.calories ?? 0),
      protein: sum.protein + Number(entry.protein ?? 0),
      carbs: sum.carbs + Number(entry.carbs ?? 0),
      fat: sum.fat + Number(entry.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const lines = ["ABOUT THIS USER (use it, do not recite it back):"];

  if (profile) {
    if (profile.age) lines.push(`- Age ${profile.age}`);
    if (profile.calculation_sex) lines.push(`- Sex used for calculations: ${profile.calculation_sex}`);
    if (profile.height_cm) lines.push(`- Height ${profile.height_cm} cm`);
    if (profile.weight_kg) lines.push(`- Current weight ${profile.weight_kg} kg`);
    if (profile.target_weight_kg) lines.push(`- Target weight ${profile.target_weight_kg} kg`);
    if (profile.activity_level) lines.push(`- Activity level: ${profile.activity_level}`);
    if (profile.goal_mode) lines.push(`- Goal: ${profile.goal_mode}`);
  } else {
    lines.push("- No profile saved yet. Suggest setting goals if it would help.");
  }

  lines.push(
    `- Logged so far today: ${Math.round(totals.calories)} kcal, ` +
      `${Math.round(totals.protein)}g protein, ${Math.round(totals.carbs)}g carbs, ` +
      `${Math.round(totals.fat)}g fat across ${entries.length} item(s).`,
  );

  return lines.join("\n");
}

async function loadHistory(
  client: ReturnType<typeof userClient>,
  userId: string,
): Promise<Array<{ role: "user" | "assistant"; text: string }>> {
  const { data } = await client
    .from("chat_messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  return (data ?? [])
    .reverse()
    .filter((row) => typeof row.content === "string" && row.content.trim())
    .map((row) => ({
      role: row.role === "assistant" ? "assistant" as const : "user" as const,
      text: row.content as string,
    }));
}

// ---------------------------------------------------------------------------

function round(value: unknown, decimals: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function text(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
}

/** What the calorie figure is based on, so the user can check the assumptions. */
function ingredientList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 120))
    .slice(0, 20);
}

function confidence(value: unknown): "low" | "medium" | "high" {
  return value === "high" || value === "medium" ? value : "low";
}
