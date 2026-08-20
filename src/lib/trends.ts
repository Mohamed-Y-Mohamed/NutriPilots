import type { DayTotals } from "../types";

export type TrendRange = "week" | "month" | "year";

/** How far either side of the target still counts as having hit it. */
const ON_TARGET_TOLERANCE = 0.1;

const DAYS_IN = { week: 7, month: 30, year: 365 } as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** One bar. A day for week and month, a whole month for year. */
export interface TrendBucket {
  key: string;
  label: string;
  /** Average kcal per logged day in the bucket; 0 when nothing was logged. */
  calories: number;
  logged: boolean;
}

export interface TrendSummary {
  range: TrendRange;
  from: string;
  to: string;
  buckets: TrendBucket[];
  daysInRange: number;
  daysLogged: number;
  /** Averages are per logged day throughout — see summariseTrend. */
  averageCalories: number;
  averageProtein: number;
  averageCarbs: number;
  averageFat: number;
  totalCalories: number;
  daysOnTarget: number;
}

/** The window a range covers, as inclusive date keys. */
export function rangeBounds(range: TrendRange, today: string): { from: string; to: string } {
  if (range === "year") {
    // Twelve named months rather than 365 loose days, so the bars line up with
    // how people talk about a year: "I was better in the spring".
    const [year, month] = today.split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 1 - 11, 1));
    return { from: start.toISOString().slice(0, 10), to: today };
  }
  return { from: shiftDays(today, DAYS_IN[range] - 1), to: today };
}

/**
 * What a stretch of the diary adds up to.
 *
 * Every average here is over the days that were actually logged, never over
 * the days in the range. Someone who logged four days at 2,100 kcal averaged
 * 2,100 — not 280. Dividing by the calendar would turn a patchy month into a
 * starvation diet on the chart and make the number worse than useless.
 *
 * `daysLogged` is reported alongside so the caller can say how much of the
 * range the figure actually rests on, and refuse to draw a chart from two days.
 */
export function summariseTrend(
  days: DayTotals[],
  { range, today, target }: { range: TrendRange; today: string; target: number },
): TrendSummary {
  const { from, to } = rangeBounds(range, today);
  const inRange = days.filter((day) => day.date >= from && day.date <= to);

  const totals = inRange.reduce(
    (sum, day) => ({
      calories: sum.calories + day.calories,
      protein: sum.protein + day.protein,
      carbs: sum.carbs + day.carbs,
      fat: sum.fat + day.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const daysLogged = inRange.length;
  const per = (value: number) => (daysLogged === 0 ? 0 : round1(value / daysLogged));

  const tolerance = target * ON_TARGET_TOLERANCE;
  const daysOnTarget = inRange.filter(
    (day) => Math.abs(day.calories - target) <= tolerance,
  ).length;

  return {
    range,
    from,
    to,
    buckets: range === "year" ? monthBuckets(inRange, today) : dayBuckets(inRange, from, to),
    daysInRange: range === "year" ? 12 : DAYS_IN[range],
    daysLogged,
    averageCalories: per(totals.calories),
    averageProtein: per(totals.protein),
    averageCarbs: per(totals.carbs),
    averageFat: per(totals.fat),
    totalCalories: round1(totals.calories),
    daysOnTarget,
  };
}

/** One bar per day, oldest first, with unlogged days present but empty. */
function dayBuckets(days: DayTotals[], from: string, to: string): TrendBucket[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const buckets: TrendBucket[] = [];

  for (let key = from; key <= to; key = shiftDays(key, -1)) {
    const found = byDate.get(key);
    buckets.push({
      key,
      label: WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()],
      calories: found ? round1(found.calories) : 0,
      logged: Boolean(found),
    });
  }

  return buckets;
}

/** One bar per month for the last twelve, each averaged over its logged days. */
function monthBuckets(days: DayTotals[], today: string): TrendBucket[] {
  const running = new Map<string, { calories: number; days: number }>();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    const found = running.get(key) ?? { calories: 0, days: 0 };
    running.set(key, { calories: found.calories + day.calories, days: found.days + 1 });
  }

  const [year, month] = today.split("-").map(Number);
  const buckets: TrendBucket[] = [];

  for (let back = 11; back >= 0; back -= 1) {
    const at = new Date(Date.UTC(year, month - 1 - back, 1));
    const key = at.toISOString().slice(0, 7);
    const found = running.get(key);

    buckets.push({
      key,
      label: MONTHS[at.getUTCMonth()],
      calories: found ? round1(found.calories / found.days) : 0,
      logged: Boolean(found),
    });
  }

  return buckets;
}

/** Negative days shift forwards, which is how the bucket loop walks a range. */
function shiftDays(dateKey: string, back: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
