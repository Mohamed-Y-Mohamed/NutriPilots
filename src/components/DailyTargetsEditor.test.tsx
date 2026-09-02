import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyTargets, UserProfile } from "../types";

/**
 * The editor rescales the macros when the calories change. Doing that from the
 * previous keystroke rather than from a fixed starting point compounds: each
 * digit multiplies an already-scaled figure, so typing a number one character
 * at a time walks the macros somewhere the user never asked for — and once a
 * rounded value reaches zero, every later multiply keeps it there.
 *
 * These drive the field the way a person does, one character at a time. A test
 * that sets the whole value in one event cannot see the bug.
 */

const PROFILE: UserProfile = {
  name: "Sam",
  age: 34,
  calculationSex: "male",
  heightCm: 180,
  weightKg: 84,
  targetWeightKg: 78,
  activityLevel: "moderate",
  goalMode: "lose",
  theme: "light",
  onboarded: true,
  stepsPerDay: null,
  resistanceSessions: null,
  cardioSessions: null,
  bodyFatPercent: null,
  waistCm: null,
  trainingExperience: null,
  onMedication: false,
  targetOverride: null,
  targetsSource: null,
  targetsSetAt: null,
};

const TARGETS: DailyTargets = { calories: 2400, protein: 180, carbs: 270, fat: 80, fibre: 34 };

const saveTargets = vi.fn().mockResolvedValue(undefined);

vi.mock("../state/AppDataContext", () => ({
  useAppData: () => ({
    profile: PROFILE,
    hasProfile: true,
    targets: TARGETS,
    calculatedTargets: TARGETS,
    saveTargets,
  }),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

const { DailyTargetsEditor } = await import("./DailyTargetsEditor");

const value = (name: RegExp) => Number((screen.getByLabelText(name) as HTMLInputElement).value);

async function openEditor() {
  const user = userEvent.setup();
  render(<DailyTargetsEditor />);
  await user.click(screen.getByRole("button", { name: "Edit targets" }));
  return user;
}

beforeEach(() => vi.clearAllMocks());

describe("changing the calories one character at a time", () => {
  it("lands on the same split, whatever route the typing took", async () => {
    const user = await openEditor();
    const calories = screen.getByLabelText(/Calories/);

    await user.clear(calories);
    await user.type(calories, "1500");

    // 1500/2400 of the original split, not a figure compounded per keystroke.
    expect(value(/Calories/)).toBe(1500);
    expect(value(/Protein/)).toBe(Math.round(180 * (1500 / 2400)));
    expect(value(/Carbs/)).toBe(Math.round(270 * (1500 / 2400)));
    expect(value(/Fat/)).toBe(Math.round(80 * (1500 / 2400)));
  });

  it("does not strand the macros at zero on the way down and back up", async () => {
    const user = await openEditor();
    const calories = screen.getByLabelText(/Calories/);

    // The path that used to be unrecoverable: every digit removed, then a new
    // number typed. Rounding drove each macro to 0, and 0 times anything is 0.
    await user.clear(calories);
    await user.type(calories, "1500");

    expect(value(/Protein/)).toBeGreaterThan(0);
    expect(value(/Carbs/)).toBeGreaterThan(0);
    expect(value(/Fat/)).toBeGreaterThan(0);
  });

  it("returns to the original figures when the original number is retyped", async () => {
    const user = await openEditor();
    const calories = screen.getByLabelText(/Calories/);

    await user.clear(calories);
    await user.type(calories, "2400");

    expect(value(/Protein/)).toBe(180);
    expect(value(/Carbs/)).toBe(270);
    expect(value(/Fat/)).toBe(80);
  });

  it("keeps a hand-edited macro, and scales from it afterwards", async () => {
    const user = await openEditor();

    const protein = screen.getByLabelText(/Protein/);
    await user.clear(protein);
    await user.type(protein, "200");

    // Editing one macro leaves the others alone — that is a deliberate shift.
    expect(value(/Carbs/)).toBe(270);

    const calories = screen.getByLabelText(/Calories/);
    await user.clear(calories);
    await user.type(calories, "1200");

    // And the new protein is what the next calorie change scales from.
    expect(value(/Protein/)).toBe(Math.round(200 * (1200 / 2400)));
  });
});

describe("saving", () => {
  it("refuses a plan with calories but no macros at all", async () => {
    const user = await openEditor();

    for (const field of [/Protein/, /Carbs/, /Fat/]) {
      const input = screen.getByLabelText(field);
      await user.clear(input);
      await user.type(input, "0");
    }

    // 2,400 kcal made of nothing is not a plan, and used to save with only a
    // gentle note about an unusual split.
    expect(screen.getByRole("button", { name: /Save targets/ })).toBeDisabled();
    expect(saveTargets).not.toHaveBeenCalled();
  });

  it("saves the figures on screen once they agree", async () => {
    const user = await openEditor();
    const calories = screen.getByLabelText(/Calories/);

    await user.clear(calories);
    await user.type(calories, "2000");
    await user.click(screen.getByRole("button", { name: /Save targets/ }));

    expect(saveTargets).toHaveBeenCalledWith(
      expect.objectContaining({ calories: 2000, protein: Math.round(180 * (2000 / 2400)) }),
      "manual",
    );
  });
});
