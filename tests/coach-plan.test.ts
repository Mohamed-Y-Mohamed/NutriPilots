/**
 * The coach can propose new daily targets, and the user can accept them with
 * one tap. That makes this the one place a model's output can change the
 * number someone measures themselves against, so the parsing is strict and the
 * safety floors are enforced here rather than trusted to the prompt.
 */

import { describe, expect, it } from "vitest";

const { splitPlan } = await import("../supabase/functions/_shared/plan.ts");

const GOOD = {
  calories: 2100,
  protein_g: 170,
  carbs_g: 190,
  fat_g: 65,
  fibre_g: 30,
  reason: "Six weeks at 2,400 with no change, so this trims about 300.",
  exercise: "Add a fourth gym day and make two of them weights.",
};

function block(payload: unknown, prose = "Here is what I would change.") {
  return `${prose}\n\n<<<PLAN\n${JSON.stringify(payload)}\nPLAN>>>`;
}

describe("splitPlan", () => {
  it("takes the block off the reply so the user only reads prose", () => {
    const { reply, plan } = splitPlan(block(GOOD), 1500);

    expect(reply).toBe("Here is what I would change.");
    expect(plan).not.toBeNull();
    expect(plan?.targets.calories).toBe(2100);
  });

  it("returns no plan when the reply has no block", () => {
    const { reply, plan } = splitPlan("Just eat a bit more protein.", 1500);

    expect(reply).toBe("Just eat a bit more protein.");
    expect(plan).toBeNull();
  });

  it("scrubs a marker left behind by a block it could not read", () => {
    const { reply, plan } = splitPlan("Try this.\n\n<<<PLAN\nnot json\nPLAN>>>", 1500);

    expect(reply).toBe("Try this.");
    expect(reply).not.toMatch(/PLAN/);
    expect(plan).toBeNull();
  });

  it("reads a block the model wrapped in a code fence", () => {
    const raw = "Here you go.\n\n<<<PLAN\n```json\n" + JSON.stringify(GOOD) + "\n```\nPLAN>>>";
    expect(splitPlan(raw, 1500).plan?.targets.calories).toBe(2100);
  });

  it("refuses to go below the floor it was given", () => {
    const { plan } = splitPlan(block({ ...GOOD, calories: 900 }), 1500);
    expect(plan?.targets.calories).toBe(1500);
  });

  it("refuses an absurd upper figure too", () => {
    const { plan } = splitPlan(block({ ...GOOD, calories: 99000 }), 1500);
    expect(plan?.targets.calories).toBe(8000);
  });

  it("drops a plan with no calorie figure at all", () => {
    const { plan } = splitPlan(block({ reason: "Eat less" }), 1500);
    expect(plan).toBeNull();
  });

  it("keeps macros that already reconcile with the calories", () => {
    const { plan } = splitPlan(block(GOOD), 1500);

    // 170*4 + 190*4 + 65*9 = 2025, within touching distance of 2100.
    expect(plan?.targets.protein).toBe(170);
    expect(plan?.targets.carbs).toBe(190);
    expect(plan?.targets.fat).toBe(65);
  });

  it("rescales macros that describe a different diet from the calories", () => {
    // These add up to about 3,400 kcal against a stated 2,100.
    const { plan } = splitPlan(
      block({ ...GOOD, protein_g: 250, carbs_g: 400, fat_g: 100 }),
      1500,
    );

    const targets = plan!.targets;
    const fromMacros = targets.protein * 4 + targets.carbs * 4 + targets.fat * 9;
    expect(Math.abs(fromMacros - targets.calories) / targets.calories).toBeLessThan(0.1);
  });

  it("carries the reason and the training note through", () => {
    const { plan } = splitPlan(block(GOOD), 1500);

    expect(plan?.reason).toMatch(/trims about 300/);
    expect(plan?.exercise).toMatch(/fourth gym day/);
  });

  it("copes with a plan that says nothing about training", () => {
    const { plan } = splitPlan(block({ ...GOOD, exercise: undefined }), 1500);
    expect(plan?.exercise).toBe("");
  });

  it("clamps a negative macro rather than storing it", () => {
    const { plan } = splitPlan(block({ ...GOOD, protein_g: -50 }), 1500);
    expect(plan!.targets.protein).toBeGreaterThanOrEqual(0);
  });
});
