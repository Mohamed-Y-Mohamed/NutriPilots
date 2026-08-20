/**
 * Turning whatever a model returned into values the database will accept.
 *
 * Every field crossing this boundary is untrusted: a model can send a string
 * where a number belongs, a negative calorie count, or a 4,000-character name.
 */

export function round(value: unknown, decimals: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

/** A number that is safe to multiply: anything odd or negative becomes zero. */
export function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function text(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
}

export interface DishIngredientLine {
  name: string;
  amountG: number;
  estimatedAmount: boolean;
  caloriesPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  fibrePer100: number;
}

/**
 * Parses the structured "ingredients" array both the recipe scan and the dish
 * estimate return: what the ingredient is, how much of it, and what 100g of it
 * contains. Keeping the per-100 figures is what lets the user correct an amount
 * afterwards and see the macros follow.
 *
 * Amounts are capped as well as floored: a model that misreads "1 kg" as
 * "1000 kg" would otherwise produce a diary entry in the millions of calories.
 */
export function dishIngredientLines(value: unknown): DishIngredientLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      name: text(item.name, "", 120),
      amountG: Math.min(round(item.amount_g, 1), 20_000),
      estimatedAmount: item.estimated_amount === true,
      caloriesPer100: Math.min(round(item.calories_per_100, 2), 900),
      proteinPer100: Math.min(round(item.protein_per_100, 3), 100),
      carbsPer100: Math.min(round(item.carbs_per_100, 3), 100),
      fatPer100: Math.min(round(item.fat_per_100, 3), 100),
      fibrePer100: Math.min(round(item.fibre_per_100, 3), 100),
    }))
    .filter((line) => line.name.length > 0 && line.amountG > 0)
    .slice(0, 25);
}

/** What the calorie figure is based on, so the user can check the assumptions. */
export function ingredientList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 120))
    .slice(0, 20);
}
