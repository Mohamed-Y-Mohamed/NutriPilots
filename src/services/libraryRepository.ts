import type {
  FoodReview,
  IngredientDraft,
  IngredientScan,
  RecipeDraft,
  RecipeScan,
  SubmitFoodResult,
} from "../types";
import { invokeFunction } from "./aiClient";

/**
 * User-authored foods go through the `submit-food` Edge Function so the AI
 * plausibility review always runs and cannot be skipped by the client.
 */
export async function submitIngredient(
  draft: IngredientDraft,
  acceptWarnings = false,
  /** Carried over from a scan so the same numbers are not reviewed twice. */
  review?: FoodReview | null,
): Promise<SubmitFoodResult> {
  return invokeFunction<SubmitFoodResult>("submit-food", {
    type: "ingredient",
    payload: draft,
    acceptWarnings,
    review: review ?? null,
  });
}

/**
 * Reads a food from a photo. One call covers identification, reading the label,
 * estimating whatever the photo does not show, and judging plausibility — the
 * verdict comes back with the draft so saving costs nothing extra.
 */
export async function scanIngredientPhoto(imagePath: string): Promise<IngredientScan> {
  return invokeFunction<IngredientScan>("submit-food", { mode: "scan", imagePath });
}

export async function submitRecipe(
  draft: RecipeDraft,
  acceptWarnings = false,
  /** Carried over from a scan so the same numbers are not reviewed twice. */
  review?: FoodReview | null,
): Promise<SubmitFoodResult> {
  return invokeFunction<SubmitFoodResult>("submit-food", {
    type: "recipe",
    payload: draft,
    acceptWarnings,
    review: review ?? null,
  });
}

/** Reads a recipe from a photo: identification, method, and per-serving macros. */
export async function scanRecipePhoto(imagePath: string): Promise<RecipeScan> {
  return invokeFunction<RecipeScan>("submit-food", {
    mode: "scan",
    type: "recipe",
    imagePath,
  });
}

/**
 * Offers a saved food to the shared reference tables. Only AI-approved entries
 * are accepted there, and the user's own copy is kept regardless — so this is
 * fire-and-forget: a failure must never look like a failure to save.
 */
export async function promoteToSharedDatabase(
  type: "ingredient" | "recipe",
  id: string,
): Promise<void> {
  try {
    await invokeFunction<{ promoted: boolean }>("promote-food", { type, id });
  } catch {
    // The user's library already has it; contributing is a bonus.
  }
}
