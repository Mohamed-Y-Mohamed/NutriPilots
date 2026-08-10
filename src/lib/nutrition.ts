import type {
  DailyTargets,
  DiaryEntry,
  Ingredient,
  Recipe,
  UserProfile,
} from "../types";

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  athlete: 1.9,
} as const;

const GOAL_ADJUSTMENTS = {
  "lose-fast": -500,
  lose: -300,
  maintain: 0,
  "lean-gain": 200,
  gain: 350,
} as const;

const MACRO_SPLITS = {
  "lose-fast": { protein: 0.3, carbs: 0.4, fat: 0.3 },
  lose: { protein: 0.3, carbs: 0.4, fat: 0.3 },
  maintain: { protein: 0.25, carbs: 0.45, fat: 0.3 },
  "lean-gain": { protein: 0.25, carbs: 0.5, fat: 0.25 },
  gain: { protein: 0.25, carbs: 0.5, fat: 0.25 },
} as const;

/** Mifflin–St Jeor, then activity, then goal adjustment, with a safety floor. */
export function calculateDailyTargets(profile: UserProfile): DailyTargets {
  const sexConstant = profile.calculationSex === "male" ? 5 : -161;
  const bmr = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + sexConstant;
  const maintenance = bmr * ACTIVITY_MULTIPLIERS[profile.activityLevel];
  const rawCalories = maintenance + GOAL_ADJUSTMENTS[profile.goalMode];
  const minimum = profile.calculationSex === "male" ? 1500 : 1200;
  const calories = Math.round(Math.max(minimum, rawCalories));
  const split = MACRO_SPLITS[profile.goalMode];

  return {
    calories,
    protein: Math.round((calories * split.protein) / 4),
    carbs: Math.round((calories * split.carbs) / 4),
    fat: Math.round((calories * split.fat) / 9),
    fibre: Math.max(25, Math.round((calories / 1000) * 14)),
  };
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
