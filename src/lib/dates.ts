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
