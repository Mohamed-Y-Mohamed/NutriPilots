import type { DailyTargets, UserProfile } from "../types";

/**
 * What counts as a plausible daily plan, and what does not.
 *
 * Two different jobs, deliberately kept apart:
 *
 *   errors   refuse the figure. Either the number is meaningless (macros that
 *            contradict the calorie total, a negative gram figure) or it is
 *            past what someone should set for themselves without advice — in
 *            which case the error says the coach can go further, because it
 *            can, having actually read their history.
 *
 *   warnings let it through and say something. A split that matches no
 *            recognised way of eating is unusual, not wrong: the user may be
 *            following advice from a dietitian who knows more about their
 *            situation than this app does, and refusing it would make the
 *            editor useless in exactly the case it exists for.
 *
 * Ranges come from published guidance rather than from taste — sources are on
 * each style below.
 */

/**
 * Recognised ways of eating, as a share of daily energy.
 *
 * - balanced: the Acceptable Macronutrient Distribution Range (US DRI/IOM) —
 *   protein 10–35%, carbohydrate 45–65%, fat 20–35%.
 * - low-carb: commonly classified as under ~30% of energy from carbohydrate,
 *   roughly 50–150 g/day.
 * - ketogenic: about 20–50 g carbohydrate a day, near enough 5–10% of energy,
 *   with fat carrying the bulk of it.
 * - high-protein: protein above the AMDR midpoint, with carbohydrate reduced
 *   to make room rather than fat.
 * - low-fat: fat held near or below the bottom of the AMDR.
 */
const STYLES = {
  balanced: { protein: [10, 35], carbs: [45, 65], fat: [20, 35] },
  "high-protein": { protein: [25, 40], carbs: [25, 50], fat: [20, 35] },
  "low-carb": { protein: [20, 35], carbs: [10, 30], fat: [40, 65] },
  ketogenic: { protein: [15, 25], carbs: [3, 10], fat: [65, 80] },
  "low-fat": { protein: [15, 30], carbs: [55, 75], fat: [10, 20] },
} as const;

export type DietStyle = keyof typeof STYLES;

/**
 * How far outside a style's published band still counts as that style.
 *
 * Guidance bands are round numbers, not cliff edges, and someone told to push
 * their protein a little higher for a few weeks should not find the app has
 * stopped recognising what they are doing.
 */
const GRACE = 0.1;

/**
 * The lowest daily energy a user may set for themselves, by sex. Long-standing
 * clinical floors, and the point at which the editor stops and points at the
 * coach instead.
 */
const FLOOR_CALORIES = { female: 1200, male: 1500 } as const;
const CEILING_CALORIES = 8000;

/**
 * The rail nothing crosses — not the user, not the coach, not the database.
 *
 * The coach is allowed past the floors above when it has looked at someone's
 * history and has a reason, which is the whole point of asking it. It is not
 * allowed to prescribe a starvation diet, so one absolute limit sits under
 * everything and is enforced again by a CHECK constraint on the table.
 */
export const ABSOLUTE_CALORIES = { min: 1000, max: CEILING_CALORIES } as const;

/**
 * The ISSN puts athletes at 1.4–2.0 g/kg, and up to 3.1 g/kg when cutting on
 * high training volume. 3.5 leaves room above the highest published figure
 * without admitting numbers that can only be a typo.
 */
const MAX_PROTEIN_PER_KG = 3.5;
/** For a profile with no weight recorded yet. */
const MAX_PROTEIN_ABSOLUTE = 400;

const MAX_CARBS = 1000;
const MAX_FAT = 400;

/**
 * Adequate intake is 25 g for women and 38 g for men, or 14 g per 1,000 kcal.
 * Warn outside a generous band around that; refuse only the impossible.
 */
const FIBRE_USUAL = { low: 15, high: 60 };
const MAX_FIBRE = 150;

/**
 * A refusal, and whether asking the coach could get past it.
 *
 * Some limits exist because the number is meaningless — macros that contradict
 * the calorie total, a negative gram figure. Others exist because a person
 * typing into a box should not casually set themselves a very low target,
 * while a coach that has read two months of their diary reasonably might. The
 * editor says which kind it has hit rather than just saying no.
 */
export interface TargetError {
  message: string;
  coachCanOverride: boolean;
}

export interface TargetCheck {
  errors: Partial<Record<keyof DailyTargets, TargetError>>;
  warnings: Partial<Record<keyof DailyTargets, string>>;
  /** The recognised way of eating these numbers describe, if any. */
  style: DietStyle | null;
}

/** The lowest and highest daily energy the app will accept for this person. */
export function calorieBounds(profile: UserProfile): { min: number; max: number } {
  return { min: FLOOR_CALORIES[profile.calculationSex], max: CEILING_CALORIES };
}

export function checkTargets(targets: DailyTargets, profile: UserProfile): TargetCheck {
  const errors: TargetCheck["errors"] = {};
  const warnings: TargetCheck["warnings"] = {};

  const bounds = calorieBounds(profile);
  const maxProtein = profile.weightKg > 0
    ? Math.round(profile.weightKg * MAX_PROTEIN_PER_KG)
    : MAX_PROTEIN_ABSOLUTE;

  // 1. Every field has to be a real, non-negative number before anything else
  //    can be said about it.
  for (const field of ["calories", "protein", "carbs", "fat", "fibre"] as const) {
    const value = targets[field];
    if (!Number.isFinite(value) || value < 0) {
      errors[field] = { message: "Enter a number of 0 or more.", coachCanOverride: false };
    }
  }
  if (Object.keys(errors).length > 0) return { errors, warnings, style: null };

  // 2. Hard limits.
  if (targets.calories < bounds.min) {
    errors.calories = {
      message: `${bounds.min.toLocaleString()} kcal is the lowest you can set by hand.`,
      coachCanOverride: true,
    };
  } else if (targets.calories > bounds.max) {
    errors.calories = {
      message: `${bounds.max.toLocaleString()} kcal is the highest you can set by hand.`,
      coachCanOverride: true,
    };
  }

  if (targets.protein > maxProtein) {
    errors.protein = {
      message: `${maxProtein}g is the most you can set by hand at your weight.`,
      coachCanOverride: true,
    };
  }
  if (targets.carbs > MAX_CARBS) {
    errors.carbs = { message: `${MAX_CARBS}g is the most you can set by hand.`, coachCanOverride: true };
  }
  if (targets.fat > MAX_FAT) {
    errors.fat = { message: `${MAX_FAT}g is the most you can set by hand.`, coachCanOverride: true };
  }
  if (targets.fibre > MAX_FIBRE) {
    errors.fibre = { message: `${MAX_FIBRE}g is the most you can set by hand.`, coachCanOverride: true };
  }

  // 3. The macros and the calorie total have to describe the same day.
  const fromMacros = targets.protein * 4 + targets.carbs * 4 + targets.fat * 9;
  if (!errors.calories && targets.calories > 0 && fromMacros === 0) {
    // Every macro at zero is not an unusual split, it is an empty one. The
    // drift check below skipped it, so this used to save with a gentle note.
    errors.calories = {
      message:
        "Those macros add up to nothing. Give protein, carbs and fat figures that match the calories.",
      coachCanOverride: false,
    };
  } else if (!errors.calories && targets.calories > 0 && fromMacros > 0) {
    const drift = Math.abs(fromMacros - targets.calories) / targets.calories;
    if (drift > 0.25) {
      // Not a limit anyone can lift: the two numbers simply disagree.
      errors.calories = {
        message:
          `Those macros come to about ${Math.round(fromMacros).toLocaleString()} kcal, not ` +
          `${Math.round(targets.calories).toLocaleString()}. Adjust one or the other so they agree.`,
        coachCanOverride: false,
      };
    }
  }

  if (Object.keys(errors).length > 0) return { errors, warnings, style: null };

  // 4. Advice, not refusal.
  const style = styleOf(targets);
  if (!style) {
    warnings.carbs =
      "This split does not match a common way of eating. That is fine if it came from a dietitian or trainer — just worth a second look if you typed it yourself.";
  }

  if (targets.fibre < FIBRE_USUAL.low) {
    warnings.fibre = "Most adults are advised 25–38g a day. This is well under that.";
  } else if (targets.fibre > FIBRE_USUAL.high) {
    warnings.fibre = "Well above the usual 25–38g. Build up slowly if this is new.";
  }

  return { errors, warnings, style };
}

/**
 * Which recognised style these numbers describe, or null for none.
 *
 * The styles overlap — every ketogenic diet is also a low-carb one, and a
 * 25/50/25 split sits on the edge of high-protein as well as in the middle of
 * balanced — so matching cannot just take the first band that fits or the
 * answer would depend on the order they happen to be written in. Instead every
 * style that fits is scored on how centrally the numbers sit inside it, and
 * the closest fit wins: 0 is dead centre of a band, 1 is right on its edge.
 */
export function styleOf(targets: DailyTargets): DietStyle | null {
  if (targets.calories <= 0) return null;

  const share = {
    protein: ((targets.protein * 4) / targets.calories) * 100,
    carbs: ((targets.carbs * 4) / targets.calories) * 100,
    fat: ((targets.fat * 9) / targets.calories) * 100,
  };
  const macros = ["protein", "carbs", "fat"] as const;

  let best: { name: DietStyle; score: number } | null = null;

  for (const [name, bands] of Object.entries(STYLES) as Array<[DietStyle, typeof STYLES[DietStyle]]>) {
    let score = 0;
    let fits = true;

    for (const macro of macros) {
      const [low, high] = bands[macro];
      // The grace widens the band proportionally at both ends.
      if (share[macro] < low * (1 - GRACE) || share[macro] > high * (1 + GRACE)) {
        fits = false;
        break;
      }
      const middle = (low + high) / 2;
      const reach = (high - low) / 2 || 1;
      score += Math.abs(share[macro] - middle) / reach;
    }

    if (fits && (!best || score < best.score)) best = { name, score };
  }

  return best?.name ?? null;
}
