import type { IngredientDraft, RecipeDraft, SubmitFoodResult } from "../types";
import { invokeFunction } from "./aiClient";

/**
 * User-authored foods go through the `submit-food` Edge Function so the AI
 * plausibility review always runs and cannot be skipped by the client.
 */
export async function submitIngredient(
  draft: IngredientDraft,
  acceptWarnings = false,
): Promise<SubmitFoodResult> {
  return invokeFunction<SubmitFoodResult>("submit-food", {
    type: "ingredient",
    payload: draft,
    acceptWarnings,
  });
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
