/**
 * The coach only sees a user's eating history when the question actually needs
 * it. "How much protein should I eat?" is answered from knowledge; "why have I
 * been the same weight for three weeks?" cannot be answered without it.
 *
 * Both halves are worth pinning down: sending the history when it is not needed
 * hands over data for nothing, and withholding it when it is needed produces a
 * confident answer about a user the model knows nothing about.
 */

import { describe, expect, it } from "vitest";

const { needsIntakeHistory, summariseIntake } = await import(
  "../supabase/functions/_shared/intake.ts"
);

describe("deciding whether the question needs the user's history", () => {
  it.each([
    "I have been the same weight for 3 weeks — what should I change?",
    "why am I not losing weight?",
    "I'm stuck at 82kg",
    "my weight hasn't moved in a month",
    "I've stopped losing weight",
    "how have I been eating this month?",
    "am I eating enough protein?",
    "am I eating too much?",
    "have I been consistent lately?",
    "how am I doing?",
    "what am I doing wrong?",
    "what has my average intake been?",
    "am I in a deficit?",
    "no progress at all this month",
  ])("sends it for %j", (question) => {
    expect(needsIntakeHistory(question)).toBe(true);
  });

  it.each([
    "How much protein should I eat to build muscle?",
    "Give me a 500 kcal high-protein lunch idea",
    "Is quinoa healthier than rice?",
    "What is a calorie deficit?",
    "How many calories are in a banana?",
    "What should I have for breakfast?",
    "Is intermittent fasting worth trying?",
    "how do I cook lentils",
    "",
    // General knowledge that reads as personal but is not. Every one of these
    // used to ship two months of somebody's diary to a third-party model.
    "What's the average calorie content of a banana?",
    "How much protein does the average adult need?",
    "Is the typical portion of rice 75g or 100g?",
    "What are the big nutrition trends this year?",
    "Is creatine trending for a reason or is it hype?",
    "Why is consistency more important than perfection?",
    "How do I stay on track when eating out?",
    "I'm stuck on what to cook for dinner tonight",
    "Can you review my idea for a high-protein breakfast?",
    "What should I eat this week to hit 150g protein?",
  ])("keeps it back for %j", (question) => {
    expect(needsIntakeHistory(question)).toBe(false);
  });
});

/** 60 days of entries ending today, at a steady figure per block. */
function history(today: string, recentKcal: number, previousKcal: number) {
  const start = new Date(`${today}T00:00:00Z`);
  const days: Array<{ date: string; calories: number; protein: number; carbs: number; fat: number }> =
    [];

  for (let back = 0; back < 60; back += 1) {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() - back);
    const calories = back < 30 ? recentKcal : previousKcal;
    days.push({
      date: day.toISOString().slice(0, 10),
      calories,
      protein: back < 30 ? 120 : 100,
      carbs: 200,
      fat: 70,
    });
  }
  return days;
}

describe("summarising it", () => {
  const today = "2026-08-20";

  it("averages each block over the days that were actually logged", () => {
    // Ten days at 2000 kcal, and twenty days not logged at all.
    const days = history(today, 2000, 2000).slice(0, 10);
    const summary = summariseIntake(days, today);

    expect(summary).toMatch(/10 of 30 days logged/);
    // 2000, not 2000 x 10 / 30 = 667.
    expect(summary).toMatch(/2000 kcal/);
  });

  it("reports the change between the two months rather than making it be inferred", () => {
    const summary = summariseIntake(history(today, 2000, 2400), today);

    expect(summary).toMatch(/400 kcal\/day lower/);
    expect(summary).toMatch(/20g\/day more protein/);
  });

  it("warns that an unlogged day is missing data, not an empty plate", () => {
    const summary = summariseIntake(history(today, 2000, 2400), today);
    expect(summary).toMatch(/not a day with no food/i);
  });

  it("breaks the recent weeks out so a trend within the month is visible", () => {
    const summary = summariseIntake(history(today, 2000, 2400), today);
    expect(summary).toMatch(/week/i);
  });

  it("says nothing at all when there is nothing logged", () => {
    expect(summariseIntake([], today)).toBe("");
  });

  it("still reports the recent month when there is no month before it", () => {
    const days = history(today, 2000, 2400).filter((day) => day.date > "2026-07-21");
    const summary = summariseIntake(days, today);

    expect(summary).toMatch(/30 days/);
    expect(summary).not.toMatch(/lower|higher/);
  });

  it("groups several entries on one day into that day's total", () => {
    const summary = summariseIntake(
      [
        { date: today, calories: 500, protein: 30, carbs: 50, fat: 20 },
        { date: today, calories: 700, protein: 40, carbs: 60, fat: 25 },
      ],
      today,
    );

    expect(summary).toMatch(/1 of 30 days logged/);
    expect(summary).toMatch(/1200 kcal/);
  });

  it("ignores anything older than the two months it covers", () => {
    const summary = summariseIntake(
      [
        { date: today, calories: 2000, protein: 100, carbs: 200, fat: 70 },
        { date: "2020-01-01", calories: 9999, protein: 999, carbs: 999, fat: 999 },
      ],
      today,
    );

    expect(summary).not.toMatch(/9999/);
    expect(summary).toMatch(/1 of 30 days logged/);
  });
});
