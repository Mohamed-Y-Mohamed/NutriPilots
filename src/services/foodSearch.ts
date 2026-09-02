import { withRetry } from "../lib/retry";
import { requireSupabase } from "../lib/supabase";
import type { Ingredient, Recipe } from "../types";

/*
 * Every read in this file is wrapped in `withRetry`.
 *
 * These are the queries behind the two screens a user hits first and hardest,
 * on a phone, often on a patchy connection — and all of them are reads, so
 * running one twice costs nothing but a little latency. A single dropped
 * connection should not put "Could not load foods" in front of someone when
 * trying again a quarter of a second later would have worked.
 *
 * Permanent failures are not retried; see lib/retry.ts.
 */

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
  return withRetry(async () => {
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
  });
}

export async function loadRecipes(): Promise<Recipe[]> {
  return withRetry(async () => {
    const client = requireSupabase();

    const [referenceResult, ownedResult] = await Promise.all([
      client.from("recipes").select(RECIPE_FIELDS).order("name").limit(1000),
      client.from("user_recipes").select(USER_RECIPE_FIELDS).order("name").limit(500),
    ]);

    if (referenceResult.error) throw new Error(referenceResult.error.message);

    const owned = ((ownedResult.data ?? []) as Partial<Recipe>[]).map(normaliseUserRecipe);

    return [...owned, ...((referenceResult.data ?? []) as Recipe[])];
  });
}

/**
 * One recipe, from whichever table actually holds it.
 *
 * `owned` says which table to try first, and nothing more. It arrives from a
 * `?mine=1` query parameter, and a URL is not a reliable carrier of anything —
 * a bookmark, a shared link, a back navigation that drops the query string, or
 * a link built without the flag all lose it. Treating it as authoritative meant
 * a user's own recipe was looked up in the reference table, found nothing, and
 * showed "Could not load this recipe" for a recipe that exists.
 *
 * So a miss falls through to the other table before giving up. The hint still
 * earns its keep — it gets the right answer in one query almost every time —
 * but being wrong now costs a second query rather than the whole screen.
 */
export async function getRecipe(id: string, owned = false): Promise<Recipe | null> {
  const first = owned ? readUserRecipe : readReferenceRecipe;
  const second = owned ? readReferenceRecipe : readUserRecipe;

  // Both lookups sit inside one retry, so a connection that drops between them
  // reruns the pair rather than reporting a miss it never actually confirmed.
  return withRetry(async () => (await first(id)) ?? (await second(id)));
}

async function readUserRecipe(id: string): Promise<Recipe | null> {
  const { data, error } = await requireSupabase()
    .from("user_recipes")
    .select(USER_RECIPE_FIELDS)
    .eq("id", id)
    .maybeSingle();

  // A row that is not ours is not an error, it is a miss — RLS hides other
  // people's recipes, and the caller should fall through rather than stop.
  if (error) throw new Error(error.message);
  return data ? normaliseUserRecipe(data as Partial<Recipe>) : null;
}

async function readReferenceRecipe(id: string): Promise<Recipe | null> {
  const { data, error } = await requireSupabase()
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

/**
 * Looks for a food that already exists before the user adds their own copy.
 * Matching is on the leading words rather than the whole string, so "cherry
 * tomatoes" finds "Tomatoes, cherry, raw".
 */
export async function findExistingIngredients(name: string, limit = 4): Promise<Ingredient[]> {
  const trimmed = name.trim();
  if (trimmed.length < 3) return [];

  const words = trimmed.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  if (words.length === 0) return [];

  const { data, error } = await requireSupabase()
    .from("ingredients")
    .select(INGREDIENT_FIELDS)
    .ilike("name", `%${escapeLike(words[0])}%`)
    .limit(40);

  if (error) return [];

  const candidates = (data ?? []) as Ingredient[];

  // Rank by how many of the typed words the reference name contains, so an
  // exact-ish match beats a food that merely shares one word.
  return candidates
    .map((item) => {
      const haystack = item.name.toLowerCase();
      return { item, score: words.filter((word) => haystack.includes(word)).length };
    })
    .filter(({ score }) => score === words.length)
    .sort((a, b) => a.item.name.length - b.item.name.length)
    .slice(0, limit)
    .map(({ item }) => item);
}
