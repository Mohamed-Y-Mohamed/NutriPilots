import { requireSupabase } from "../lib/supabase";
import type { Ingredient, Recipe } from "../types";

const INGREDIENT_FIELDS =
  "id,name,brand,food_type,basis_quantity,basis_unit,calories_kcal,protein_g,carbohydrates_g,fat_g,saturated_fat_g,sugars_g,fibre_g,salt_g,sodium_mg,category,dietary_tags,image_url";

const USER_INGREDIENT_FIELDS = `${INGREDIENT_FIELDS},verification`;

const RECIPE_FIELDS =
  "id,name,description,image_url,servings,prep_time_minutes,cook_time_minutes,instructions,calories_per_serving,protein_per_serving_g,carbs_per_serving_g,fat_per_serving_g,fibre_per_serving_g,saturated_fat_per_serving_g,sugar_per_serving_g,sodium_per_serving_mg,cholesterol_per_serving_mg,cuisine,dietary_tags,ingredient_count,ingredients,video_url,video_source_url,video_duration_seconds,video_verified_short";

const USER_RECIPE_FIELDS =
  "id,name,description,image_url,servings,prep_time_minutes,cook_time_minutes,instructions,calories_per_serving,protein_per_serving_g,carbs_per_serving_g,fat_per_serving_g,fibre_per_serving_g,saturated_fat_per_serving_g,sugar_per_serving_g,sodium_per_serving_mg,cuisine,dietary_tags,ingredient_count,ingredients,verification";

/**
 * The user's own foods come first — if they took the trouble to add a food,
 * it is almost certainly the one they mean.
 */
export async function searchIngredients(query: string, limit = 30): Promise<Ingredient[]> {
  const client = requireSupabase();
  const trimmed = query.trim();

  const reference = client.from("ingredients").select(INGREDIENT_FIELDS).limit(limit);
  const owned = client.from("user_ingredients").select(USER_INGREDIENT_FIELDS).limit(limit);

  const [referenceResult, ownedResult] = await Promise.all([
    (trimmed ? reference.ilike("name", `%${escapeLike(trimmed)}%`) : reference).order("name"),
    (trimmed ? owned.ilike("name", `%${escapeLike(trimmed)}%`) : owned).order("name"),
  ]);

  if (referenceResult.error) throw new Error(referenceResult.error.message);

  // A signed-out user has no library; that is not an error worth surfacing.
  const ownedRows = (ownedResult.data ?? []) as Ingredient[];

  return [
    ...ownedRows.map((row) => ({ ...row, owned: true })),
    ...((referenceResult.data ?? []) as Ingredient[]),
  ].slice(0, limit * 2);
}

export async function getIngredient(
  id: string,
  owned = false,
): Promise<Ingredient | null> {
  const client = requireSupabase();
  const table = owned ? "user_ingredients" : "ingredients";
  const fields = owned ? USER_INGREDIENT_FIELDS : INGREDIENT_FIELDS;

  const { data, error } = await client.from(table).select(fields).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? ({ ...(data as unknown as Ingredient), owned }) : null;
}

export async function loadRecipes(): Promise<Recipe[]> {
  const client = requireSupabase();

  const [referenceResult, ownedResult] = await Promise.all([
    client.from("recipes").select(RECIPE_FIELDS).order("name").limit(1000),
    client.from("user_recipes").select(USER_RECIPE_FIELDS).order("name").limit(500),
  ]);

  if (referenceResult.error) throw new Error(referenceResult.error.message);

  const owned = ((ownedResult.data ?? []) as Partial<Recipe>[]).map(normaliseUserRecipe);

  return [...owned, ...((referenceResult.data ?? []) as Recipe[])];
}

export async function getRecipe(id: string, owned = false): Promise<Recipe | null> {
  const client = requireSupabase();

  if (owned) {
    const { data, error } = await client
      .from("user_recipes")
      .select(USER_RECIPE_FIELDS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? normaliseUserRecipe(data as Partial<Recipe>) : null;
  }

  const { data, error } = await client
    .from("recipes")
    .select(RECIPE_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Recipe) ?? null;
}

/** User recipes have no video columns; fill them so the UI needs no special case. */
function normaliseUserRecipe(row: Partial<Recipe>): Recipe {
  return {
    cholesterol_per_serving_mg: 0,
    video_url: "",
    video_source_url: null,
    video_duration_seconds: null,
    video_verified_short: false,
    description: "",
    image_url: "",
    instructions: "",
    ingredients: [],
    dietary_tags: [],
    ...row,
    owned: true,
  } as Recipe;
}

function escapeLike(value: string): string {
  return value.replaceAll("%", "\\%").replaceAll("_", "\\_");
}
