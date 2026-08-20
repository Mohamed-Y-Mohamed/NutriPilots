import { describe, expect, it } from "vitest";
import { rangeBounds, summariseTrend } from "./trends";
import type { DayTotals } from "../types";

const TODAY = "2026-08-20";

function day(date: string, calories: number, protein = 100): DayTotals {
  return { date, calories, protein, carbs: 200, fat: 70, fibre: 25, items: 3 };
}

describe("rangeBounds", () => {
  it("covers the last seven days for a week, today included", () => {
    expect(rangeBounds("week", TODAY)).toEqual({ from: "2026-08-14", to: TODAY });
  });

  it("covers thirty days for a month", () => {
    expect(rangeBounds("month", TODAY)).toEqual({ from: "2026-07-22", to: TODAY });
  });

  it("starts a year at the first of the month eleven months back", () => {
    // Twelve labelled months including this one, not 365 loose days.
    expect(rangeBounds("year", TODAY)).toEqual({ from: "2025-09-01", to: TODAY });
  });
});

describe("summariseTrend", () => {
  it("averages over the days that were logged, not the days on the calendar", () => {
    const summary = summariseTrend([day("2026-08-20", 2000), day("2026-08-19", 2400)], {
      range: "week",
      today: TODAY,
      target: 2200,
    });

    expect(summary.daysLogged).toBe(2);
    expect(summary.daysInRange).toBe(7);
    // 2200, not (2000 + 2400) / 7.
    expect(summary.averageCalories).toBe(2200);
  });

  it("counts a day on target when it lands within a tenth of it either way", () => {
    const summary = summariseTrend(
      [
        day("2026-08-20", 2200), // exactly on
        day("2026-08-19", 2000), // 9% under
        day("2026-08-18", 2420), // 10% over, still counts
        day("2026-08-17", 1500), // well under
        day("2026-08-16", 3000), // well over
      ],
      { range: "week", today: TODAY, target: 2200 },
    );

    expect(summary.daysOnTarget).toBe(3);
  });

  it("gives a week one bucket per day, in order, gaps included", () => {
    const summary = summariseTrend([day("2026-08-20", 2000), day("2026-08-18", 1800)], {
      range: "week",
      today: TODAY,
      target: 2200,
    });

    expect(summary.buckets).toHaveLength(7);
    expect(summary.buckets.at(-1)).toMatchObject({ calories: 2000, logged: true });
    // The 19th was not logged: an empty bar, not a missing one.
    expect(summary.buckets.at(-2)).toMatchObject({ calories: 0, logged: false });
    expect(summary.buckets.at(-3)).toMatchObject({ calories: 1800, logged: true });
  });

  it("labels the days of a week so they can be told apart", () => {
    const summary = summariseTrend([], { range: "week", today: TODAY, target: 2200 });
    // 20 Aug 2026 is a Thursday.
    expect(summary.buckets.at(-1)?.label).toBe("Thu");
  });

  it("rolls a year up into one bucket per month, averaged per logged day", () => {
    const summary = summariseTrend(
      [day("2026-08-20", 2000), day("2026-08-19", 3000), day("2026-07-15", 1800)],
      { range: "year", today: TODAY, target: 2200 },
    );

    expect(summary.buckets).toHaveLength(12);

    const august = summary.buckets.at(-1);
    expect(august?.label).toBe("Aug");
    // Averaged across the two logged days, not summed into 5000.
    expect(august?.calories).toBe(2500);

    expect(summary.buckets.at(-2)).toMatchObject({ label: "Jul", calories: 1800 });
  });

  it("ignores days outside the range it was asked for", () => {
    const summary = summariseTrend([day("2026-08-20", 2000), day("2026-01-01", 9999)], {
      range: "week",
      today: TODAY,
      target: 2200,
    });

    expect(summary.daysLogged).toBe(1);
    expect(summary.averageCalories).toBe(2000);
  });

  it("reports nothing rather than zero when nothing was logged", () => {
    const summary = summariseTrend([], { range: "month", today: TODAY, target: 2200 });

    expect(summary.daysLogged).toBe(0);
    expect(summary.averageCalories).toBe(0);
    expect(summary.daysOnTarget).toBe(0);
  });

  it("totals the calories actually eaten across the range", () => {
    const summary = summariseTrend([day("2026-08-20", 2000), day("2026-08-19", 2400)], {
      range: "week",
      today: TODAY,
      target: 2200,
    });

    expect(summary.totalCalories).toBe(4400);
  });

  it("averages the macros over logged days too", () => {
    const summary = summariseTrend(
      [day("2026-08-20", 2000, 120), day("2026-08-19", 2400, 80)],
      { range: "week", today: TODAY, target: 2200 },
    );

    expect(summary.averageProtein).toBe(100);
  });
});
