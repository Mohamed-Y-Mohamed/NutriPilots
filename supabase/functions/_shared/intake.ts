/**
 * The user's eating history, and the decision about whether to send it at all.
 *
 * Most questions a nutrition coach gets are answered from general knowledge:
 * how much protein builds muscle, whether quinoa beats rice, what a 500 kcal
 * lunch looks like. None of those are improved by knowing what this particular
 * person ate three Tuesdays ago, so none of them are worth handing that over
 * for.
 *
 * A few questions cannot be answered without it. "Why have I been the same
 * weight for three weeks?" has no honest answer that does not look at what
 * actually went in. Those are the ones — and only those — that carry the
 * history with them.
 */

export interface IntakeEntry {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** One month back, and the month before it for comparison. */
const BLOCK_DAYS = 30;
/** How many recent weeks get their own figure. */
const WEEKS_SHOWN = 4;

/**
 * Questions that cannot be answered from general knowledge alone.
 *
 * Written to under-match rather than over-match: a missed one costs a vaguer
 * answer the user can follow up on, a false one sends a month of someone's
 * eating to a model that had no use for it.
 */
const NEEDS_HISTORY: RegExp[] = [
  // A result that has stopped moving. "Stuck" and "stalled" need something to
  // be stuck about, or they catch "I'm stuck on what to cook for dinner".
  /\bplateau(ed)?\b/,
  // "at 82kg" is a weight too, and the commonest way people write one.
  /\b(stuck|stalled)\b[^.?!]*(\b(weight|scale|progress|loss|losing|cut|bulk|gain)\b|\d+\s*(kg|lbs?|stone|st)\b)/,
  /\bsame weight\b/,
  /\bno (progress|change|results|movement)\b/,
  /\b(not|n't|stopped|no longer)\s+(losing|gaining|dropping|shifting|budging|moving)\b/,
  /\bweight\b[^.?!]*\b(hasn't|isn't|has not|is not|not)\b[^.?!]*\b(moved|moving|changed|changing|budged|dropped|shifted)\b/,

  // Asking the app to judge how they have been getting on. Every one of these
  // needs a first person: "consistency" and "on track" on their own are
  // general advice that no diary improves.
  /\bam i\b[^.?!]*\b(eating|getting|having)\b[^.?!]*\b(enough|too much|too little|too few|too many)\b/,
  /\bhow (am i|have i been|are things)\b[^.?!]*\bdoing\b/,
  /\bwhat am i doing wrong\b/,
  /\bhow have i been\b/,
  /\b(am i|i'm|have i been)\b[^.?!]*\bconsistent/,
  /\b(am i|i'm)\b[^.?!]*\bon track\b/,
  /\breview my (diary|intake|log|logs|week|month|progress|numbers|data|eating|food)\b/,

  // Their own numbers over a stretch of time. "the average" is somebody else's
  // — "what is the average calorie content of a banana" needs no diary at all.
  /\bmy (average|typical|usual)\b/,
  /\bmy\b[^.?!]*\baverage (intake|calories|kcal|protein|macros)\b/,
  /\b(am i|i'm|my)\b[^.?!]*\b(deficit|surplus|maintenance)\b/,
  // Backward-looking only. "this week" on its own is a plan for the days ahead.
  /\b(last|past|previous)\s+(week|fortnight|month)\b[^.?!]*\b(eat|ate|eaten|eating|intake|calories|kcal|protein|logged|diet)\b/,
  /\b(ate|eaten|logged)\b[^.?!]*\b(last|past|previous|this)\s+(week|fortnight|month)\b/,
  /\bmy\b[^.?!]*\b(trend|trending)\b/,
];

/** The oldest day `summariseIntake` will look at, so the caller can fetch it. */
export function historyStartDate(today: string): string {
  return shiftDays(today, BLOCK_DAYS * 2 - 1);
}

/** Whether this question needs more than today's plate to answer honestly. */
export function needsIntakeHistory(message: string): boolean {
  // Phones fit curly apostrophes as standard, and "I'm" must read the same as
  // "I'm" to every pattern above.
  const text = message.toLowerCase().replace(/[‘’ʼ`´]/g, "'");
  return NEEDS_HISTORY.some((pattern) => pattern.test(text));
}

interface DayTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface Block {
  daysLogged: number;
  /** Averages per logged day, not per calendar day. */
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  from: string;
  to: string;
}

/**
 * The last two months of eating, as a few lines a model can reason over.
 *
 * Averages are per *logged* day throughout. Averaging over calendar days would
 * quietly turn "I logged twelve days at 2,100" into "you averaged 840", which
 * is not a smaller number — it is a different and untrue claim.
 *
 * Returns an empty string when there is nothing logged in either month, so the
 * caller can simply leave the section out.
 */
export function summariseIntake(entries: IntakeEntry[], today: string): string {
  const byDay = new Map<string, DayTotals>();
  for (const entry of entries) {
    const running = byDay.get(entry.date) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
    byDay.set(entry.date, {
      calories: running.calories + num(entry.calories),
      protein: running.protein + num(entry.protein),
      carbs: running.carbs + num(entry.carbs),
      fat: running.fat + num(entry.fat),
    });
  }

  const recent = blockFrom(byDay, today, 0);
  const previous = blockFrom(byDay, today, BLOCK_DAYS);
  if (recent.daysLogged === 0 && previous.daysLogged === 0) return "";

  const lines = [
    "INTAKE HISTORY — this user's own logged food. Reason from these figures; do not read them back.",
  ];

  if (recent.daysLogged > 0) {
    lines.push(
      `- Last ${BLOCK_DAYS} days (${label(recent.from)} to ${label(recent.to)}): ` +
        `${recent.daysLogged} of ${BLOCK_DAYS} days logged, averaging ${describe(recent)} per logged day.`,
    );
  } else {
    lines.push(`- Last ${BLOCK_DAYS} days: nothing logged.`);
  }

  if (previous.daysLogged > 0) {
    lines.push(
      `- The ${BLOCK_DAYS} days before that (${label(previous.from)} to ${label(previous.to)}): ` +
        `${previous.daysLogged} of ${BLOCK_DAYS} days logged, averaging ${describe(previous)} per logged day.`,
    );
  }

  // Only worth stating when both halves have something to compare.
  if (recent.daysLogged > 0 && previous.daysLogged > 0) {
    lines.push(`- Change: ${change(recent, previous)}.`);
  }

  const weeks = recentWeeks(byDay, today);
  if (weeks.length >= 2) {
    lines.push(
      `- Recent weeks, newest first: ${weeks.map((week) => Math.round(week)).join(", ")} kcal/day.`,
    );
  }

  lines.push(
    "A day with nothing logged is a day with no data, not a day with no food — do not read a gap as fasting.",
  );

  return lines.join("\n");
}

function blockFrom(byDay: Map<string, DayTotals>, today: string, offset: number): Block {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  let daysLogged = 0;

  for (let back = offset; back < offset + BLOCK_DAYS; back += 1) {
    const day = byDay.get(shiftDays(today, back));
    if (!day) continue;
    daysLogged += 1;
    totals.calories += day.calories;
    totals.protein += day.protein;
    totals.carbs += day.carbs;
    totals.fat += day.fat;
  }

  const per = (value: number) => (daysLogged === 0 ? 0 : value / daysLogged);
  return {
    daysLogged,
    calories: per(totals.calories),
    protein: per(totals.protein),
    carbs: per(totals.carbs),
    fat: per(totals.fat),
    from: shiftDays(today, offset + BLOCK_DAYS - 1),
    to: shiftDays(today, offset),
  };
}

/** Average kcal for each of the most recent weeks that has anything in it. */
function recentWeeks(byDay: Map<string, DayTotals>, today: string): number[] {
  const weeks: number[] = [];

  for (let week = 0; week < WEEKS_SHOWN; week += 1) {
    let calories = 0;
    let daysLogged = 0;

    for (let day = 0; day < 7; day += 1) {
      const totals = byDay.get(shiftDays(today, week * 7 + day));
      if (!totals) continue;
      daysLogged += 1;
      calories += totals.calories;
    }

    if (daysLogged > 0) weeks.push(calories / daysLogged);
  }

  return weeks;
}

function describe(block: Block): string {
  return (
    `${Math.round(block.calories)} kcal, ${Math.round(block.protein)}g protein, ` +
    `${Math.round(block.carbs)}g carbs, ${Math.round(block.fat)}g fat`
  );
}

function change(recent: Block, previous: Block): string {
  const parts = [
    compare(recent.calories, previous.calories, "kcal/day", "lower", "higher"),
    compare(recent.protein, previous.protein, "g/day protein", "less", "more"),
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "no meaningful difference between the two months";
}

/**
 * Reads as "400 kcal/day lower" or "20g/day more protein". Differences under a
 * unit are noise dressed up as a finding, so they are not reported at all.
 */
function compare(now: number, before: number, unit: string, down: string, up: string): string {
  const difference = Math.round(now - before);
  if (difference === 0) return "";

  const size = Math.abs(difference);
  // "20g/day protein more" reads badly; "20g/day more protein" does not.
  if (unit.endsWith(" protein")) {
    return `${size}${unit.replace(" protein", "")} ${difference > 0 ? up : down} protein`;
  }
  return `${size} ${unit} ${difference > 0 ? up : down}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-08-20" as "20 Aug", the same on every machine. */
function label(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

function shiftDays(dateKey: string, back: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
