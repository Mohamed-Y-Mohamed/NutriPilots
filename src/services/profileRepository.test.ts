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

/** What PostgREST returns for a column the table does not have. */
const missingColumn = { code: "42703", message: 'column user_profiles.target_calories does not exist' };

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
    maybeSingle
      .mockResolvedValueOnce({ data: null, error: missingColumn })
      .mockResolvedValueOnce({ data: ROW, error: null });

    const profile = await loadProfile();

    expect(profile?.name).toBe("Sam");
    expect(profile?.weightKg).toBe(84);
    // The feature is simply unavailable, which reads as "no override".
    expect(profile?.targetOverride).toBeNull();
    expect(profile?.targetsSource).toBeNull();
    expect(select).toHaveBeenNthCalledWith(2, expect.not.stringContaining("target_calories"));
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
      .mockResolvedValueOnce({ error: missingColumn })
      .mockResolvedValueOnce({ error: null });

    await saveProfile("user-1", { ...DEFAULT_PROFILE, weightKg: 84, onboarded: true });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[1][0]).not.toHaveProperty("target_calories");
    expect(upsert.mock.calls[1][0]).toMatchObject({ weight_kg: 84 });
  });

  it("refuses an override rather than reporting a save that did nothing", async () => {
    upsert.mockResolvedValueOnce({ error: missingColumn });

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

    // Nothing was written on the second attempt, because there was none.
    expect(upsert).toHaveBeenCalledTimes(1);
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
