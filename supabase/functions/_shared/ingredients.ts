/**
 * Turning a model's ingredient list into numbers the app trusts.
 *
 * Every route that estimates a meal — a coach photo, a recipe photo, a typed
 * description — asks its model for the same thing: what the ingredients are,
 * how much of each, and what 100g of each contains. This module does the rest,
 * identically for all three.
 *
 * Each ingredient is looked up in the app's own food tables first, and the
 * model's per-100 figures are kept only for the ones that genuinely are not
 * there. A dish built from ordinary foods therefore ends up mostly grounded in
 * verified data, and the response says how much of it was.
 *
 * The per-100 figures travel back to the client with the amounts, which is what
 * lets someone correct "400g" to "250g" and watch the macros follow without
 * another model call.
 */

import { nonNegative, type DishIngredientLine } from "./coerce.ts";
import { userClient } from "./supabase.ts";

export interface PricedLine {
  name: string;
  /** Grams, or millilitres when the food is measured that way. */
  amount: number;
  unit: "g" | "ml";
  /** The model judged this amount rather than reading or counting it. */
  estimatedAmount: boolean;
  /** Where the per-100 figures came from. */
  source: "database" | "ai_estimate";
  caloriesPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  fibrePer100: number;
}

export interface Totals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
}

interface Per100 extends Totals {
  unit: "g" | "ml";
}

/**
 * Prices every line against the user's own foods first, then the shared table,
 * then the model's own figure. Lines are looked up together rather than in
 * turn: twenty ingredients done one at a time is forty round trips and several
 * seconds of a user waiting.
 */
export async function priceIngredients(
  client: ReturnType<typeof userClient>,
  lines: DishIngredientLine[],
): Promise<PricedLine[]> {
  return await Promise.all(lines.map(async (line) => {
    const match = await resolveIngredient(client, line.name);
    return {
      name: line.name,
      amount: line.amountG,
      unit: match?.unit ?? "g",
      estimatedAmount: line.estimatedAmount,
      source: match ? "database" as const : "ai_estimate" as const,
      caloriesPer100: match?.calories ?? line.caloriesPer100,
      proteinPer100: match?.protein ?? line.proteinPer100,
      carbsPer100: match?.carbs ?? line.carbsPer100,
      fatPer100: match?.fat ?? line.fatPer100,
      fibrePer100: match?.fibre ?? line.fibrePer100,
    };
  }));
}

/** What the whole dish contains, before it is divided into servings. */
export function totalsFor(lines: PricedLine[]): Totals {
  return lines.reduce<Totals>((sum, line) => {
    const scale = line.amount / 100;
    return {
      calories: sum.calories + line.caloriesPer100 * scale,
      protein: sum.protein + line.proteinPer100 * scale,
      carbs: sum.carbs + line.carbsPer100 * scale,
      fat: sum.fat + line.fatPer100 * scale,
      fibre: sum.fibre + line.fibrePer100 * scale,
    };
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 });
}

/**
 * The one-line form a recipe row stores, e.g. "400g chicken thigh, raw". Half a
 * gram would otherwise round to "0g".
 */
export function labelFor(line: PricedLine): string {
  return `${Math.max(1, Math.round(line.amount))}${line.unit} ${line.name}`;
}

/**
 * The app's own figure for an ingredient, per 100g or 100ml. The user's foods
 * win over the shared table, the same priority the food search uses.
 */
async function resolveIngredient(
  client: ReturnType<typeof userClient>,
  name: string,
): Promise<Per100 | null> {
  // Stripping punctuation does double duty: it turns "chicken thigh, raw" into
  // words that will actually match a stored name, and it removes the `%`, `_`
  // and `*` characters ilike would otherwise read as wildcards.
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
  if (words.length === 0) return null;

  const fields =
    "name,basis_quantity,basis_unit,calories_kcal,protein_g,carbohydrates_g,fat_g,fibre_g";
  const like = `%${words[0]}%`;

  // Ordered so a name that matches more than twenty rows resolves to the same
  // ingredient every time rather than to whatever the database returns first.
  const [owned, shared] = await Promise.all([
    client.from("user_ingredients").select(fields).ilike("name", like).order("name").limit(20),
    client.from("ingredients").select(fields).ilike("name", like).order("name").limit(20),
  ]);

  return pickIngredient(owned.data, words) ?? pickIngredient(shared.data, words);
}

/**
 * The shortest row whose name contains every word of the model's ingredient
 * name. Requiring all the words keeps "chicken thigh" off a row that merely
 * says "chicken", and shortest-wins prefers the plain food over an elaborate
 * one — "Rice, white, raw" over "Rice pudding with cinnamon".
 */
function pickIngredient(rows: unknown, words: string[]): Per100 | null {
  if (!Array.isArray(rows)) return null;

  const match = (rows as Array<Record<string, unknown>>)
    .filter((row) => {
      const haystack = String(row.name ?? "").toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => String(a.name).length - String(b.name).length)[0];

  if (!match) return null;

  const basis = Number(match.basis_quantity);
  if (!(basis > 0)) return null;

  const factor = 100 / basis;
  return {
    calories: nonNegative(match.calories_kcal) * factor,
    protein: nonNegative(match.protein_g) * factor,
    carbs: nonNegative(match.carbohydrates_g) * factor,
    fat: nonNegative(match.fat_g) * factor,
    fibre: nonNegative(match.fibre_g) * factor,
    unit: match.basis_unit === "ml" ? "ml" : "g",
  };
}
