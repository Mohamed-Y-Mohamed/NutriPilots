import { parseJsonObject, splitBlock } from "./blocks.ts";
import { round, text } from "./coerce.ts";

/**
 * A revised set of daily targets, pulled off the end of a coach reply.
 *
 * This is the only path by which a model's output can change the figure a user
 * measures themselves against, so nothing here is taken on trust. The prompt
 * states the safety floors; this file enforces them, because a prompt is a
 * request and a clamp is a guarantee.
 *
 * The user still has to accept the plan before anything is written. Emitting a
 * block changes nothing on its own.
 */

/** Absolute bounds, whatever the model or the caller's floor says. */
const CEILING_CALORIES = 8000;
const MACRO_CEILINGS = { protein: 1000, carbs: 2000, fat: 1000, fibre: 300 };

/**
 * How far the macros may drift from the stated calories before they are
 * treated as describing a different diet. Protein and carbs at 4 kcal/g and
 * fat at 9 never lands exactly, so some slack is normal.
 */
const RECONCILE_TOLERANCE = 0.15;

export interface CoachPlan {
  targets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fibre: number;
  };
  reason: string;
  exercise: string;
}

/**
 * Splits the prose from the proposal.
 *
 * `floorCalories` is the lowest daily figure allowed for this user — 1200 for
 * women, 1500 for men — and a plan below it is raised rather than rejected, so
 * a model that lowballs still produces something safe instead of nothing.
 */
export function splitPlan(
  raw: string,
  floorCalories: number,
): { reply: string; plan: CoachPlan | null } {
  const { rest: reply, payload } = splitBlock(raw, "PLAN");

  const parsed = payload === null ? null : parseJsonObject(payload);
  if (!parsed) return { reply, plan: null };

  // Without a calorie figure there is no plan, only a comment.
  const stated = round(parsed.calories, 0);
  if (!stated || stated <= 0) return { reply, plan: null };

  const calories = clamp(stated, floorCalories, CEILING_CALORIES);
  const targets = reconcile(
    {
      calories,
      protein: clamp(round(parsed.protein_g, 0), 0, MACRO_CEILINGS.protein),
      carbs: clamp(round(parsed.carbs_g, 0), 0, MACRO_CEILINGS.carbs),
      fat: clamp(round(parsed.fat_g, 0), 0, MACRO_CEILINGS.fat),
      fibre: clamp(round(parsed.fibre_g, 0), 0, MACRO_CEILINGS.fibre),
    },
  );

  return {
    reply,
    plan: {
      targets,
      reason: text(parsed.reason, "", 240),
      exercise: text(parsed.exercise, "", 400),
    },
  };
}

/**
 * Macros that add up to something other than the stated calories are pulled
 * into line with it.
 *
 * The calorie figure is the headline the user reads and the one the ring on
 * the Today screen is drawn from, so it wins. Macros that describe a 3,400
 * kcal day under a 2,100 kcal heading are not a plan anybody can follow, and
 * showing them unchanged would put two contradictory numbers on one card.
 */
function reconcile(targets: CoachPlan["targets"]): CoachPlan["targets"] {
  const fromMacros = targets.protein * 4 + targets.carbs * 4 + targets.fat * 9;
  if (fromMacros <= 0) return targets;

  const drift = Math.abs(fromMacros - targets.calories) / targets.calories;
  if (drift <= RECONCILE_TOLERANCE) return targets;

  // Re-clamped, because scaling happens after the ceilings were applied and
  // can carry a figure straight back past them: with carbs and fat at zero,
  // protein becomes calories/4, which is 2,000g at the calorie ceiling. The
  // table rejects that, and the user is shown a raw constraint violation.
  const scale = targets.calories / fromMacros;
  return {
    ...targets,
    protein: clamp(Math.round(targets.protein * scale), 0, MACRO_CEILINGS.protein),
    carbs: clamp(Math.round(targets.carbs * scale), 0, MACRO_CEILINGS.carbs),
    fat: clamp(Math.round(targets.fat * scale), 0, MACRO_CEILINGS.fat),
  };
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value, low), high);
}
