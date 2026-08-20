/**
 * The dish estimate is the no-photo way into the diary: the user types what
 * they ate and gets back a draft. Two things have to hold for that to be safe.
 *
 * The prompt has to survive contact with how people actually type food — cups
 * and handfuls, a takeaway order, a glass of wine — because a prompt that only
 * works on "200g chicken, 1 onion" fails on most real input and nothing else
 * catches that.
 *
 * And whatever the model sends back is untrusted. A misplaced decimal in one
 * amount would otherwise become a diary entry in the millions of calories, so
 * every number is clamped on the way in.
 */

import { describe, expect, it } from "vitest";

const { DISH_ESTIMATE_PROMPT } = await import("../supabase/functions/_shared/prompts.ts");
const { dishIngredientLines } = await import("../supabase/functions/_shared/coerce.ts");

function line(overrides: Record<string, unknown> = {}) {
  return {
    name: "chicken thigh, raw",
    amount_g: 400,
    estimated_amount: false,
    calories_per_100: 209,
    protein_per_100: 26,
    carbs_per_100: 0,
    fat_per_100: 10.9,
    fibre_per_100: 0,
    ...overrides,
  };
}

describe("dish estimate prompt", () => {
  it("converts household measures per ingredient, not by one flat rule", () => {
    expect(DISH_ESTIMATE_PROMPT).toMatch(/tbsp|tablespoon/i);
    expect(DISH_ESTIMATE_PROMPT).toMatch(/handful/i);
    // A cup of flour and a cup of spinach are not the same weight.
    expect(DISH_ESTIMATE_PROMPT).toMatch(/for that specific ingredient/i);
  });

  it("treats a plate of several dishes as one meal of several lines", () => {
    expect(DISH_ESTIMATE_PROMPT).toMatch(/its own ingredient line/i);
  });

  it("uses real values for a named branded or takeaway item", () => {
    expect(DISH_ESTIMATE_PROMPT).toMatch(/fast-food, takeaway, restaurant or branded/i);
  });

  it("estimates a vague amount rather than rejecting it", () => {
    expect(DISH_ESTIMATE_PROMPT).toMatch(/estimated_amount/);
    expect(DISH_ESTIMATE_PROMPT).toMatch(/a bit of|a portion of|leftover/i);
  });

  it("raises fat for fried food instead of using the raw baseline", () => {
    expect(DISH_ESTIMATE_PROMPT).toMatch(/fried, battered or deep-fried/i);
  });

  it("carves alcohol out of the macro self-check so it is not 'corrected' down", () => {
    // Alcohol's calories legitimately break protein*4 + carbs*4 + fat*9.
    expect(DISH_ESTIMATE_PROMPT).toMatch(/7 kcal per gram/i);
    expect(DISH_ESTIMATE_PROMPT).toMatch(/except an ingredient with meaningful alcohol/i);
  });

  it("rounds up when guessing, because understating calories hurts more", () => {
    expect(DISH_ESTIMATE_PROMPT).toMatch(/higher end of the plausible range/i);
  });

  it("asks for no more ingredients than the parser will keep", () => {
    expect(DISH_ESTIMATE_PROMPT).toMatch(/at most 20 ingredients/i);

    const twentyFive = Array.from({ length: 30 }, (_, index) =>
      line({ name: `ingredient ${index}` }));
    expect(dishIngredientLines(twentyFive).length).toBeGreaterThanOrEqual(20);
  });

  it("says amounts are for the whole dish, since servings divides them later", () => {
    expect(DISH_ESTIMATE_PROMPT).toMatch(/"amount_g" is for the WHOLE dish/);
  });
});

describe("dishIngredientLines", () => {
  it("reads the documented shape", () => {
    expect(dishIngredientLines([line()])).toEqual([{
      name: "chicken thigh, raw",
      amountG: 400,
      estimatedAmount: false,
      caloriesPer100: 209,
      proteinPer100: 26,
      carbsPer100: 0,
      fatPer100: 10.9,
      fibrePer100: 0,
    }]);
  });

  it("returns nothing for anything that is not an array", () => {
    expect(dishIngredientLines(undefined)).toEqual([]);
    expect(dishIngredientLines(null)).toEqual([]);
    expect(dishIngredientLines("chicken")).toEqual([]);
    expect(dishIngredientLines({ name: "chicken" })).toEqual([]);
  });

  it("drops a line with no name, since the label would be a bare number", () => {
    expect(dishIngredientLines([line({ name: "" }), line({ name: 42 })])).toEqual([]);
  });

  it("drops a line with no weight, which would contribute nothing anyway", () => {
    expect(dishIngredientLines([line({ amount_g: 0 })])).toEqual([]);
    expect(dishIngredientLines([line({ amount_g: "heaps" })])).toEqual([]);
  });

  it("treats a negative amount as absent rather than subtracting from the total", () => {
    expect(dishIngredientLines([line({ amount_g: -400 })])).toEqual([]);
  });

  it("caps a runaway amount, so a stray zero cannot become 250,000 kcal", () => {
    expect(dishIngredientLines([line({ amount_g: 1_000_000 })])[0].amountG).toBe(20_000);
  });

  it("caps calories at what pure fat could contain", () => {
    // 9 kcal per gram is the ceiling; nothing edible is denser than that.
    expect(dishIngredientLines([line({ calories_per_100: 5000 })])[0].caloriesPer100).toBe(900);
  });

  it("caps a macro at 100g per 100g, which is the whole ingredient", () => {
    const [parsed] = dishIngredientLines([
      line({ protein_per_100: 400, carbs_per_100: 900, fat_per_100: 250, fibre_per_100: 300 }),
    ]);
    expect(parsed.proteinPer100).toBe(100);
    expect(parsed.carbsPer100).toBe(100);
    expect(parsed.fatPer100).toBe(100);
    expect(parsed.fibrePer100).toBe(100);
  });

  it("only believes a literal true for estimated_amount", () => {
    expect(dishIngredientLines([line({ estimated_amount: "yes" })])[0].estimatedAmount).toBe(false);
    expect(dishIngredientLines([line({ estimated_amount: true })])[0].estimatedAmount).toBe(true);
  });

  it("keeps at most 25 lines however long the list is", () => {
    const many = Array.from({ length: 80 }, (_, index) => line({ name: `thing ${index}` }));
    expect(dishIngredientLines(many)).toHaveLength(25);
  });

  it("skips entries that are not objects instead of failing on the whole list", () => {
    expect(dishIngredientLines([null, "rice", 7, line()])).toHaveLength(1);
  });

  it("trims a name long enough to overflow the column", () => {
    const long = dishIngredientLines([line({ name: "a".repeat(500) })])[0];
    expect(long.name).toHaveLength(120);
  });
});
