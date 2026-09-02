import { requireSupabase } from "../lib/supabase";
import type { WeightLog } from "../types";

/**
 * The body-weight log.
 *
 * One row per person per day, so a second weigh-in on the same morning
 * corrects the first rather than sitting beside it — two contradictory numbers
 * in one day would quietly skew that week's average, which is the one figure
 * the calibration engine depends on.
 */

/** PostgREST's code for "you asked for a table this database does not have". */
const UNDEFINED_TABLE = "42P01";

const FIELDS = "date,weight_kg,waist_cm";

/**
 * Weigh-ins from `from` onwards, oldest first.
 *
 * Returns an empty list rather than throwing when the table is missing. The
 * app and the database are deployed separately here, and a build that reaches
 * a project without the migration should lose the trend chart, not the diary
 * — every screen that shows a target waits on this.
 */
export async function loadWeightLogs(from: string): Promise<WeightLog[]> {
  const client = requireSupabase();

  const { data, error } = await client
    .from("weight_logs")
    .select(FIELDS)
    .gte("date", from)
    .order("date", { ascending: true });

  if (error) {
    if (error.code === UNDEFINED_TABLE) {
      if (import.meta.env.DEV) {
        console.warn(
          "[weight] the weight_logs table is missing — run the body_composition_engine " +
            "migration. Weight tracking and calibrated targets are unavailable until then.",
        );
      }
      return [];
    }
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    date: String(row.date),
    weightKg: Number(row.weight_kg),
    // Measured every few weeks at most, so absent on the great majority of rows.
    waistCm: row.waist_cm === null || row.waist_cm === undefined ? null : Number(row.waist_cm),
  }));
}

/**
 * Records a weigh-in, replacing any already recorded for that day.
 *
 * The waist figure is only written when given: passing null on a normal
 * morning must not wipe a measurement taken last week, because the two are
 * recorded on completely different rhythms.
 */
export async function saveWeightLog(userId: string, log: WeightLog): Promise<void> {
  const client = requireSupabase();

  const row: Record<string, unknown> = {
    user_id: userId,
    date: log.date,
    weight_kg: log.weightKg,
    updated_at: new Date().toISOString(),
  };
  if (log.waistCm !== null && log.waistCm !== undefined) row.waist_cm = log.waistCm;

  const { error } = await client
    .from("weight_logs")
    .upsert(row, { onConflict: "user_id,date" });

  if (!error) return;
  if (error.code === UNDEFINED_TABLE) {
    throw new Error(
      "Weight tracking is not available yet. Please try again once the app has been updated.",
    );
  }
  throw new Error(error.message);
}

/** Erases the whole log. Called from the same place as the rest of health data. */
export async function deleteAllWeightLogs(userId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from("weight_logs").delete().eq("user_id", userId);
  if (error && error.code !== UNDEFINED_TABLE) throw new Error(error.message);
}
