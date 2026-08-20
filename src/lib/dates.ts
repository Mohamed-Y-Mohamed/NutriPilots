/** The user's local calendar day, which is the day they think they ate on. */
export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

/**
 * How long until an instant, as "3h 20m" or "12m".
 *
 * A countdown rather than a clock time: the daily AI allowance resets at
 * midnight UTC, which lands at a different — and to most people meaningless —
 * hour depending on where they are.
 */
export function formatTimeUntil(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "a moment";

  const totalMinutes = Math.round(diffMs / 60_000);
  if (totalMinutes === 0) return "under a minute";

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

function isToday(dateKey: string): boolean {
  return dateKey === localDateKey();
}

export function formatDayLabel(dateKey: string): string {
  if (isToday(dateKey)) return "Today";
  if (dateKey === addDays(localDateKey(), -1)) return "Yesterday";
  if (dateKey === addDays(localDateKey(), 1)) return "Tomorrow";

  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
