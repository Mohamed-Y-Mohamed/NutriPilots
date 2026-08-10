import type {
  FoodReview,
  IngredientDraft,
  IngredientScan,
  RecipeDraft,
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
): Promise<SubmitFoodResult> {
  return invokeFunction<SubmitFoodResult>("submit-food", {
    type: "recipe",
    payload: draft,
    acceptWarnings,
  });
}
