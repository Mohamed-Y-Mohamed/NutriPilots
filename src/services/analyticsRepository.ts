import { UserFacingError } from "../lib/errors";
import { requireSupabase } from "../lib/supabase";
import type { DayTotals } from "../types";

/**
 * The routine that adds up a day has not been deployed to this database yet.
 *
 * The reader is told trends are not ready, not which migration is outstanding:
 * that is our problem, and the only thing they could do with the answer is
 * worry about the state of the app.
 */
export class MissingMigrationError extends UserFacingError {
  constructor() {
    super("Trends are not available just yet. Please check back shortly.");
    this.name = "MissingMigrationError";
  }
}

/**
 * What each day between two dates added up to, for the calling user only.
 *
 * Days with nothing logged are simply absent rather than returned as zeroes —
 * "no data" and "ate nothing" are different claims, and only the caller knows
 * which one it wants to draw.
 */
export async function loadDailyTotals(from: string, to: string): Promise<DayTotals[]> {
  const { data, error } = await requireSupabase().rpc("daily_totals", {
    from_date: from,
    to_date: to,
  });

  // The function is added by a migration, and the app can be deployed ahead of
  // it. The trends card knows how to say so; a raw "function does not exist"
  // would not tell anyone what to do about it.
  if (error?.code === "PGRST202" || error?.code === "42883") {
    throw new MissingMigrationError();
  }
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    date: String(row.day ?? ""),
    calories: Number(row.calories ?? 0),
    protein: Number(row.protein ?? 0),
    carbs: Number(row.carbs ?? 0),
    fat: Number(row.fat ?? 0),
    fibre: Number(row.fibre ?? 0),
    items: Number(row.items ?? 0),
  }));
}
