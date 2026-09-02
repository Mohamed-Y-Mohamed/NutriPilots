import { describe, expect, it } from "vitest";
import { effectiveTargets, rescaleTargets } from "./nutrition";
import { DEFAULT_PROFILE } from "../services/profileRepository";
import type { DailyTargets, UserProfile } from "../types";

const PROFILE: UserProfile = {
  ...DEFAULT_PROFILE,
  age: 30,
  calculationSex: "male",
  heightCm: 180,
  weightKg: 82,
  targetWeightKg: 76,
  activityLevel: "moderate",
  goalMode: "lose",
  onboarded: true,
};

const OVERRIDE: DailyTargets = {
  calories: 2100,
  protein: 170,
  carbs: 190,
  fat: 65,
  fibre: 30,
};

describe("effectiveTargets", () => {
  it("uses the formula when nothing has overridden it", () => {
    // Mifflin–St Jeor for a 30-year-old man, 180cm, 82kg:
    //   10(82) + 6.25(180) - 5(30) + 5 = 1800 BMR
    //   x 1.5 (self-reported "moderate", no step count) = 2700 maintenance
    //   - 15%, the middle of the 10–20% "lose steadily" band = 2295
    // Protein is then 1.6–2.2 g per kg of an 82kg reference weight, fat clears
    // both of its floors, and carbohydrate takes what is left. Grams per kg
    // first and percentages never: a deficit must not quietly cut the protein
    // it makes more important.
    expect(effectiveTargets(PROFILE)).toEqual({
      calories: 2295,
      protein: 156,
      carbs: 242,
      fat: 78,
      fibre: 32,
    });
  });

  it("prefers an override over the formula", () => {
    expect(effectiveTargets({ ...PROFILE, targetOverride: OVERRIDE })).toEqual(OVERRIDE);
  });

  it("falls back to the formula the moment the override is cleared", () => {
    const withOverride = { ...PROFILE, targetOverride: OVERRIDE };
    expect(effectiveTargets({ ...withOverride, targetOverride: null })).toEqual(
      effectiveTargets(PROFILE),
    );
  });
});

describe("rescaleTargets", () => {
  it("keeps the macro split when the calories move", () => {
    const scaled = rescaleTargets(OVERRIDE, 4200);

    expect(scaled.calories).toBe(4200);
    // Everything doubled, because the energy did.
    expect(scaled.protein).toBe(340);
    expect(scaled.carbs).toBe(380);
    expect(scaled.fat).toBe(130);
    expect(scaled.fibre).toBe(60);
  });

  it("rounds to whole grams rather than handing back a fraction", () => {
    const scaled = rescaleTargets(OVERRIDE, 2000);
    for (const value of Object.values(scaled)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("leaves everything alone when the calories have not moved", () => {
    expect(rescaleTargets(OVERRIDE, OVERRIDE.calories)).toEqual(OVERRIDE);
  });

  it("does not divide by zero when the old target was empty", () => {
    const scaled = rescaleTargets(
      { calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 },
      2000,
    );

    expect(scaled.calories).toBe(2000);
    // With no split to preserve there is nothing to scale, but the result must
    // still be a usable set of numbers rather than NaN.
    for (const value of Object.values(scaled)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("leaves judging the figure to checkTargets and simply scales", () => {
    // Clamping here would fight someone typing "1", "15", "150" towards 1500.
    const scaled = rescaleTargets(OVERRIDE, 1050);

    expect(scaled.calories).toBe(1050);
    expect(scaled.protein).toBe(Math.round(170 * (1050 / 2100)));
  });
});
