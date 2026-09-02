import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The app and the database are deployed separately and by hand, so a build can
 * reach a project whose migrations have not been run. Everything waits on the
 * profile — the diary, the goals screen, the coach — so a column that is not
 * there yet must cost a feature, never the whole app.
 */

const maybeSingle = vi.fn();
const select = vi.fn(() => ({ maybeSingle }));
const upsert = vi.fn();
const from = vi.fn(() => ({ select, upsert }));

vi.mock("../lib/supabase", () => ({
  requireSupabase: () => ({ from }),
}));

const { loadProfile, saveProfile, resetHealthData, DEFAULT_PROFILE } = await import(
  "./profileRepository"
);

/**
 * What PostgREST returns for a column the table does not have.
 *
 * There are three tiers of column now, added by three migrations: the original
 * body stats, the target overrides, and the body-composition inputs (steps,
 * training, medication). A database can be stopped at any of them, so the
 * repository steps back one tier at a time rather than giving up.
 */
const missingColumn = { code: "42703", message: 'column user_profiles.target_calories does not exist' };
const missingBodyComp = { code: "42703", message: 'column user_profiles.steps_per_day does not exist' };

const ROW = {
  display_name: "Sam",
  age: 34,
  calculation_sex: "male",
  height_cm: 180,
  weight_kg: 84,
  target_weight_kg: 78,
  activity_level: "moderate",
  goal_mode: "lose",
  theme: "light",
  onboarded: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ error: null });
});

describe("loadProfile against a database missing the target columns", () => {
  it("falls back to the columns that do exist instead of failing", async () => {
    // Missing both the body-composition columns and the target columns, so it
    // steps back twice before finding a shape the table actually has.
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: missingBodyComp })
      .mockResolvedValueOnce({ data: null, error: missingColumn })
      .mockResolvedValueOnce({ data: ROW, error: null });

    const profile = await loadProfile();

    expect(profile?.name).toBe("Sam");
    expect(profile?.weightKg).toBe(84);
    // The feature is simply unavailable, which reads as "no override".
    expect(profile?.targetOverride).toBeNull();
    expect(profile?.targetsSource).toBeNull();
    expect(select).toHaveBeenNthCalledWith(3, expect.not.stringContaining("target_calories"));
  });

  it("keeps the targets when only the body-composition columns are missing", async () => {
    // The commoner case in practice: one migration behind, not two. Losing the
    // custom targets as well would be a needless second casualty.
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: missingBodyComp })
      .mockResolvedValueOnce({
        data: { ...ROW, target_calories: 2100, target_protein_g: 170, target_carbs_g: 190, target_fat_g: 65, target_fibre_g: 30, targets_source: "manual" },
        error: null,
      });

    const profile = await loadProfile();

    expect(profile?.targetOverride).toEqual({
      calories: 2100, protein: 170, carbs: 190, fat: 65, fibre: 30,
    });
    // Absent columns read as "not answered", never as zero — the calculator
    // treats a missing step count and a genuine zero differently.
    expect(profile?.stepsPerDay).toBeNull();
    expect(profile?.onMedication).toBe(false);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("still reports a genuine failure rather than swallowing it", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });

    await expect(loadProfile()).rejects.toThrow("permission denied");
  });

  it("reads the override when the columns are there", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        ...ROW,
        target_calories: 2100,
        target_protein_g: 170,
        target_carbs_g: 190,
        target_fat_g: 65,
        target_fibre_g: 30,
        targets_source: "coach",
        targets_set_at: "2026-08-20T10:00:00Z",
      },
      error: null,
    });

    const profile = await loadProfile();

    expect(profile?.targetOverride).toEqual({
      calories: 2100, protein: 170, carbs: 190, fat: 65, fibre: 30,
    });
    expect(profile?.targetsSource).toBe("coach");
  });

  it("treats a half-written override as none at all", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { ...ROW, target_calories: 2100, target_protein_g: null },
      error: null,
    });

    expect((await loadProfile())?.targetOverride).toBeNull();
  });
});

describe("saveProfile against a database missing the target columns", () => {
  it("still saves the body stats", async () => {
    upsert
      .mockResolvedValueOnce({ error: missingBodyComp })
      .mockResolvedValueOnce({ error: missingColumn })
      .mockResolvedValueOnce({ error: null });

    await saveProfile("user-1", { ...DEFAULT_PROFILE, weightKg: 84, onboarded: true });

    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls[2][0]).not.toHaveProperty("target_calories");
    expect(upsert.mock.calls[2][0]).toMatchObject({ weight_kg: 84 });
  });

  it("drops only the body-composition columns when only those are missing", async () => {
    upsert
      .mockResolvedValueOnce({ error: missingBodyComp })
      .mockResolvedValueOnce({ error: null });

    await saveProfile("user-1", {
      ...DEFAULT_PROFILE,
      weightKg: 84,
      stepsPerDay: 9000,
      onboarded: true,
      targetOverride: { calories: 2100, protein: 170, carbs: 190, fat: 65, fibre: 30 },
      targetsSource: "manual",
      targetsSetAt: null,
    });

    // Steps could not be stored, but the target the user set was not collateral.
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[1][0]).not.toHaveProperty("steps_per_day");
    expect(upsert.mock.calls[1][0]).toMatchObject({ target_calories: 2100, weight_kg: 84 });
  });

  it("refuses an override rather than reporting a save that did nothing", async () => {
    upsert
      .mockResolvedValueOnce({ error: missingBodyComp })
      .mockResolvedValueOnce({ error: missingColumn });

    await expect(
      saveProfile("user-1", {
        ...DEFAULT_PROFILE,
        onboarded: true,
        targetOverride: { calories: 2100, protein: 170, carbs: 190, fat: 65, fibre: 30 },
        targetsSource: "manual",
        targetsSetAt: null,
      }),
      // Refused rather than silently dropped, and worded for the person who
      // pressed Save. Which migration is outstanding is ours to run, not theirs
      // to read about on a settings screen.
    ).rejects.toThrow(/custom daily targets are not available/i);

    // Nothing was written after the two rejections, because there was nothing
    // left that could carry the override.
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});

describe("resetHealthData", () => {
  it("never fails because of columns that hold nothing to erase", async () => {
    upsert
      .mockResolvedValueOnce({ error: missingColumn })
      .mockResolvedValueOnce({ error: null });

    await expect(resetHealthData("user-1", "dark")).resolves.toBeUndefined();
    expect(upsert.mock.calls[1][0]).toMatchObject({ onboarded: false, theme: "dark" });
  });
});
