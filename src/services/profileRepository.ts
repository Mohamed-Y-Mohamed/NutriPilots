import { requireSupabase } from "../lib/supabase";
import type { UserProfile } from "../types";

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
};

const FIELDS =
  "display_name,age,calculation_sex,height_cm,weight_kg,target_weight_kg,activity_level,goal_mode,theme,onboarded";

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
      },
      { onConflict: "user_id" },
    );

  if (error) throw new Error(error.message);
}
