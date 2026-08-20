import { describe, expect, it } from "vitest";
import {
  calculateDailyTargets,
  intensityFromOverrides,
  macroCalorieMismatch,
  scaleIngredientNutrition,
  scaleRecipeNutrition,
  sumEntries,
} from "./nutrition";
import type { DiaryEntry, Ingredient, Recipe, UserProfile } from "../types";

const profile: UserProfile = {
  name: "Test",
  age: 30,
  calculationSex: "male",
  heightCm: 180,
  weightKg: 80,
  targetWeightKg: 75,
  activityLevel: "moderate",
  goalMode: "maintain",
  theme: "system",
  onboarded: true,
  targetOverride: null,
  targetsSource: null,
  targetsSetAt: null,
};

const ingredient: Ingredient = {
  id: "i1",
  name: "Chicken breast",
  brand: null,
  food_type: "ingredient",
  basis_quantity: 100,
  basis_unit: "g",
  calories_kcal: 165,
  protein_g: 31,
  carbohydrates_g: 0,
  fat_g: 3.6,
  saturated_fat_g: 1,
  sugars_g: 0,
  fibre_g: 0,
  salt_g: 0.1,
  sodium_mg: 74,
  category: "Meat",
  dietary_tags: null,
  image_url: null,
};

const recipe = {
  id: "r1",
  name: "Traybake",
  servings: 4,
  calories_per_serving: 500,
  protein_per_serving_g: 40,
  carbs_per_serving_g: 30,
  fat_per_serving_g: 22,
  fibre_per_serving_g: 6,
  saturated_fat_per_serving_g: 5,
  sugar_per_serving_g: 4,
  sodium_per_serving_mg: 400,
  ingredients: [],
} as unknown as Recipe;

describe("calculateDailyTargets", () => {
  it("applies Mifflin–St Jeor with the activity multiplier", () => {
    // BMR 1780 × 1.55 = 2759, maintain adds nothing.
    expect(calculateDailyTargets(profile).calories).toBe(2759);
  });

  it("subtracts the deficit for a weight-loss goal", () => {
    const maintain = calculateDailyTargets(profile).calories;
    const losing = calculateDailyTargets({ ...profile, goalMode: "lose" }).calories;
    expect(maintain - losing).toBe(300);
  });

  it("never drops a woman below 1200 kcal", () => {
    const tiny = calculateDailyTargets({
      ...profile,
      calculationSex: "female",
      age: 70,
      heightCm: 150,
      weightKg: 45,
      activityLevel: "sedentary",
      goalMode: "lose-fast",
    });
    expect(tiny.calories).toBe(1200);
  });

  it("never drops a man below 1500 kcal", () => {
    const tiny = calculateDailyTargets({
      ...profile,
      age: 80,
      heightCm: 155,
      weightKg: 48,
      activityLevel: "sedentary",
      goalMode: "lose-fast",
    });
    expect(tiny.calories).toBe(1500);
  });

  it("splits macros so they reconcile with the calorie target", () => {
    const targets = calculateDailyTargets(profile);
    const derived = targets.protein * 4 + targets.carbs * 4 + targets.fat * 9;
    expect(Math.abs(derived - targets.calories) / targets.calories).toBeLessThan(0.02);
  });
});

describe("scaleIngredientNutrition", () => {
  it("scales from the stored 100g basis", () => {
    expect(scaleIngredientNutrition(ingredient, 200)).toMatchObject({
      calories: 330,
      protein: 62,
      fat: 7.2,
    });
  });

  it("returns zeros for a zero portion", () => {
    expect(scaleIngredientNutrition(ingredient, 0).calories).toBe(0);
  });

  it("treats a missing basis as 100 rather than dividing by zero", () => {
    const broken = { ...ingredient, basis_quantity: 0 };
    expect(scaleIngredientNutrition(broken, 100).calories).toBe(165);
  });

  it("treats null macros as zero", () => {
    const sparse = { ...ingredient, protein_g: null, fibre_g: null };
    const scaled = scaleIngredientNutrition(sparse, 100);
    expect(scaled.protein).toBe(0);
    expect(scaled.fibre).toBe(0);
  });
});

describe("scaleRecipeNutrition", () => {
  it("multiplies per-serving values by the servings eaten", () => {
    expect(scaleRecipeNutrition(recipe, 2).calories).toBe(1000);
  });

  it("supports half servings", () => {
    expect(scaleRecipeNutrition(recipe, 0.5).calories).toBe(250);
  });

  it("applies an intensity multiplier for a heavier portion", () => {
    expect(scaleRecipeNutrition(recipe, 1, 1.2).calories).toBe(600);
  });
});

describe("intensityFromOverrides", () => {
  it("is 1 when nothing was changed", () => {
    expect(intensityFromOverrides({}, 5)).toBe(1);
  });

  it("averages across every ingredient, not just the changed one", () => {
    // Doubling one of four ingredients raises the whole meal by 25%, not 100%.
    expect(intensityFromOverrides({ 0: 2 }, 4)).toBe(1.25);
  });

  it("handles a recipe with no ingredients", () => {
    expect(intensityFromOverrides({ 0: 2 }, 0)).toBe(1);
  });
});

describe("sumEntries", () => {
  it("adds every macro across entries", () => {
    const entries = [
      { calories: 300, protein: 20, carbs: 30, fat: 10, fibre: 3 },
      { calories: 450, protein: 35, carbs: 40, fat: 15, fibre: 5 },
    ] as DiaryEntry[];

    expect(sumEntries(entries)).toEqual({
      calories: 750,
      protein: 55,
      carbs: 70,
      fat: 25,
      fibre: 8,
    });
  });

  it("returns zeros for an empty diary", () => {
    expect(sumEntries([]).calories).toBe(0);
  });
});

describe("macroCalorieMismatch", () => {
  it("is near zero when macros reconcile with the stated calories", () => {
    // 31×4 + 0×4 + 3.6×9 = 156.4 against a stated 165.
    expect(macroCalorieMismatch(165, 31, 0, 3.6)).toBeLessThan(0.06);
  });

  it("is large when the numbers cannot all be true", () => {
    expect(macroCalorieMismatch(100, 50, 50, 50)).toBeGreaterThan(0.25);
  });

  it("flags macros entered against zero calories", () => {
    expect(macroCalorieMismatch(0, 10, 10, 10)).toBe(1);
  });
});
