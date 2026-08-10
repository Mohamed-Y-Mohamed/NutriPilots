import { requireSupabase } from "../lib/supabase";
import type {
  Ingredient,
  IngredientDraft,
  Recipe,
  RecipeDraft,
  SubmitFoodResult,
} from "../types";
import { invokeFunction } from "./aiClient";

/**
 * Creating a library item goes through the `submit-food` Edge Function so the
 * AI plausibility review always runs. Reading, updating and deleting go direct
 * — they need no review and RLS already scopes them to the owner.
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

export async function loadMyIngredients(): Promise<Ingredient[]> {
  const { data, error } = await requireSupabase()
    .from("user_ingredients")
    .select(
      "id,name,brand,food_type,basis_quantity,basis_unit,calories_kcal,protein_g,carbohydrates_g,fat_g,saturated_fat_g,sugars_g,fibre_g,salt_g,sodium_mg,category,dietary_tags,image_url,verification,created_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Ingredient[]).map((row) => ({ ...row, owned: true }));
}

export async function loadMyRecipes(): Promise<Recipe[]> {
  const { data, error } = await requireSupabase()
    .from("user_recipes")
    .select(
      "id,name,description,image_url,servings,prep_time_minutes,cook_time_minutes,instructions,calories_per_serving,protein_per_serving_g,carbs_per_serving_g,fat_per_serving_g,fibre_per_serving_g,saturated_fat_per_serving_g,sugar_per_serving_g,sodium_per_serving_mg,cuisine,dietary_tags,ingredients,ingredient_count,verification,created_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Partial<Recipe>[]).map((row) => ({
    cholesterol_per_serving_mg: 0,
    video_url: "",
    video_source_url: null,
    video_duration_seconds: null,
    video_verified_short: false,
    ...row,
    owned: true,
  })) as Recipe[];
}

export async function deleteMyIngredient(id: string): Promise<void> {
  const { error } = await requireSupabase().from("user_ingredients").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteMyRecipe(id: string): Promise<void> {
  const { error } = await requireSupabase().from("user_recipes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
