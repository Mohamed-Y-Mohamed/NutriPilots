import { buildTargetPlan } from "./energy";
import type {
  DailyTargets,
  DiaryEntry,
  EstimateLine,
  Ingredient,
  Recipe,
  UserProfile,
} from "../types";

/**
 * The daily plan for a profile.
 *
 * All of the reasoning lives in lib/energy.ts — resting energy, activity,
 * the goal's percentage adjustment, protein against a reference weight, fat
 * against its floors, carbohydrate taking the remainder. This is the thin
 * entry point everything in the app already calls, kept so that changing how
 * a target is worked out does not mean touching every screen that shows one.
 *
 * `observedMaintenance` is the figure calibrated from the user's own weight
 * trend and logged intake. Pass it whenever it exists: a measurement of this
 * person beats a prediction about people shaped like them.
 */
export function calculateDailyTargets(
  profile: UserProfile,
  observedMaintenance?: number | null,
): DailyTargets {
  return buildTargetPlan(profile, observedMaintenance).targets;
}

export interface ScaledNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  sugars: number;
  saturatedFat: number;
  sodium: number;
}

export function scaleIngredientNutrition(
  ingredient: Ingredient,
  amount: number,
): ScaledNutrition {
  const basis = ingredient.basis_quantity || 100;
  const scale = amount / basis;
  return {
    calories: Math.round((ingredient.calories_kcal ?? 0) * scale),
    protein: round1((ingredient.protein_g ?? 0) * scale),
    carbs: round1((ingredient.carbohydrates_g ?? 0) * scale),
    fat: round1((ingredient.fat_g ?? 0) * scale),
    fibre: round1((ingredient.fibre_g ?? 0) * scale),
    sugars: round1((ingredient.sugars_g ?? 0) * scale),
    saturatedFat: round1((ingredient.saturated_fat_g ?? 0) * scale),
    sodium: Math.round((ingredient.sodium_mg ?? 0) * scale),
  };
}

/**
 * A recipe portion is servings eaten multiplied by an optional per-ingredient
 * adjustment. `intensity` of 1.2 means the user added 20% more of everything —
 * the honest approximation when they say "I used more beef" without weighing.
 */
export function scaleRecipeNutrition(
  recipe: Recipe,
  servingsEaten: number,
  intensity = 1,
): ScaledNutrition {
  const scale = Math.max(0, servingsEaten) * Math.max(0, intensity);
  return {
    calories: Math.round((recipe.calories_per_serving ?? 0) * scale),
    protein: round1((recipe.protein_per_serving_g ?? 0) * scale),
    carbs: round1((recipe.carbs_per_serving_g ?? 0) * scale),
    fat: round1((recipe.fat_per_serving_g ?? 0) * scale),
    fibre: round1((recipe.fibre_per_serving_g ?? 0) * scale),
    sugars: round1((recipe.sugar_per_serving_g ?? 0) * scale),
    saturatedFat: round1((recipe.saturated_fat_per_serving_g ?? 0) * scale),
    sodium: Math.round((recipe.sodium_per_serving_mg ?? 0) * scale),
  };
}

/**
 * Per-ingredient overrides expressed as multipliers keyed by ingredient index.
 * The overall intensity is the weighted average, which keeps "double the beef
 * in a ten-ingredient recipe" from doubling the whole meal.
 */
export function intensityFromOverrides(
  overrides: Record<number, number>,
  ingredientCount: number,
): number {
  if (ingredientCount <= 0) return 1;
  let total = 0;
  for (let index = 0; index < ingredientCount; index += 1) {
    total += overrides[index] ?? 1;
  }
  return total / ingredientCount;
}

export interface DiaryTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
}

export function sumEntries(entries: DiaryEntry[]): DiaryTotals {
  return entries.reduce<DiaryTotals>(
    (totals, entry) => ({
      calories: totals.calories + entry.calories,
      protein: totals.protein + entry.protein,
      carbs: totals.carbs + entry.carbs,
      fat: totals.fat + entry.fat,
      fibre: totals.fibre + entry.fibre,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 },
  );
}

/**
 * Reconciles stated calories against 4/4/9. Used to warn a user before they
 * save a food whose numbers cannot all be true at once.
 */
export function macroCalorieMismatch(
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
): number {
  const derived = protein * 4 + carbs * 4 + fat * 9;
  if (calories <= 0) return derived > 0 ? 1 : 0;
  return Math.abs(derived - calories) / calories;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The targets actually in force: whatever the user or the coach last agreed,
 * or the formula when neither has said otherwise.
 *
 * Everything that displays or compares against a target goes through here, so
 * an accepted plan reaches the ring, the macro bars and the coach's own
 * context without any of them knowing where the number came from.
 */
export function effectiveTargets(
  profile: UserProfile,
  observedMaintenance?: number | null,
): DailyTargets {
  return profile.targetOverride ?? calculateDailyTargets(profile, observedMaintenance);
}

/**
 * The same plan at a different calorie figure, keeping the split intact.
 *
 * Changing one number by hand should not silently leave the other four
 * describing a different diet: 2,000 kcal against macros that add up to 2,600
 * is not a plan, it is two plans. Editing a macro on its own is left alone —
 * that is the user deliberately shifting the balance.
 */
export function rescaleTargets(current: DailyTargets, calories: number): DailyTargets {
  // Deliberately unclamped. Whether a figure is allowed is checkTargets' job,
  // and clamping here would fight someone typing "1", "15", "150" on their way
  // to 1500.
  const wanted = Math.round(Number.isFinite(calories) ? Math.max(calories, 0) : 0);
  if (wanted === current.calories) return current;

  // With nothing to scale from, fall back to the default split rather than
  // multiplying every macro by infinity.
  if (current.calories <= 0) {
    return {
      calories: wanted,
      protein: Math.round((wanted * 0.25) / 4),
      carbs: Math.round((wanted * 0.45) / 4),
      fat: Math.round((wanted * 0.3) / 9),
      fibre: Math.max(25, Math.round((wanted / 1000) * 14)),
    };
  }

  const scale = wanted / current.calories;
  return {
    calories: wanted,
    protein: Math.round(current.protein * scale),
    carbs: Math.round(current.carbs * scale),
    fat: Math.round(current.fat * scale),
    fibre: Math.round(current.fibre * scale),
  };
}



/**
 * What a list of ingredients adds up to. Each line carries its nutrition per
 * 100g, so changing an amount is a multiplication rather than another trip to
 * the server — which is what lets a wrong portion be corrected in place.
 */
export function totalsForLines(lines: EstimateLine[]): DiaryTotals {
  return lines.reduce<DiaryTotals>(
    (sum, line) => {
      const scale = Math.max(0, line.amount) / 100;
      return {
        calories: sum.calories + line.caloriesPer100 * scale,
        protein: sum.protein + line.proteinPer100 * scale,
        carbs: sum.carbs + line.carbsPer100 * scale,
        fat: sum.fat + line.fatPer100 * scale,
        fibre: sum.fibre + line.fibrePer100 * scale,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 },
  );
}

/** An ingredient from the food tables, restated per 100g so it can join a list. */
export function lineFromIngredient(food: Ingredient, amount = 100): EstimateLine {
  const basis = Number(food.basis_quantity) > 0 ? Number(food.basis_quantity) : 100;
  const per100 = (value: number | null) => (Number(value) > 0 ? (Number(value) * 100) / basis : 0);

  return {
    name: food.name,
    amount,
    unit: food.basis_unit === "ml" ? "ml" : "g",
    // The user picked this one and set the amount, so nothing here is a guess.
    estimatedAmount: false,
    source: "database",
    caloriesPer100: per100(food.calories_kcal),
    proteinPer100: per100(food.protein_g),
    carbsPer100: per100(food.carbohydrates_g),
    fatPer100: per100(food.fat_g),
    fibrePer100: per100(food.fibre_g),
  };
}
