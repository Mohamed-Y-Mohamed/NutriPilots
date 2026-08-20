import { describe, expect, it } from "vitest";
import { calorieBounds, checkTargets } from "./targetRanges";
import { DEFAULT_PROFILE } from "../services/profileRepository";
import type { DailyTargets, UserProfile } from "../types";

const MAN: UserProfile = {
  ...DEFAULT_PROFILE,
  age: 30,
  calculationSex: "male",
  heightCm: 180,
  weightKg: 82,
  activityLevel: "moderate",
  goalMode: "lose",
  onboarded: true,
};

const WOMAN: UserProfile = { ...MAN, calculationSex: "female", weightKg: 64, heightCm: 166 };

/** Macros that add up to the calories, so only the field under test varies. */
function balanced(calories: number): DailyTargets {
  return {
    calories,
    protein: Math.round((calories * 0.25) / 4),
    carbs: Math.round((calories * 0.5) / 4),
    fat: Math.round((calories * 0.25) / 9),
    fibre: Math.round((calories / 1000) * 14),
  };
}

describe("calorieBounds", () => {
  it("floors a man at 1500 and a woman at 1200", () => {
    expect(calorieBounds(MAN).min).toBe(1500);
    expect(calorieBounds(WOMAN).min).toBe(1200);
  });

  it("caps everyone well above what any plan needs", () => {
    expect(calorieBounds(MAN).max).toBe(8000);
  });
});

describe("checkTargets", () => {
  it("passes an ordinary balanced day without comment", () => {
    const result = checkTargets(balanced(2400), MAN);

    expect(result.errors).toEqual({});
    expect(result.warnings).toEqual({});
    expect(result.style).toBe("balanced");
  });

  it("stops a hand-typed figure under the floor, and says the coach can go lower", () => {
    const result = checkTargets(balanced(900), MAN);

    expect(result.errors.calories?.message).toMatch(/1,?500/);
    // The coach has read their diary; the person typing into a box has not.
    expect(result.errors.calories?.coachCanOverride).toBe(true);
  });

  it("stops an absurd calorie figure", () => {
    const result = checkTargets({ ...balanced(2400), calories: 12000 }, MAN);
    expect(result.errors.calories).toBeTruthy();
  });

  it("does not offer the coach as a way round a contradiction", () => {
    const result = checkTargets(
      { calories: 2000, protein: 300, carbs: 400, fat: 150, fibre: 30 },
      MAN,
    );
    // Nobody can lift this one — the two figures simply disagree.
    expect(result.errors.calories?.coachCanOverride).toBe(false);
  });

  it("blocks a negative or non-numeric entry", () => {
    expect(checkTargets({ ...balanced(2400), protein: -10 }, MAN).errors.protein).toBeTruthy();
    expect(checkTargets({ ...balanced(2400), carbs: NaN }, MAN).errors.carbs).toBeTruthy();
    expect(
      checkTargets({ ...balanced(2400), protein: -10 }, MAN).errors.protein?.coachCanOverride,
    ).toBe(false);
  });

  it("recognises keto rather than complaining about the carbs", () => {
    // 2000 kcal: 30g carbs, 100g protein, 160g fat.
    const keto: DailyTargets = { calories: 2000, protein: 100, carbs: 30, fat: 162, fibre: 25 };
    const result = checkTargets(keto, MAN);

    expect(result.style).toBe("ketogenic");
    expect(result.warnings.carbs).toBeUndefined();
    expect(result.errors).toEqual({});
  });

  it("recognises low-carb as its own thing, not a broken balanced diet", () => {
    // 2000 kcal: 125g carbs (25%), 150g protein (30%), 100g fat (45%).
    const lowCarb: DailyTargets = { calories: 2000, protein: 150, carbs: 125, fat: 100, fibre: 28 };
    expect(checkTargets(lowCarb, MAN).style).toBe("low-carb");
  });

  it("recognises a high-protein plan", () => {
    // 2000 kcal: 175g protein (35%), 175g carbs (35%), 67g fat (30%).
    const highProtein: DailyTargets = {
      calories: 2000, protein: 175, carbs: 175, fat: 67, fibre: 28,
    };
    expect(checkTargets(highProtein, MAN).style).toBe("high-protein");
  });

  it("allows a tenth outside a style's band before it stops being that style", () => {
    // Keto tops out at 10% carbs; 11% is inside the grace and still keto.
    const edge: DailyTargets = { calories: 2000, protein: 100, carbs: 55, fat: 149, fibre: 25 };
    expect(checkTargets(edge, MAN).style).toBe("ketogenic");
  });

  it("warns rather than blocks when the split matches nothing recognised", () => {
    // 2000 kcal almost entirely from fat, with barely any protein.
    const odd: DailyTargets = { calories: 2000, protein: 20, carbs: 20, fat: 205, fibre: 25 };
    const result = checkTargets(odd, MAN);

    expect(result.style).toBeNull();
    expect(Object.keys(result.warnings).length).toBeGreaterThan(0);
    // A dietitian may genuinely have said so, so it is not refused.
    expect(result.errors).toEqual({});
  });

  it("blocks protein beyond what any athlete eats for their weight", () => {
    const result = checkTargets({ ...balanced(3000), protein: 500 }, MAN);
    expect(result.errors.protein).toBeTruthy();
  });

  it("blocks macros that describe a different day from the calories", () => {
    const result = checkTargets(
      { calories: 2000, protein: 300, carbs: 400, fat: 150, fibre: 30 },
      MAN,
    );
    expect(result.errors.calories?.message).toMatch(/macros/i);
  });

  it("warns about fibre far outside what anyone is advised to eat", () => {
    expect(checkTargets({ ...balanced(2400), fibre: 2 }, MAN).warnings.fibre).toBeTruthy();
    expect(checkTargets({ ...balanced(2400), fibre: 95 }, MAN).warnings.fibre).toBeTruthy();
  });

  it("blocks a frankly impossible fibre figure", () => {
    expect(checkTargets({ ...balanced(2400), fibre: 400 }, MAN).errors.fibre).toBeTruthy();
  });
});
