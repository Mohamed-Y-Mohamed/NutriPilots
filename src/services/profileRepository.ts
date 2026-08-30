import { userError } from "../lib/errors";
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

// One string literal each, not a concatenation: supabase-js reads the column
// list at the type level to work out the shape of `data`, and a `+` leaves it
// with no literal to read.
const FIELDS =
  "display_name,age,calculation_sex,height_cm,weight_kg,target_weight_kg,activity_level,goal_mode,theme,onboarded,target_calories,target_protein_g,target_carbs_g,target_fat_g,target_fibre_g,targets_source,targets_set_at";

/** The same list without the target columns, for a database that predates them. */
const FIELDS_WITHOUT_TARGETS =
  "display_name,age,calculation_sex,height_cm,weight_kg,target_weight_kg,activity_level,goal_mode,theme,onboarded";

/** PostgREST's code for "you asked for a column this table does not have". */
const UNDEFINED_COLUMN = "42703";

/**
 * The signed-in user's profile, or null if they have never saved one.
 *
 * The app and the database are deployed separately and by hand, so a build can
 * reach a project whose migrations have not been run yet. Being unable to
 * override a target is a missing feature; failing the whole load is an unusable
 * app, because the diary, the goals screen and the coach all wait on this call.
 * So the newer columns are asked for and done without if they are not there.
 */
export async function loadProfile(): Promise<UserProfile | null> {
  const client = requireSupabase();

  const full = await client.from("user_profiles").select(FIELDS).maybeSingle();

  if (full.error?.code === UNDEFINED_COLUMN) {
    // Names a migration and a set of columns, so it stays out of a shipped
    // console — a production console is somewhere users and their extensions
    // can read, and a build strips this branch entirely.
    if (import.meta.env.DEV) {
      console.warn(
        "[profile] the target columns are missing from this database — run the " +
          "target_overrides migration. Custom daily targets are unavailable until then.",
      );
    }

    const basic = await client.from("user_profiles").select(FIELDS_WITHOUT_TARGETS).maybeSingle();
    if (basic.error) throw new Error(basic.error.message);
    return basic.data ? toProfile(basic.data) : null;
  }

  if (full.error) throw new Error(full.error.message);
  return full.data ? toProfile(full.data) : null;
}

/** Reads whichever columns came back, defaulting anything absent. */
function toProfile(row: Record<string, unknown>): UserProfile {
  return {
    name: (row.display_name as string) ?? "",
    age: Number(row.age ?? DEFAULT_PROFILE.age),
    calculationSex: (row.calculation_sex ?? DEFAULT_PROFILE.calculationSex) as UserProfile["calculationSex"],
    heightCm: Number(row.height_cm ?? DEFAULT_PROFILE.heightCm),
    weightKg: Number(row.weight_kg ?? DEFAULT_PROFILE.weightKg),
    targetWeightKg: Number(row.target_weight_kg ?? DEFAULT_PROFILE.targetWeightKg),
    activityLevel: (row.activity_level ?? DEFAULT_PROFILE.activityLevel) as UserProfile["activityLevel"],
    goalMode: (row.goal_mode ?? DEFAULT_PROFILE.goalMode) as UserProfile["goalMode"],
    theme: (row.theme ?? "system") as UserProfile["theme"],
    onboarded: Boolean(row.onboarded),
    // All five have to be present to mean anything. A half-written override —
    // or a database that has none of the columns — is treated as no override at
    // all rather than as a plan with holes in it.
    targetOverride: readTargets(row),
    targetsSource: (row.targets_source ?? null) as TargetsSource | null,
    targetsSetAt: (row.targets_set_at ?? null) as string | null,
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
  const body = {
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
  };

  const targets = {
    target_calories: profile.targetOverride?.calories ?? null,
    target_protein_g: profile.targetOverride?.protein ?? null,
    target_carbs_g: profile.targetOverride?.carbs ?? null,
    target_fat_g: profile.targetOverride?.fat ?? null,
    target_fibre_g: profile.targetOverride?.fibre ?? null,
    targets_source: profile.targetOverride ? profile.targetsSource : null,
    targets_set_at: profile.targetOverride
      ? (profile.targetsSetAt ?? new Date().toISOString())
      : null,
  };

  const client = requireSupabase();
  const { error } = await client
    .from("user_profiles")
    .upsert({ ...body, ...targets }, { onConflict: "user_id" });

  if (!error) return;
  if (error.code !== UNDEFINED_COLUMN) throw new Error(error.message);

  // Same reasoning as loadProfile: a database that predates the target columns
  // must not stop someone saving their height and weight. Setting an override
  // genuinely cannot work there, so that is refused rather than silently
  // dropped — the alternative is a Save button that reports success and
  // changes nothing.
  if (profile.targetOverride) {
    // Which migration is outstanding is ours to know and ours to run. The
    // reader gets the part that concerns them: their body stats saved, their
    // custom targets did not, and it is not something they did.
    if (import.meta.env.DEV) {
      console.error(
        "[nutripilot] custom targets need the target_overrides migration — run it, then retry.",
      );
    }
    throw userError(
      "Custom daily targets are not available just yet — your other details were saved. " +
        "Please try again later.",
    );
  }

  const retry = await client.from("user_profiles").upsert(body, { onConflict: "user_id" });
  if (retry.error) throw new Error(retry.error.message);
}

/** Removes body stats and goals but keeps the account and its theme choice. */
export async function resetHealthData(userId: string, theme: UserProfile["theme"]): Promise<void> {
  const cleared = {
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
  };

  const client = requireSupabase();
  const { error } = await client.from("user_profiles").upsert(
    {
      ...cleared,
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

  if (!error) return;
  if (error.code !== UNDEFINED_COLUMN) throw new Error(error.message);

  // Columns that do not exist hold nothing to erase, so a database without
  // them is already in the state this is trying to reach. "Delete my data"
  // must never be the thing that fails.
  const retry = await client.from("user_profiles").upsert(cleared, { onConflict: "user_id" });
  if (retry.error) throw new Error(retry.error.message);
}
