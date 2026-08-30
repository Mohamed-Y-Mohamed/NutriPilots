/**
 * Adds a user-authored ingredient or recipe to their library, but only after
 * an AI plausibility review. Schema validation runs first so the model is never
 * asked to judge an incomplete payload, and the insert happens here so a
 * verdict cannot be skipped by the client.
 */

import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import {
  AiError,
  callAi,
  CHAT_MODELS,
  parseJsonLoose,
  VERIFY_MODELS,
} from "../_shared/ai.ts";
import {
  DISH_ESTIMATE_PROMPT,
  INGREDIENT_SCAN_PROMPT,
  INGREDIENT_VERIFY_PROMPT,
  RECIPE_SCAN_PROMPT,
  RECIPE_VERIFY_PROMPT,
} from "../_shared/prompts.ts";
import { dishIngredientLines, nonNegative, round } from "../_shared/coerce.ts";
import {
  labelFor,
  priceIngredients,
  totalsFor,
} from "../_shared/ingredients.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, userClient } from "../_shared/supabase.ts";
import {
  releaseUsage,
  tryConsumeUsage,
  UsageLimitError,
  usageLimitResponse,
  type UsageCallType,
  type UsageState,
} from "../_shared/usage.ts";

const MAX_DESCRIPTION_CHARS = 1500;

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

  const client = userClient(authed.authorization);

  let body: {
    type?: unknown;
    payload?: unknown;
    acceptWarnings?: unknown;
    mode?: unknown;
    imagePath?: unknown;
    description?: unknown;
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

    const claim = await claimUsage(client, "vision", "photo scans");
    if (claim.rejection) return claim.rejection;

    return await scanFood(
      client,
      authed.user.id,
      body.imagePath,
      body.type === "recipe" ? "recipe" : "ingredient",
    );
  }

  // The no-photo alternative: the user types what they ate and gets the same
  // reviewable draft a recipe photo would have produced.
  if (body.mode === "estimate") {
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!description) {
      return json({ error: "Describe the dish and its ingredients first." }, 400);
    }
    if (description.length > MAX_DESCRIPTION_CHARS) {
      return json({
        error: `That description is too long — keep it under ${MAX_DESCRIPTION_CHARS} characters.`,
      }, 400);
    }

    const claim = await claimUsage(client, "chat", "coach messages and estimates");
    if (claim.rejection) return claim.rejection;

    return await estimateDish(
      client,
      authed.user.id,
      description,
      claim.usage,
    );
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
  if (carried) {
    // The verdict already covers these exact numbers, so no model is called and
    // nothing is charged.
    review = carried;
  } else {
    const claim = await claimUsage(client, "verify", "food checks");
    if (claim.rejection) return claim.rejection;

    try {
      review = await reviewWithAi(type, record);
    } catch (error) {
      if (error instanceof AiError) {
        await releaseUsage(authed.user.id, "verify");
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
  }

  if (review.verdict === "rejected") {
    return json({ saved: false, review }, 200);
  }

  // "needs_review" still saves — it is the user's own library — but the row is
  // flagged so the UI can show a warning badge.
  if (review.verdict === "needs_review" && body.acceptWarnings !== true) {
    return json({ saved: false, review, requiresConfirmation: true }, 200);
  }

  const table = type === "ingredient" ? "user_ingredients" : "user_recipes";
  const row = type === "ingredient"
    ? buildIngredientRow(authed.user.id, record, review)
    : buildRecipeRow(authed.user.id, record, review);

  const { data, error } = await client.from(table).insert(row).select().single();

  if (error) {
    // The message names the table, the column and the constraint it tripped
    // over. That is for the logs. What comes back is the one thing the user can
    // act on — whether this is theirs to fix, or ours.
    console.error("[submit-food] insert failed", error.message);

    // 23505 is a unique violation: they already have this one saved, and no
    // amount of retrying will change that.
    if (error.code === "23505") {
      return json({
        error: "You have already saved something with that name. Try a different one.",
      }, 409);
    }
    return json({ error: "Could not save that just now. Please try again in a moment." }, 400);
  }

  return json({ saved: true, review, item: data }, 201);
});

// ---------------------------------------------------------------------------

/**
 * Claims one AI call against the caller's daily allowance before any model is
 * reached. `rejection` is set when they have none left; otherwise `usage` holds
 * what they have left after this one.
 */
type UsageClaim =
  | { rejection: Response; usage?: undefined }
  | { rejection?: undefined; usage: UsageState };

async function claimUsage(
  client: ReturnType<typeof userClient>,
  callType: UsageCallType,
  noun: string,
): Promise<UsageClaim> {
  try {
    return { usage: await tryConsumeUsage(client, callType) };
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return { rejection: usageLimitResponse(error, noun) };
    }
    console.error(
      "[submit-food] usage check failed",
      error instanceof Error ? error.message : "unknown",
    );
    return {
      rejection: json({ error: "Could not check your daily allowance. Please try again." }, 503),
    };
  }
}

async function scanFood(
  client: ReturnType<typeof userClient>,
  userId: string,
  imagePath: string,
  kind: "ingredient" | "recipe",
): Promise<Response> {
  const download = await client.storage.from("meal-photos").download(imagePath);
  if (download.error || !download.data) {
    // No model was reached, so the claimed call goes back.
    await releaseUsage(userId, "vision");
    return json({ error: "That photo could not be read. Please retake it." }, 404);
  }

  const bytes = new Uint8Array(await download.data.arrayBuffer());
  const mimeType = download.data.type || "image/jpeg";
  const signed = await client.storage.from("meal-photos").createSignedUrl(imagePath, 300);

  let result;
  try {
    result = await callAi({
      system: kind === "recipe" ? RECIPE_SCAN_PROMPT : INGREDIENT_SCAN_PROMPT,
      messages: [{
        role: "user",
        text: kind === "recipe"
          ? "Read this recipe, its ingredients and how much of each it uses."
          : "Read this food and fill in its nutrition.",
      }],
      image: { mimeType, base64: encodeBase64(bytes), url: signed.data?.signedUrl },
      json: true,
      // A recipe now comes back as a list of ingredients each carrying its own
      // amount and five per-100 figures, which is several times the JSON a
      // label read produces — and these models spend most of their budget
      // thinking before any of it is written. Measured: 1500 truncates
      // mid-object and parses as nothing.
      maxTokens: kind === "recipe" ? 3000 : 900,
      temperature: 0.2,
    }, CHAT_MODELS);
  } catch (error) {
    // The photo is disposable either way; never leave it in the bucket.
    await client.storage.from("meal-photos").remove([imagePath]);
    if (error instanceof AiError) {
      // Every model was tried and none answered, so nothing was spent on the
      // user's behalf and their call goes back.
      await releaseUsage(userId, "vision");
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
      error: kind === "recipe"
        ? "That photo does not look like a recipe or an identifiable dish."
        : "That photo does not look like a food or a nutrition label.",
    }, 200);
  }

  if (kind === "recipe") return await recipeScanResponse(client, parsed);

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
 * A photographed recipe, priced the same way a typed one is. The model reads
 * the ingredients and amounts; the nutrition is worked out here from the app's
 * own food tables, so a scan and a description produce the same thing and the
 * user can correct an amount in either.
 */
async function recipeScanResponse(
  client: ReturnType<typeof userClient>,
  parsed: Record<string, unknown>,
): Promise<Response> {
  const lines = dishIngredientLines(parsed.ingredients);
  if (lines.length === 0) {
    return json({
      recognised: false,
      error: "No ingredients could be read from that photo. Try a clearer one.",
    }, 200);
  }

  const servings = Math.min(Math.max(Math.round(scanNumber(parsed.servings)) || 1, 1), 50);
  const priced = await priceIngredients(client, lines);
  const totals = totalsFor(priced);

  const draft = {
    name: scanText(parsed.name, ""),
    description: scanText(parsed.description, ""),
    servings,
    prep_time_minutes: scanNumber(parsed.prep_time_minutes),
    cook_time_minutes: scanNumber(parsed.cook_time_minutes),
    instructions: typeof parsed.instructions === "string"
      ? parsed.instructions.trim().slice(0, 6000)
      : "",
    cuisine: scanText(parsed.cuisine, ""),
    calories_per_serving: round(totals.calories / servings, 0),
    protein_per_serving_g: round(totals.protein / servings, 1),
    carbs_per_serving_g: round(totals.carbs / servings, 1),
    fat_per_serving_g: round(totals.fat / servings, 1),
    fibre_per_serving_g: round(totals.fibre / servings, 1),
    ingredients: priced.map(labelFor),
    dietary_tags: Array.isArray(parsed.dietary_tags)
      ? parsed.dietary_tags.filter((tag): tag is string => typeof tag === "string").slice(0, 11)
      : [],
  };

  return json({
    recognised: true,
    draft,
    estimatedFields: Array.isArray(parsed.estimated_fields)
      ? parsed.estimated_fields.filter((f): f is string => typeof f === "string")
      : [],
    readFrom: "food",
    lines: priced,
    matchedFromDatabase: priced.filter((line) => line.source === "database").length,
    totalIngredients: priced.length,
    review: {
      verdict: parsed.verdict === "approved" || parsed.verdict === "rejected"
        ? parsed.verdict
        : "needs_review",
      confidence: parsed.confidence === "high" || parsed.confidence === "medium"
        ? parsed.confidence
        : "low",
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((r): r is string => typeof r === "string").slice(0, 5)
        : [],
      suggested: null,
      fingerprint: recipeFingerprint(draft),
    },
  }, 200);
}

// ---------------------------------------------------------------------------
// Describe a dish instead of photographing it
// ---------------------------------------------------------------------------

interface DishEstimateResponse {
  recognised?: unknown;
  name?: unknown;
  servings?: unknown;
  cuisine?: unknown;
  ingredients?: unknown;
  estimated_fields?: unknown;
  verdict?: unknown;
  confidence?: unknown;
  reasons?: unknown;
}

/**
 * Turns a typed description into the same reviewable draft a recipe photo
 * produces, so the existing review card, save flow and promote-to-shared step
 * all work on it unchanged.
 *
 * The model is asked for a per-100g figure for every ingredient whether or not
 * the app already knows it, so one call always carries a usable fallback. Each
 * line is then looked up in the app's own tables first, and the model's number
 * is only kept for the ingredients that genuinely are not there.
 */
async function estimateDish(
  client: ReturnType<typeof userClient>,
  userId: string,
  description: string,
  usage: UsageState,
): Promise<Response> {
  let result;
  try {
    result = await callAi({
      system: DISH_ESTIMATE_PROMPT,
      messages: [{ role: "user", text: description }],
      json: true,
      // Every model that serves this request thinks before it answers, and the
      // thinking is charged to the same budget as the reply. Measured against
      // the live chain: at 1500 all four candidates stopped on `length` with
      // the JSON cut mid-object, which parses as nothing; at 3000 they finish
      // on `stop` inside ~1900 tokens. The reply itself is only ~1200
      // characters — the headroom is for the reasoning, not the answer.
      //
      // Telling them not to think is not an option: both providers reject the
      // flags outright ("Reasoning is mandatory for this endpoint and cannot be
      // disabled").
      maxTokens: 3000,
      temperature: 0.3,
    }, CHAT_MODELS);
  } catch (error) {
    if (error instanceof AiError) {
      await releaseUsage(userId, "chat");
      const exhausted = error.status === 429;
      console.error("[submit-food] estimate unavailable", error.message);
      return json({
        error: exhausted
          ? "You have reached today's AI limit. Please try again tomorrow."
          : "The estimator is unavailable right now. Please try again shortly.",
        code: exhausted ? "daily_limit" : "unavailable",
      }, exhausted ? 429 : 503);
    }
    throw error;
  }

  const parsed = parseJsonLoose<DishEstimateResponse>(result.text);

  // Unreadable output is the estimator's failure, not the user's. Blaming the
  // description sends someone away rewriting a dish that was described
  // perfectly well, so the two are answered separately — the same split
  // scanFood already makes.
  if (!parsed) {
    console.error(
      `[submit-food] estimate unparseable from ${result.provider}/${result.model}:`,
      result.text.slice(0, 300),
    );
    return json({
      error: "The estimator could not finish that one. Please try again.",
      code: "unreadable",
    }, 502);
  }

  if (parsed.recognised === false) {
    return json({
      recognised: false,
      error: "That did not look like a real dish. Try naming the ingredients you used.",
    }, 200);
  }

  const lines = dishIngredientLines(parsed.ingredients);
  if (lines.length === 0) {
    return json({
      recognised: false,
      error: "No ingredients could be read from that. Try listing what went into it.",
    }, 200);
  }

  // Servings is bounded to what the save path will accept, so an implausible
  // count cannot produce a draft that is impossible to save.
  const servings = Math.min(Math.max(Math.round(scanNumber(parsed.servings)) || 1, 1), 50);

  const priced = await priceIngredients(client, lines);
  const totals = totalsFor(priced);

  const draft = {
    name: scanText(parsed.name, "My dish"),
    description: "",
    servings,
    prep_time_minutes: 0,
    cook_time_minutes: 0,
    // A described meal has no method, but the recipe form requires one and a
    // blank field would leave the user unable to save a dish they just typed
    // out. What they wrote is the truest record of where these numbers came
    // from, so it stands in — and it is editable before anything is saved.
    instructions: description,
    cuisine: scanText(parsed.cuisine, ""),
    calories_per_serving: round(totals.calories / servings, 0),
    protein_per_serving_g: round(totals.protein / servings, 1),
    carbs_per_serving_g: round(totals.carbs / servings, 1),
    fat_per_serving_g: round(totals.fat / servings, 1),
    fibre_per_serving_g: round(totals.fibre / servings, 1),
    ingredients: priced.map(labelFor),
    dietary_tags: [] as string[],
  };

  return json({
    recognised: true,
    draft,
    estimatedFields: Array.isArray(parsed.estimated_fields)
      ? parsed.estimated_fields.filter((field): field is string => typeof field === "string")
      : [],
    readFrom: "food",
    // The amounts and their per-100 figures, so the user can correct an amount
    // and see the macros follow without another model call.
    lines: priced,
    matchedFromDatabase: priced.filter((line) => line.source === "database").length,
    totalIngredients: priced.length,
    review: {
      verdict: parsed.verdict === "approved" || parsed.verdict === "rejected"
        ? parsed.verdict
        : "needs_review",
      confidence: parsed.confidence === "high" || parsed.confidence === "medium"
        ? parsed.confidence
        : "low",
      reasons: Array.isArray(parsed.reasons)
        ? parsed.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 5)
        : [],
      suggested: null,
      // Ties the verdict to these exact numbers, so saving reuses it instead of
      // paying for a second AI call.
      fingerprint: recipeFingerprint(draft),
    },
    // Which model actually answered, and what was tried first. Without this,
    // working out why one description succeeded and another failed means
    // guessing at a chain of twelve models.
    provider: result.provider,
    model: result.model,
    attempts: result.attempts,
    usage,
  }, 200);
}


/** Recipes are fingerprinted on their own per-serving fields. */
function recipeFingerprint(record: Record<string, unknown>): string {
  return [
    String(record.name ?? "").trim().toLowerCase(),
    Number(record.calories_per_serving ?? 0),
    Number(record.protein_per_serving_g ?? 0),
    Number(record.carbs_per_serving_g ?? 0),
    Number(record.fat_per_serving_g ?? 0),
  ].join("|");
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

  const expected = "calories_per_serving" in record
    ? recipeFingerprint(record)
    : fingerprint(record);
  if (candidate.fingerprint !== expected) return null;

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
