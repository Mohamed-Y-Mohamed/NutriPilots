import { describe, expect, it } from "vitest";
import {
  calibrateMaintenance,
  detectPlateau,
  summariseWeightTrend,
  type DailyIntake,
} from "./weightTrend";
import type { WeightLog } from "../types";

const TODAY = "2026-09-01";

function daysAgo(back: number): string {
  const date = new Date(`${TODAY}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

/** `weightAt(back)` is called for each day, newest (0) to oldest. */
function logs(count: number, weightAt: (back: number) => number): WeightLog[] {
  return Array.from({ length: count }, (_, back) => ({
    date: daysAgo(back),
    weightKg: weightAt(back),
    waistCm: null,
  }));
}

function intake(count: number, calories: number): DailyIntake[] {
  return Array.from({ length: count }, (_, back) => ({ date: daysAgo(back), calories }));
}

describe("summariseWeightTrend", () => {
  it("refuses to average a week from one or two weigh-ins", () => {
    const trend = summariseWeightTrend(logs(2, () => 90), TODAY);

    expect(trend.currentAverage).toBeNull();
    expect(trend.weeklyChangeKg).toBeNull();
  });

  it("compares averages rather than single weigh-ins", () => {
    // 91kg all last week, 90kg all this week.
    const trend = summariseWeightTrend(
      logs(14, (back) => (back < 7 ? 90 : 91)),
      TODAY,
    );

    expect(trend.currentAverage).toBe(90);
    expect(trend.previousAverage).toBe(91);
    expect(trend.weeklyChangeKg).toBe(-1);
    expect(trend.weeklyPercent).toBeCloseTo(-1.1, 1);
  });

  /**
   * A single heavy morning in an otherwise falling week must not turn a loss
   * into a gain. Averaging is the entire defence against that, so it gets its
   * own test rather than being assumed.
   */
  it("absorbs one bad weigh-in instead of being steered by it", () => {
    const steady = summariseWeightTrend(logs(14, (back) => (back < 7 ? 90 : 91)), TODAY);
    const withSpike = summariseWeightTrend(
      logs(14, (back) => (back === 0 ? 92.5 : back < 7 ? 90 : 91)),
      TODAY,
    );

    expect(steady.weeklyChangeKg).toBeLessThan(0);
    expect(withSpike.weeklyChangeKg).toBeLessThan(0);
  });
});

describe("calibrateMaintenance", () => {
  it("works maintenance back from what was eaten and what the scale did", () => {
    // 0.1 kg/day down across 28 days: the newest week averages 96.3 and the
    // oldest averages 98.4, so 2.1 kg over the 21 days between the midpoints.
    // 2.1 × 7700 / 21 = 770 kcal/day of deficit, on top of 2,600 eaten.
    const result = calibrateMaintenance(
      logs(28, (back) => 96 + 0.1 * back),
      intake(28, 2600),
      TODAY,
    );

    expect(result).not.toBeNull();
    expect(result?.maintenance).toBe(3370);
    expect(result?.windowDays).toBe(28);
    expect(result?.confidence).toBe("high");
  });

  it("reads a flat trend as maintenance being whatever they ate", () => {
    const result = calibrateMaintenance(logs(28, () => 90), intake(28, 2650), TODAY);

    expect(result?.maintenance).toBe(2650);
  });

  it("finds a surplus when the scale is going up", () => {
    const result = calibrateMaintenance(
      logs(28, (back) => 96 - 0.05 * back),
      intake(28, 3000),
      TODAY,
    );

    // Gaining, so maintenance sits below what they ate.
    expect(result?.maintenance).toBeLessThan(3000);
  });

  it("gives nothing at all on under a fortnight of data", () => {
    expect(calibrateMaintenance(logs(10, () => 90), intake(10, 2500), TODAY)).toBeNull();
  });

  it("gives nothing when the food log is too patchy to average", () => {
    // Weight every day, but only a quarter of days have food logged.
    const sparse = intake(28, 2500).filter((_, index) => index % 4 === 0);
    expect(calibrateMaintenance(logs(28, () => 90), sparse, TODAY)).toBeNull();
  });

  /**
   * A weight typed in pounds, or a fortnight of untracked holiday, produces
   * arithmetic that is confidently absurd. A wrong maintenance figure is worse
   * than no figure, because everything downstream trusts it without asking.
   */
  it("refuses a result that could not describe a person", () => {
    const collapsing = calibrateMaintenance(
      logs(28, (back) => 90 + 1.5 * back),
      intake(28, 2000),
      TODAY,
    );

    expect(collapsing).toBeNull();
  });

  it("earns only low confidence from sparse weigh-ins", () => {
    // Weighed twice a week, which is enough to average but not to be sure.
    const twiceWeekly = logs(28, () => 90).filter((_, back) => back % 3 === 0);
    const result = calibrateMaintenance(twiceWeekly, intake(28, 2500), TODAY);

    if (result) expect(result.confidence).not.toBe("high");
  });
});

describe("detectPlateau", () => {
  it("says no on a week of data, however flat", () => {
    const verdict = detectPlateau(logs(7, () => 90), TODAY);
    expect(verdict.plateaued).toBe(false);
  });

  it("says no while the trend is still moving", () => {
    const verdict = detectPlateau(logs(21, (back) => 90 + 0.05 * back), TODAY);
    expect(verdict.plateaued).toBe(false);
  });

  it("calls it once three weeks have genuinely gone nowhere", () => {
    // Real weigh-ins wobble; the average is what has to be flat, not each day.
    const verdict = detectPlateau(
      logs(21, (back) => 90 + (back % 3 === 0 ? 0.3 : -0.2)),
      TODAY,
    );

    expect(verdict.plateaued).toBe(true);
    expect(verdict.weeksObserved).toBe(3);
  });
});
