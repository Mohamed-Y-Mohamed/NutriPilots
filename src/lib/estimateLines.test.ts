/**
 * Correcting a portion is the whole point of an itemised estimate: the model
 * guesses 400g, the person holding the plate knows it was 250g, and the totals
 * have to follow immediately and without another AI call.
 *
 * These are the sums behind that. If they drift, a user logs a number that does
 * not match the ingredients printed directly above it — and has no way to tell.
 */

import { describe, expect, it } from "vitest";
import { lineFromIngredient, totalsForLines } from "./nutrition";
import type { EstimateLine, Ingredient } from "../types";

function line(overrides: Partial<EstimateLine> = {}): EstimateLine {
  return {
    name: "chicken thigh, raw",
    amount: 400,
    unit: "g",
    estimatedAmount: false,
    source: "database",
    caloriesPer100: 209,
    proteinPer100: 26,
    carbsPer100: 0,
    fatPer100: 10.9,
    fibrePer100: 0,
    ...overrides,
  };
}

function food(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: "1",
    name: "Rice, white, raw",
    brand: null,
    food_type: "ingredient",
    basis_quantity: 100,
    basis_unit: "g",
    calories_kcal: 360,
    protein_g: 6.6,
    carbohydrates_g: 79,
    fat_g: 0.6,
    saturated_fat_g: null,
    sugars_g: null,
    fibre_g: 1.3,
    salt_g: null,
    sodium_mg: null,
    category: null,
    dietary_tags: null,
    image_url: null,
    ...overrides,
  };
}

describe("totalsForLines", () => {
  it("scales an ingredient by its amount", () => {
    expect(totalsForLines([line({ amount: 100 })])).toEqual({
      calories: 209,
      protein: 26,
      carbs: 0,
      fat: 10.9,
      fibre: 0,
    });
  });

  it("follows a corrected amount down", () => {
    const before = totalsForLines([line({ amount: 400 })]);
    const after = totalsForLines([line({ amount: 250 })]);

    expect(Math.round(before.calories)).toBe(836);
    expect(Math.round(after.calories)).toBe(523);
    // Every macro moves with it, not just the calories.
    expect(after.protein).toBeCloseTo(65, 5);
    expect(after.fat).toBeCloseTo(27.25, 5);
  });

  it("adds several ingredients together", () => {
    const totals = totalsForLines([
      line({ amount: 100 }),
      line({ name: "rice", amount: 200, caloriesPer100: 360, proteinPer100: 6.6, carbsPer100: 79, fatPer100: 0.6, fibrePer100: 1.3 }),
    ]);

    // 209 for 100g of chicken, plus 360 x 2 for 200g of rice.
    expect(Math.round(totals.calories)).toBe(929);
    expect(totals.carbs).toBeCloseTo(158, 5);
    expect(totals.fibre).toBeCloseTo(2.6, 5);
  });

  it("is zero for an empty list, not NaN", () => {
    expect(totalsForLines([])).toEqual({
      calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0,
    });
  });

  it("treats a cleared amount box as zero rather than subtracting", () => {
    // An emptied number input arrives as 0, and a stray minus must not credit
    // the user calories back.
    expect(totalsForLines([line({ amount: 0 })]).calories).toBe(0);
    expect(totalsForLines([line({ amount: -400 })]).calories).toBe(0);
  });

  it("removes an ingredient's contribution entirely when it is dropped", () => {
    const both = totalsForLines([line({ amount: 100 }), line({ name: "oil", amount: 14, caloriesPer100: 884, proteinPer100: 0, carbsPer100: 0, fatPer100: 100, fibrePer100: 0 })]);
    const without = totalsForLines([line({ amount: 100 })]);

    expect(Math.round(both.calories - without.calories)).toBe(124);
  });
});

describe("lineFromIngredient", () => {
  it("restates a per-100g food as a line", () => {
    expect(lineFromIngredient(food())).toMatchObject({
      name: "Rice, white, raw",
      amount: 100,
      unit: "g",
      source: "database",
      caloriesPer100: 360,
      fibrePer100: 1.3,
    });
  });

  it("rescales a food stored against some other basis", () => {
    // A 330ml can stored as one row must not be read as if it were 100ml.
    const can = food({ name: "Cola", basis_quantity: 330, basis_unit: "ml", calories_kcal: 139, carbohydrates_g: 35, protein_g: 0, fat_g: 0, fibre_g: 0 });
    const converted = lineFromIngredient(can);

    expect(converted.unit).toBe("ml");
    expect(converted.caloriesPer100).toBeCloseTo(42.12, 2);
    expect(converted.carbsPer100).toBeCloseTo(10.61, 2);
  });

  it("does not divide by a missing basis", () => {
    const broken = food({ basis_quantity: 0 });
    expect(Number.isFinite(lineFromIngredient(broken).caloriesPer100)).toBe(true);
  });

  it("treats missing macros as zero rather than NaN", () => {
    const sparse = food({ protein_g: null, fat_g: null, fibre_g: null });
    const converted = lineFromIngredient(sparse);

    expect(converted.proteinPer100).toBe(0);
    expect(converted.fatPer100).toBe(0);
    expect(converted.fibrePer100).toBe(0);
  });

  it("is not marked as a guess, because the user chose it", () => {
    expect(lineFromIngredient(food()).estimatedAmount).toBe(false);
    expect(lineFromIngredient(food()).source).toBe("database");
  });
});
