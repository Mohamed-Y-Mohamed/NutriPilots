import type { WeightLog } from "../types";

/**
 * What the scale actually did, and what that says about maintenance.
 *
 * The equation in lib/energy.ts predicts. This measures. Where the two
 * disagree over a few weeks of consistent logging, this one is right — an
 * observation of one person beats a prediction about people shaped like them,
 * and refusing to update is how an app ends up insisting a user is wrong about
 * their own body.
 */

/**
 * Energy per kilogram of body tissue lost or gained, near enough.
 *
 * Deliberately NOT used to forecast — "500 kcal a day is a pound a week,
 * forever" is false, because expenditure falls as body mass does. It is used
 * only in the direction it holds up in: reading backwards over a two-to-four
 * week window that has already happened, to ask what intake must have been
 * relative to maintenance for the scale to have moved as it did.
 */
const ENERGY_PER_KG = 7700;

/** A seven-day average built from fewer than this is one bad day, not a trend. */
const MIN_WEIGH_INS_PER_WINDOW = 3;

/** Below this many days, weight noise still swamps the signal. */
const MIN_DAYS_FOR_CALIBRATION = 14;
const MAX_DAYS_FOR_CALIBRATION = 28;

/** How much of the window needs food logged before the average means anything. */
const MIN_INTAKE_COVERAGE = 0.6;

/**
 * Sanity bounds on a calibrated figure. Past these, the arithmetic has been fed
 * something wrong — a weight typed in pounds, a fortnight of untracked holiday
 * — and a wrong maintenance figure is worse than none, because everything
 * downstream trusts it.
 */
const PLAUSIBLE_MAINTENANCE = { min: 1000, max: 6000 } as const;

export interface WeightTrend {
  /** Seven-day average ending today, or null when too few weigh-ins. */
  currentAverage: number | null;
  /** The same for the seven days before that. */
  previousAverage: number | null;
  /** Kilograms a week, signed. Negative is loss. */
  weeklyChangeKg: number | null;
  /** The same as a share of body weight, which is how targets are set. */
  weeklyPercent: number | null;
  entriesInWindow: number;
}

/**
 * Week against week, both ends averaged.
 *
 * Comparing single weigh-ins is the commonest way to read noise as a result:
 * a salty dinner or an unslept night moves the scale by more than a good week
 * of fat loss does. Averaging both ends is what makes the difference mean
 * something.
 */
export function summariseWeightTrend(logs: WeightLog[], today: string): WeightTrend {
  const byDate = new Map(logs.map((log) => [log.date, log.weightKg]));

  const current = windowAverage(byDate, today, 0, 7);
  const previous = windowAverage(byDate, today, 7, 7);

  const weeklyChangeKg =
    current !== null && previous !== null ? round2(current - previous) : null;

  return {
    currentAverage: current === null ? null : round2(current),
    previousAverage: previous === null ? null : round2(previous),
    weeklyChangeKg,
    weeklyPercent:
      weeklyChangeKg !== null && previous
        ? round2((weeklyChangeKg / previous) * 100)
        : null,
    entriesInWindow: countInWindow(byDate, today, 0, 14),
  };
}

export interface DailyIntake {
  date: string;
  calories: number;
}

export interface Calibration {
  /** Maintenance implied by what they ate and what the scale did. */
  maintenance: number;
  confidence: "low" | "medium" | "high";
  daysOfWeight: number;
  daysOfIntake: number;
  windowDays: number;
  /** Kilograms across the whole window, signed. */
  totalChangeKg: number;
}

/**
 * Maintenance worked back from real results, or null when the data cannot
 * support one.
 *
 * A caveat that matters more than it looks: this figure is denominated in
 * *logged* calories, not true ones. People under-record, often by a fifth or
 * more, so the number will usually sit below their physiological maintenance.
 * That is not a defect for this purpose — as long as somebody logs the same
 * way next month as last, "eat what you record as 2,650 and you hold steady"
 * is exactly the operationally useful figure, and it is calibrated to them
 * rather than to a population. It is only wrong if their logging habits change,
 * which is why the coach is told to check adherence before trusting a swing.
 */
export function calibrateMaintenance(
  logs: WeightLog[],
  intake: DailyIntake[],
  today: string,
): Calibration | null {
  const weightByDate = new Map(logs.map((log) => [log.date, log.weightKg]));

  /**
   * A fortnight-wide window is not a fortnight of data.
   *
   * The older seven-day average only needs three weigh-ins to exist, so ten
   * days of logging would otherwise satisfy a "14-day" window and be
   * calibrated as though it spanned one — reading a few days of water shift as
   * a metabolic fact. The data has to actually reach back that far.
   */
  let oldest = -1;
  for (let back = 0; back <= MAX_DAYS_FOR_CALIBRATION; back += 1) {
    if (weightByDate.has(shiftDays(today, back))) oldest = back;
  }
  if (oldest < MIN_DAYS_FOR_CALIBRATION - 1) return null;

  // Use the longest window the data genuinely supports: more days, less noise.
  let windowDays = 0;
  for (let days = Math.min(MAX_DAYS_FOR_CALIBRATION, oldest + 1); days >= MIN_DAYS_FOR_CALIBRATION; days -= 1) {
    const early = windowAverage(weightByDate, today, days - 7, 7);
    const late = windowAverage(weightByDate, today, 0, 7);
    if (early !== null && late !== null) {
      windowDays = days;
      break;
    }
  }
  if (windowDays === 0) return null;

  const startAverage = windowAverage(weightByDate, today, windowDays - 7, 7);
  const endAverage = windowAverage(weightByDate, today, 0, 7);
  if (startAverage === null || endAverage === null) return null;

  const intakeByDate = new Map(intake.map((day) => [day.date, day.calories]));
  const logged: number[] = [];
  for (let back = 0; back < windowDays; back += 1) {
    const calories = intakeByDate.get(shiftDays(today, back));
    // A day with nothing logged is a day with no data, not a fasting day.
    if (calories !== undefined && calories > 0) logged.push(calories);
  }

  if (logged.length / windowDays < MIN_INTAKE_COVERAGE) return null;

  const averageIntake = logged.reduce((sum, value) => sum + value, 0) / logged.length;

  // The two averages sit seven days apart at their midpoints less than the
  // window suggests, so the change is measured across the gap between the
  // midpoints rather than across the raw window.
  const spanDays = windowDays - 7;
  if (spanDays <= 0) return null;

  const totalChangeKg = endAverage - startAverage;
  const dailyImbalance = (totalChangeKg * ENERGY_PER_KG) / spanDays;
  const maintenance = Math.round(averageIntake - dailyImbalance);

  if (maintenance < PLAUSIBLE_MAINTENANCE.min || maintenance > PLAUSIBLE_MAINTENANCE.max) {
    return null;
  }

  const daysOfWeight = countInWindow(weightByDate, today, 0, windowDays);

  return {
    maintenance,
    confidence: confidenceOf(windowDays, daysOfWeight, logged.length),
    daysOfWeight,
    daysOfIntake: logged.length,
    windowDays,
    totalChangeKg: round2(totalChangeKg),
  };
}

/**
 * More days and denser logging earn more trust. Nothing here reaches "high"
 * on a fortnight — three weeks is where a weight trend stops being an argument
 * about water.
 */
function confidenceOf(windowDays: number, daysOfWeight: number, daysOfIntake: number): Calibration["confidence"] {
  const weightCoverage = daysOfWeight / windowDays;
  const intakeCoverage = daysOfIntake / windowDays;

  if (windowDays >= 21 && weightCoverage >= 0.6 && intakeCoverage >= 0.8) return "high";
  if (weightCoverage >= 0.4 && intakeCoverage >= 0.7) return "medium";
  return "low";
}

export interface PlateauVerdict {
  plateaued: boolean;
  /** Whole weeks of data the verdict rests on. */
  weeksObserved: number;
  /** Average weekly change as a share of body weight, signed. */
  weeklyPercent: number | null;
}

/** Below this weekly movement, in either direction, nothing is happening. */
const PLATEAU_THRESHOLD_PERCENT = 0.15;
/** Weeks of flat trend before the word "plateau" is allowed out loud. */
const PLATEAU_WEEKS = 3;

/**
 * Whether a fat-loss effort has genuinely stopped moving.
 *
 * Deliberately slow to say yes. Calling a plateau after a few days is how a
 * user ends up cutting calories to chase a water fluctuation, and the app
 * would be the one that told them to. Three weeks of a flat average, with
 * enough weigh-ins behind it to mean something, or it says no.
 */
export function detectPlateau(logs: WeightLog[], today: string): PlateauVerdict {
  const byDate = new Map(logs.map((log) => [log.date, log.weightKg]));
  const windowDays = PLATEAU_WEEKS * 7;

  const start = windowAverage(byDate, today, windowDays - 7, 7);
  const end = windowAverage(byDate, today, 0, 7);
  const weeksObserved = Math.floor(countInWindow(byDate, today, 0, windowDays) / 7);

  if (start === null || end === null || !start) {
    return { plateaued: false, weeksObserved, weeklyPercent: null };
  }

  const weeks = (windowDays - 7) / 7;
  const weeklyPercent = ((end - start) / start / weeks) * 100;

  return {
    plateaued: Math.abs(weeklyPercent) < PLATEAU_THRESHOLD_PERCENT,
    weeksObserved,
    weeklyPercent: round2(weeklyPercent),
  };
}

/**
 * The mean of whatever weigh-ins fall inside a window, or null when there are
 * too few for it to describe anything.
 */
function windowAverage(
  byDate: Map<string, number>,
  today: string,
  offset: number,
  length: number,
): number | null {
  const values: number[] = [];
  for (let back = offset; back < offset + length; back += 1) {
    const weight = byDate.get(shiftDays(today, back));
    if (weight !== undefined) values.push(weight);
  }

  if (values.length < MIN_WEIGH_INS_PER_WINDOW) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countInWindow(
  byDate: Map<string, number>,
  today: string,
  offset: number,
  length: number,
): number {
  let count = 0;
  for (let back = offset; back < offset + length; back += 1) {
    if (byDate.has(shiftDays(today, back))) count += 1;
  }
  return count;
}

function shiftDays(dateKey: string, back: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
