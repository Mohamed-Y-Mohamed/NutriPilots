import { requireSupabase } from "../lib/supabase";
import type { DayTotals } from "../types";

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
