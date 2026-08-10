import { requireSupabase } from "../lib/supabase";
import type { DiaryDraft, DiaryEntry, MealName, RecentFood } from "../types";

const FIELDS =
  "id,name,amount,unit,meal,calories,protein,carbs,fat,fibre,date,source,servings,notes,ingredient_id,recipe_id,user_ingredient_id,user_recipe_id,created_at";

interface DiaryRow {
  id: string;
  name: string;
  amount: number | string;
  unit: string;
  meal: string;
  calories: number | string;
  protein: number | string;
  carbs: number | string;
  fat: number | string;
  fibre: number | string;
  date: string;
  source: string;
  servings: number | string | null;
  notes: string | null;
  ingredient_id: string | null;
  recipe_id: string | null;
  user_ingredient_id: string | null;
  user_recipe_id: string | null;
  created_at: string;
}

export async function loadDiary(date: string): Promise<DiaryEntry[]> {
  const { data, error } = await requireSupabase()
    .from("diary_entries")
    .select(FIELDS)
    .eq("date", date)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toEntry);
}

export async function loadDiaryRange(from: string, to: string): Promise<DiaryEntry[]> {
  const { data, error } = await requireSupabase()
    .from("diary_entries")
    .select(FIELDS)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(toEntry);
}

export async function addDiaryEntry(
  userId: string,
  draft: DiaryDraft,
): Promise<DiaryEntry> {
  const { data, error } = await requireSupabase()
    .from("diary_entries")
    .insert({
      user_id: userId,
      name: draft.name.slice(0, 200),
      amount: draft.amount,
      unit: draft.unit,
      meal: draft.meal,
      calories: draft.calories,
      protein: draft.protein,
      carbs: draft.carbs,
      fat: draft.fat,
      fibre: draft.fibre,
      date: draft.date,
      source: draft.source,
      servings: draft.servings ?? null,
      notes: draft.notes ?? null,
      ingredient_id: draft.ingredientId ?? null,
      recipe_id: draft.recipeId ?? null,
      user_ingredient_id: draft.userIngredientId ?? null,
      user_recipe_id: draft.userRecipeId ?? null,
    })
    .select(FIELDS)
    .single();

  if (error) throw new Error(error.message);
  return toEntry(data as DiaryRow);
}

export async function removeDiaryEntry(id: string): Promise<void> {
  const { error } = await requireSupabase().from("diary_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function clearDiary(): Promise<void> {
  const client = requireSupabase();
  const { data } = await client.auth.getUser();
  if (!data.user) throw new Error("You need to be signed in.");

  const { error } = await client.from("diary_entries").delete().eq("user_id", data.user.id);
  if (error) throw new Error(error.message);
}

/** Foods the user has logged before, most recent first. Powers the "My foods" tab. */
export async function loadRecentFoods(limit = 40): Promise<RecentFood[]> {
  const { data, error } = await requireSupabase().rpc("recent_foods", {
    limit_count: limit,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    name: String(row.name ?? ""),
    source: (row.source ?? "ingredient") as RecentFood["source"],
    unit: String(row.unit ?? "g"),
    amount: Number(row.amount ?? 0),
    calories: Number(row.calories ?? 0),
    protein: Number(row.protein ?? 0),
    carbs: Number(row.carbs ?? 0),
    fat: Number(row.fat ?? 0),
    lastLogged: String(row.last_logged ?? ""),
    timesLogged: Number(row.times_logged ?? 1),
    ingredientId: (row.ingredient_id as string) ?? null,
    recipeId: (row.recipe_id as string) ?? null,
    userIngredientId: (row.user_ingredient_id as string) ?? null,
    userRecipeId: (row.user_recipe_id as string) ?? null,
  }));
}

function toEntry(row: DiaryRow): DiaryEntry {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    unit: row.unit,
    meal: row.meal as MealName,
    calories: Number(row.calories),
    protein: Number(row.protein),
    carbs: Number(row.carbs),
    fat: Number(row.fat),
    fibre: Number(row.fibre ?? 0),
    date: row.date,
    source: row.source as DiaryEntry["source"],
    servings: row.servings === null ? null : Number(row.servings),
    notes: row.notes,
    ingredientId: row.ingredient_id,
    recipeId: row.recipe_id,
    userIngredientId: row.user_ingredient_id,
    userRecipeId: row.user_recipe_id,
    createdAt: row.created_at,
  };
}
