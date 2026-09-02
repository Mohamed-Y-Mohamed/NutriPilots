import { describe, expect, it } from "vitest";
import {
  activityFactor,
  buildTargetPlan,
  estimateEnergy,
  expectedWeeklyPercent,
  katchMcArdle,
  mifflinStJeor,
  referenceWeightKg,
} from "./energy";
import { DEFAULT_PROFILE } from "../services/profileRepository";
import type { UserProfile } from "../types";

/** The profile that exposed the original bug: a 30-year-old man at 166 kg. */
const HEAVY: UserProfile = {
  ...DEFAULT_PROFILE,
  age: 30,
  calculationSex: "male",
  heightCm: 181,
  weightKg: 166,
  targetWeightKg: 95,
  activityLevel: "sedentary",
  goalMode: "lose-fast",
  onboarded: true,
};

const AVERAGE: UserProfile = {
  ...DEFAULT_PROFILE,
  age: 30,
  calculationSex: "male",
  heightCm: 180,
  weightKg: 82,
  activityLevel: "moderate",
  goalMode: "lose",
  onboarded: true,
};

describe("resting energy", () => {
  it("computes Mifflin–St Jeor for a man", () => {
    // 10(166) + 6.25(181) - 5(30) + 5
    expect(Math.round(mifflinStJeor(HEAVY))).toBe(2646);
  });

  it("computes Mifflin–St Jeor for a woman", () => {
    expect(
      Math.round(
        mifflinStJeor({ weightKg: 60, heightCm: 165, age: 30, calculationSex: "female" }),
      ),
    ).toBe(1320);
  });

  it("computes Katch–McArdle from lean mass", () => {
    // 50% body fat on 166kg is 83kg lean: 370 + 21.6(83)
    expect(Math.round(katchMcArdle(166, 50))).toBe(2163);
  });

  it("widens the range rather than averaging when the two equations disagree", () => {
    // A BMI under 40, so the severe-obesity widening below does not also apply.
    const withFat = estimateEnergy({ ...AVERAGE, bodyFatPercent: 30 });

    // Mifflin stays the headline — a smart-scale body-fat reading is not a
    // measurement, and must not move the number the user is given.
    expect(withFat.rmr).toBe(Math.round(mifflinStJeor(AVERAGE)));
    expect(withFat.rmrRange[0]).toBeLessThan(withFat.rmr);
    expect(withFat.rmrRange[1]).toBe(withFat.rmr);
  });

  /**
   * Validation work puts the error at roughly ±250–315 kcal/day in class II–III
   * obesity, which is larger than the gap between two goal settings. Quoting a
   * tight range there would be a confidence the equation has not earned.
   */
  it("widens the range past a BMI of 40, where the equation loses accuracy", () => {
    const severe = estimateEnergy(HEAVY);

    expect(severe.rmr).toBe(2646);
    expect(severe.rmrRange[0]).toBe(2346);
    expect(severe.rmrRange[1]).toBe(2946);
  });
});

describe("activity factor", () => {
  it("uses the self-reported band when there are no steps", () => {
    expect(activityFactor({ activityLevel: "sedentary" })).toEqual({
      factor: 1.2,
      fromSteps: false,
    });
  });

  it("does not charge twice for training when there are no steps", () => {
    // The app's own question is "how much do you exercise", so the band has
    // already counted the sessions.
    const { factor } = activityFactor({
      activityLevel: "moderate",
      resistanceSessions: 4,
      cardioSessions: 3,
    });
    expect(factor).toBe(1.5);
  });

  it("adds training on top once steps describe the rest of the day", () => {
    const { factor, fromSteps } = activityFactor({
      activityLevel: "sedentary",
      stepsPerDay: 7000,
      resistanceSessions: 3,
    });
    // 7,000 steps sits in the 1.33 band; three sessions add 0.06.
    expect(factor).toBeCloseTo(1.39, 5);
    expect(fromSteps).toBe(true);
  });

  it("caps the training bonus so a claimed fourteen sessions is not believed", () => {
    const { factor } = activityFactor({
      activityLevel: "sedentary",
      stepsPerDay: 3000,
      resistanceSessions: 14,
      cardioSessions: 14,
    });
    expect(factor).toBeCloseTo(1.15 + 0.18, 5);
  });

  it("lets a step count contradict a talked-up activity level", () => {
    const honest = activityFactor({ activityLevel: "athlete", stepsPerDay: 3000 });
    const claimed = activityFactor({ activityLevel: "athlete" });
    expect(honest.factor).toBeLessThan(claimed.factor);
  });
});

describe("reference weight", () => {
  it("is simply body weight for anyone under a BMI of 30", () => {
    expect(referenceWeightKg(82, 180)).toBe(82);
  });

  /**
   * The guidance's own worked example: a 180 kg adult should land near a 100 kg
   * reference rather than being handed 396 g of protein. Fat mass has no
   * protein requirement.
   */
  it("discounts the excess above a BMI of 30", () => {
    expect(Math.round(referenceWeightKg(180, 180))).toBe(100);
    expect(Math.round(referenceWeightKg(166, 181))).toBe(97);
  });
});

describe("the reported bug: a 166kg man on a fast cut", () => {
  it("no longer hands out a token deficit", () => {
    const plan = buildTargetPlan(HEAVY);

    // Was 2,676 kcal — a 15.7% cut dressed up as "lose faster". The flat 500
    // kcal adjustment got proportionally weaker the larger the person was.
    expect(plan.estimate.maintenance).toBe(3176);
    expect(plan.targets.calories).toBe(2461);
    expect(Math.abs(plan.adjustmentPercent)).toBeGreaterThanOrEqual(20);
    expect(Math.abs(plan.adjustmentPercent)).toBeLessThanOrEqual(25);
  });

  it("sets protein against a reference weight, not 166kg", () => {
    const plan = buildTargetPlan(HEAVY);

    // 2.2 g/kg of actual weight would be 365g, which nobody needs or will eat.
    expect(plan.targets.protein).toBeLessThan(260);
    expect(plan.targets.protein).toBeGreaterThan(150);
  });

  /**
   * Grams per kilogram of *adjusted* weight is a different currency from grams
   * per kilogram of a lean athlete's actual weight. Clinical guidance for
   * obesity does not support going past 2.0 g/kg adjusted, so the aggressive
   * cut's 2.0–2.4 band gets clamped rather than the reference being inflated.
   */
  it("clamps grams per kilogram once the reference weight is an adjusted one", () => {
    const ripping = buildTargetPlan({ ...HEAVY, goalMode: "ripping" });
    const reference = ripping.estimate.referenceWeightKg;

    expect(reference).toBeLessThan(HEAVY.weightKg);
    // Whole grams, so allow the rounding rather than pretending it is exact.
    expect(ripping.proteinRange[1]).toBeLessThanOrEqual(Math.ceil(reference * 2.0));
  });

  it("still allows a lean trained lifter the full band", () => {
    const lean = buildTargetPlan({ ...AVERAGE, goalMode: "ripping" });

    // BMI 25, so the reference is actual weight and 2.4 g/kg is on the table.
    expect(lean.estimate.referenceWeightKg).toBe(AVERAGE.weightKg);
    expect(lean.proteinRange[1] / AVERAGE.weightKg).toBeCloseTo(2.4, 1);
  });

  it("reports low confidence and a wide range without a step count", () => {
    const plan = buildTargetPlan(HEAVY);
    const [low, high] = plan.estimate.maintenanceRange;

    expect(plan.estimate.confidence).toBe("low");
    expect(plan.estimate.fromSteps).toBe(false);
    expect(high - low).toBeGreaterThan(300);
  });

  it("tightens once real movement data arrives", () => {
    const withSteps = buildTargetPlan({ ...HEAVY, stepsPerDay: 7000, resistanceSessions: 3 });

    // Genuinely walking 7k and lifting three times a week earns a higher
    // maintenance — and therefore a higher target. That is the honest answer,
    // not a bug: the old engine simply could not tell the two people apart.
    expect(withSteps.estimate.maintenance).toBeGreaterThan(3176);
    expect(withSteps.targets.calories).toBeGreaterThan(2461);
  });
});

describe("goal bands", () => {
  const share = (goalMode: UserProfile["goalMode"]) => {
    const plan = buildTargetPlan({ ...AVERAGE, goalMode });
    return plan.adjustmentPercent;
  };

  it("keeps every band inside its published range", () => {
    expect(share("maintain")).toBe(0);
    expect(share("lose-slow")).toBeCloseTo(-7.5, 0);
    expect(share("lose")).toBeCloseTo(-15, 0);
    expect(share("lose-fast")).toBeCloseTo(-22.5, 0);
    expect(share("ripping")).toBeCloseTo(-22.5, 0);
    expect(share("lean-gain")).toBeCloseTo(7.5, 0);
    expect(share("bulk")).toBeCloseTo(12.5, 0);
  });

  it("asks more protein of a hard cut than of a gentle one", () => {
    const gentle = buildTargetPlan({ ...AVERAGE, goalMode: "lose-slow" }).targets.protein;
    const hard = buildTargetPlan({ ...AVERAGE, goalMode: "ripping" }).targets.protein;
    expect(hard).toBeGreaterThan(gentle);
  });

  it("gives recomposition no weekly weight target at all", () => {
    expect(buildTargetPlan({ ...AVERAGE, goalMode: "recomp" }).weeklyChangeKg).toBeNull();
  });

  it("narrows the rate of gain as a lifter gets more experienced", () => {
    const beginner = expectedWeeklyPercent("bulk", "beginner");
    const advanced = expectedWeeklyPercent("bulk", "advanced");
    expect(beginner?.[1]).toBeGreaterThan(advanced?.[1] ?? 0);
  });
});

describe("safety rails", () => {
  it("eases the deficit rather than clamping the total below the floor", () => {
    const tiny = buildTargetPlan({
      ...DEFAULT_PROFILE,
      age: 70,
      calculationSex: "female",
      heightCm: 150,
      weightKg: 45,
      activityLevel: "sedentary",
      goalMode: "ripping",
      onboarded: true,
    });

    expect(tiny.targets.calories).toBe(1200);
    expect(tiny.reducedForFloor).toBe(true);
    // The stated percentage must still describe the plan actually given.
    expect(Math.abs(tiny.adjustmentPercent)).toBeLessThan(22.5);
  });

  it("caps an absolute surplus however large maintenance is", () => {
    const huge = buildTargetPlan({ ...HEAVY, goalMode: "bulk", stepsPerDay: 15000 });
    expect(huge.adjustmentKcal).toBeLessThanOrEqual(500);
  });

  it("never returns negative carbohydrate", () => {
    for (const goalMode of ["ripping", "lose-fast", "recomp"] as const) {
      const plan = buildTargetPlan({ ...HEAVY, goalMode });
      expect(plan.targets.carbs).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the macros within reach of the calorie total", () => {
    const plan = buildTargetPlan(HEAVY);
    const { calories, protein, carbs, fat } = plan.targets;
    const fromMacros = protein * 4 + carbs * 4 + fat * 9;
    expect(Math.abs(fromMacros - calories) / calories).toBeLessThan(0.05);
  });
});

describe("calibration from real results", () => {
  it("prefers an observed maintenance over the equation", () => {
    const observed = buildTargetPlan(HEAVY, 2900);

    expect(observed.estimate.basis).toBe("observed");
    expect(observed.estimate.maintenance).toBe(2900);
    expect(observed.estimate.confidence).toBe("high");
  });

  it("reports a tighter range once it is measured rather than predicted", () => {
    const predicted = buildTargetPlan(HEAVY).estimate;
    const measured = buildTargetPlan(HEAVY, 2900).estimate;

    const width = (e: typeof predicted) => e.maintenanceRange[1] - e.maintenanceRange[0];
    expect(width(measured)).toBeLessThan(width(predicted));
  });
});
