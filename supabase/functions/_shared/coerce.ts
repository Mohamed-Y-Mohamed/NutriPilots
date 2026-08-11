/**
 * Turning whatever a model returned into values the database will accept.
 *
 * Every field crossing this boundary is untrusted: a model can send a string
 * where a number belongs, a negative calorie count, or a 4,000-character name.
 */

export function round(value: unknown, decimals: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

export function text(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
}

/** What the calorie figure is based on, so the user can check the assumptions. */
export function ingredientList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 120))
    .slice(0, 20);
}
