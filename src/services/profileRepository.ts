import { requireSupabase } from "../lib/supabase";
import type { DailyTargets, TargetsSource, UserProfile } from "../types";

/**
 * Everything zero and nothing chosen. A new account must not be shown numbers
 * it never gave — an invented weight or a preselected goal reads as fact and
 * quietly becomes the target the user is measured against.
 */
export const DEFAULT_PROFILE: UserProfile = {
  name: "",
  age: 0,
  calculationSex: "female",
  heightCm: 0,
  weightKg: 0,
  targetWeightKg: 0,
  activityLevel: "sedentary",
  goalMode: "maintain",
  theme: "system",
  onboarded: false,
  targetOverride: null,
  targetsSource: null,
  targetsSetAt: null,
};

// One string literal, not a concatenation: supabase-js reads the column list at
// the type level to work out the shape of `data`, and a `+` leaves it with no
// literal to read.
const FIELDS =
  "display_name,age,calculation_sex,height_cm,weight_kg,target_weight_kg,activity_level,goal_mode,theme,onboarded,target_calories,target_protein_g,target_carbs_g,target_fat_g,target_fibre_g,targets_source,targets_set_at";

export async function loadProfile(): Promise<UserProfile | null> {
  const { data, error } = await requireSupabase()
    .from("user_profiles")
    .select(FIELDS)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    name: data.display_name ?? "",
    age: Number(data.age ?? DEFAULT_PROFILE.age),
    calculationSex: (data.calculation_sex ?? DEFAULT_PROFILE.calculationSex) as UserProfile["calculationSex"],
    heightCm: Number(data.height_cm ?? DEFAULT_PROFILE.heightCm),
    weightKg: Number(data.weight_kg ?? DEFAULT_PROFILE.weightKg),
    targetWeightKg: Number(data.target_weight_kg ?? DEFAULT_PROFILE.targetWeightKg),
    activityLevel: (data.activity_level ?? DEFAULT_PROFILE.activityLevel) as UserProfile["activityLevel"],
    goalMode: (data.goal_mode ?? DEFAULT_PROFILE.goalMode) as UserProfile["goalMode"],
    theme: (data.theme ?? "system") as UserProfile["theme"],
    onboarded: Boolean(data.onboarded),
    // All five have to be present to mean anything. A half-written override is
    // treated as none at all rather than as a plan with holes in it.
    targetOverride: readTargets(data),
    targetsSource: (data.targets_source ?? null) as TargetsSource | null,
    targetsSetAt: (data.targets_set_at ?? null) as string | null,
  };
}

function readTargets(row: Record<string, unknown>): DailyTargets | null {
  const values = [
    row.target_calories,
    row.target_protein_g,
    row.target_carbs_g,
    row.target_fat_g,
    row.target_fibre_g,
  ];
  if (values.some((value) => value === null || value === undefined)) return null;

  return {
    calories: Number(values[0]),
    protein: Number(values[1]),
    carbs: Number(values[2]),
    fat: Number(values[3]),
    fibre: Number(values[4]),
  };
}

export async function saveProfile(userId: string, profile: UserProfile): Promise<void> {
  const { error } = await requireSupabase()
    .from("user_profiles")
    .upsert(
      {
        user_id: userId,
        display_name: profile.name || null,
        age: profile.age,
        calculation_sex: profile.calculationSex,
        height_cm: profile.heightCm,
        weight_kg: profile.weightKg,
        target_weight_kg: profile.targetWeightKg,
        activity_level: profile.activityLevel,
        goal_mode: profile.goalMode,
        theme: profile.theme,
        onboarded: profile.onboarded,
        target_calories: profile.targetOverride?.calories ?? null,
        target_protein_g: profile.targetOverride?.protein ?? null,
        target_carbs_g: profile.targetOverride?.carbs ?? null,
        target_fat_g: profile.targetOverride?.fat ?? null,
        target_fibre_g: profile.targetOverride?.fibre ?? null,
        targets_source: profile.targetOverride ? profile.targetsSource : null,
        targets_set_at: profile.targetOverride ? (profile.targetsSetAt ?? new Date().toISOString()) : null,
      },
      { onConflict: "user_id" },
    );

  if (error) throw new Error(error.message);
}

/** Removes body stats and goals but keeps the account and its theme choice. */
export async function resetHealthData(userId: string, theme: UserProfile["theme"]): Promise<void> {
  const { error } = await requireSupabase()
    .from("user_profiles")
    .upsert(
      {
        user_id: userId,
        display_name: null,
        age: null,
        calculation_sex: null,
        height_cm: null,
        weight_kg: null,
        target_weight_kg: null,
        activity_level: null,
        goal_mode: null,
        theme,
        onboarded: false,
        target_calories: null,
        target_protein_g: null,
        target_carbs_g: null,
        target_fat_g: null,
        target_fibre_g: null,
        targets_source: null,
        targets_set_at: null,
      },
      { onConflict: "user_id" },
    );

  if (error) throw new Error(error.message);
}
