/**
 * Adds a user-authored ingredient or recipe to their library, but only after
 * an AI plausibility review. Schema validation runs first so the model is never
 * asked to judge an incomplete payload, and the insert happens here so a
 * verdict cannot be skipped by the client.
 */

import { AiError, callAi, parseJsonLoose, VERIFY_MODELS } from "../_shared/ai.ts";
import { INGREDIENT_VERIFY_PROMPT, RECIPE_VERIFY_PROMPT } from "../_shared/prompts.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, userClient } from "../_shared/supabase.ts";

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

  let body: { type?: unknown; payload?: unknown; acceptWarnings?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
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

  let review: Review;
  try {
    review = await reviewWithAi(type, record);
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
