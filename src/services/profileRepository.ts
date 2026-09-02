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
  // Null rather than zero throughout: "no step count recorded" and "walks no
  // steps" are different facts, and the calculator treats them differently.
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

// One string literal each, not a concatenation: supabase-js reads the column
// list at the type level to work out the shape of `data`, and a `+` leaves it
// with no literal to read.
const FIELDS =
  "display_name,age,calculation_sex,height_cm,weight_kg,target_weight_kg,activity_level,goal_mode,theme,onboarded,target_calories,target_protein_g,target_carbs_g,target_fat_g,target_fibre_g,targets_source,targets_set_at,steps_per_day,resistance_sessions,cardio_sessions,body_fat_percent,waist_cm,training_experience,on_medication";

/** Without the body-composition columns, for a database that predates them. */
const FIELDS_WITHOUT_BODY_COMP =
  "display_name,age,calculation_sex,height_cm,weight_kg,target_weight_kg,activity_level,goal_mode,theme,onboarded,target_calories,target_protein_g,target_carbs_g,target_fat_g,target_fibre_g,targets_source,targets_set_at";

/** The same list without the target columns either, for an older one still. */
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
  if (!full.error) return full.data ? toProfile(full.data) : null;
  if (full.error.code !== UNDEFINED_COLUMN) throw new Error(full.error.message);

  // Names a migration and a set of columns, so it stays out of a shipped
  // console — a production console is somewhere users and their extensions
  // can read, and a build strips these branches entirely.
  if (import.meta.env.DEV) {
    console.warn(
      "[profile] the body-composition columns are missing from this database — run the " +
        "body_composition_engine migration. Steps, training and the medication flag are " +
        "unavailable until then, and targets fall back to the activity-level estimate.",
    );
  }

  const withTargets = await client
    .from("user_profiles")
    .select(FIELDS_WITHOUT_BODY_COMP)
    .maybeSingle();
  if (!withTargets.error) return withTargets.data ? toProfile(withTargets.data) : null;
  if (withTargets.error.code !== UNDEFINED_COLUMN) throw new Error(withTargets.error.message);

  if (import.meta.env.DEV) {
    console.warn(
      "[profile] the target columns are missing too — run the target_overrides migration. " +
        "Custom daily targets are unavailable until then.",
    );
  }

  const basic = await client.from("user_profiles").select(FIELDS_WITHOUT_TARGETS).maybeSingle();
  if (basic.error) throw new Error(basic.error.message);
  return basic.data ? toProfile(basic.data) : null;
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
    stepsPerDay: optionalNumber(row.steps_per_day),
    resistanceSessions: optionalNumber(row.resistance_sessions),
    cardioSessions: optionalNumber(row.cardio_sessions),
    bodyFatPercent: optionalNumber(row.body_fat_percent),
    waistCm: optionalNumber(row.waist_cm),
    trainingExperience: (row.training_experience ?? null) as UserProfile["trainingExperience"],
    onMedication: Boolean(row.on_medication),
    // All five have to be present to mean anything. A half-written override —
    // or a database that has none of the columns — is treated as no override at
    // all rather than as a plan with holes in it.
    targetOverride: readTargets(row),
    targetsSource: (row.targets_source ?? null) as TargetsSource | null,
    targetsSetAt: (row.targets_set_at ?? null) as string | null,
  };
}

/**
 * A number the user may simply not have given.
 *
 * Zero is a real answer to "how many steps" and null is not, so they must not
 * collapse into each other: the calculator falls back to the self-reported
 * activity band on null and would otherwise read a missing value as a person
 * who never moves.
 */
function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

  /**
   * Written separately from `body` so that a database without these columns can
   * still save the rest, the same bargain the target columns already strike.
   */
  const bodyComposition = {
    steps_per_day: profile.stepsPerDay,
    resistance_sessions: profile.resistanceSessions,
    cardio_sessions: profile.cardioSessions,
    body_fat_percent: profile.bodyFatPercent,
    waist_cm: profile.waistCm,
    training_experience: profile.trainingExperience,
    on_medication: profile.onMedication,
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
    .upsert({ ...body, ...bodyComposition, ...targets }, { onConflict: "user_id" });

  if (!error) return;
  if (error.code !== UNDEFINED_COLUMN) throw new Error(error.message);

  // Steps, training and the medication flag refine a target rather than being
  // one, so a database that lacks the columns can still save everything else
  // and simply calculate from the activity band instead.
  const withoutBodyComp = await client
    .from("user_profiles")
    .upsert({ ...body, ...targets }, { onConflict: "user_id" });
  if (!withoutBodyComp.error) return;
  if (withoutBodyComp.error.code !== UNDEFINED_COLUMN) {
    throw new Error(withoutBodyComp.error.message);
  }

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

  const clearedTargets = {
    target_calories: null,
    target_protein_g: null,
    target_carbs_g: null,
    target_fat_g: null,
    target_fibre_g: null,
    targets_source: null,
    targets_set_at: null,
  };

  // Body measurements are health data and go with the rest of it. The
  // medication flag resets to false rather than null: it is a yes/no answer
  // and "not answered" is the same as "no" for everything that reads it.
  const clearedBodyComp = {
    steps_per_day: null,
    resistance_sessions: null,
    cardio_sessions: null,
    body_fat_percent: null,
    waist_cm: null,
    training_experience: null,
    on_medication: false,
  };

  const client = requireSupabase();
  const { error } = await client
    .from("user_profiles")
    .upsert({ ...cleared, ...clearedBodyComp, ...clearedTargets }, { onConflict: "user_id" });

  if (!error) return;
  if (error.code !== UNDEFINED_COLUMN) throw new Error(error.message);

  // Columns that do not exist hold nothing to erase, so a database without
  // them is already in the state this is trying to reach. "Delete my data"
  // must never be the thing that fails, so each step back is tried in turn.
  const withoutBodyComp = await client
    .from("user_profiles")
    .upsert({ ...cleared, ...clearedTargets }, { onConflict: "user_id" });
  if (!withoutBodyComp.error) return;
  if (withoutBodyComp.error.code !== UNDEFINED_COLUMN) {
    throw new Error(withoutBodyComp.error.message);
  }

  const retry = await client.from("user_profiles").upsert(cleared, { onConflict: "user_id" });
  if (retry.error) throw new Error(retry.error.message);
}
