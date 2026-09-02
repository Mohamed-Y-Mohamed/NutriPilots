import type { DailyTargets, GoalMode, TrainingExperience, UserProfile } from "../types";

/**
 * What a body needs, and what a goal does to it.
 *
 * Kept apart from nutrition.ts, which is about food: this file never sees an
 * ingredient. It answers one question — given a person and what they want,
 * how much should they eat — and it answers it as a range, because every
 * equation in here predicts energy expenditure rather than measuring it.
 *
 * The pipeline is: resting energy, then activity, then the goal, then protein,
 * then fat, then carbohydrate takes what is left. Each step is separately
 * testable and each carries the reasoning for its constants.
 */

// ---------------------------------------------------------------------------
// Resting energy
// ---------------------------------------------------------------------------

/**
 * Mifflin–St Jeor, on actual body weight.
 *
 * The default for adults, and validated on populations that included obese
 * subjects, which is why actual weight is used here rather than an adjusted
 * one. Adjusted weight has a job in this file, but it is protein, not RMR.
 */
export function mifflinStJeor(profile: {
  weightKg: number;
  heightCm: number;
  age: number;
  calculationSex: "female" | "male";
}): number {
  const sexConstant = profile.calculationSex === "male" ? 5 : -161;
  return 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + sexConstant;
}

/**
 * Katch–McArdle, which works from lean mass instead of total weight.
 *
 * Only usable when a body-fat figure exists, and body-fat figures from smart
 * scales are not precise — so this never replaces Mifflin. It is a second
 * opinion, and where the two disagree the disagreement becomes the range the
 * user is shown rather than being averaged away into false confidence.
 */
export function katchMcArdle(weightKg: number, bodyFatPercent: number): number {
  const leanMassKg = weightKg * (1 - bodyFatPercent / 100);
  return 370 + 21.6 * leanMassKg;
}

export function bmiOf(weightKg: number, heightCm: number): number {
  if (heightCm <= 0) return 0;
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/**
 * Daily movement, before any structured training.
 *
 * Steps are the honest floor under an activity estimate: someone who trains
 * three times a week and then sits for the other fifteen waking hours is not a
 * moderately active person, and asking them to self-describe reliably produces
 * one. These bands are read off step counts alone — training is added
 * separately below, so an hour in the gym cannot be counted twice.
 */
const STEP_FACTORS: Array<{ upTo: number; factor: number }> = [
  { upTo: 4000, factor: 1.15 },
  { upTo: 6000, factor: 1.25 },
  { upTo: 8000, factor: 1.33 },
  { upTo: 10000, factor: 1.42 },
  { upTo: 13000, factor: 1.5 },
  { upTo: Infinity, factor: 1.6 },
];

/**
 * The fallback when nobody has given a step count: the user's own answer to
 * "how much do you exercise". Deliberately at the bottom of each published
 * band, because self-reported activity runs high and an overstated maintenance
 * figure is the single commonest reason a target quietly stops working.
 */
const SELF_REPORTED_FACTORS = {
  sedentary: 1.2,
  light: 1.35,
  moderate: 1.5,
  very: 1.65,
  athlete: 1.8,
} as const;

/**
 * What a week's training adds, expressed as a share of resting energy.
 *
 * Derived from what a session actually costs rather than picked to feel right:
 * a resting metabolism near 2,000 kcal, a resistance session near 300 kcal and
 * a cardio session near 400 kcal make one session a week worth roughly
 * 300/7/2000 ≈ 0.02 and 400/7/2000 ≈ 0.028 of RMR per day. The cap stops
 * somebody claiming fourteen sessions into a multiplier no human sustains.
 */
const RESISTANCE_PER_SESSION = 0.02;
const CARDIO_PER_SESSION = 0.028;
const MAX_TRAINING_BONUS = 0.18;

/** How wide the maintenance range is, either side of the point estimate. */
const FACTOR_UNCERTAINTY = 0.07;

export interface ActivityInput {
  activityLevel: keyof typeof SELF_REPORTED_FACTORS;
  /** Average daily steps, or 0/absent when the user has not said. */
  stepsPerDay?: number | null;
  resistanceSessions?: number | null;
  cardioSessions?: number | null;
}

/**
 * The multiplier applied to resting energy, and whether real movement data
 * went into it.
 *
 * Steps and training sessions are complementary, not competing: the app asks
 * about exercise, and steps describe everything that is not exercise. Adding
 * them is the whole point. The self-reported band is only consulted when there
 * are no steps to work from.
 */
export function activityFactor(input: ActivityInput): { factor: number; fromSteps: boolean } {
  const steps = Number(input.stepsPerDay);
  const hasSteps = Number.isFinite(steps) && steps > 0;

  const base = hasSteps
    ? (STEP_FACTORS.find((band) => steps < band.upTo) ?? STEP_FACTORS[STEP_FACTORS.length - 1]).factor
    : SELF_REPORTED_FACTORS[input.activityLevel];

  const resistance = Math.max(0, Number(input.resistanceSessions) || 0);
  const cardio = Math.max(0, Number(input.cardioSessions) || 0);
  const bonus = Math.min(
    MAX_TRAINING_BONUS,
    resistance * RESISTANCE_PER_SESSION + cardio * CARDIO_PER_SESSION,
  );

  // Without steps the self-reported band already answered "how much do you
  // exercise", so adding the sessions on top would charge for them twice.
  return { factor: hasSteps ? base + bonus : base, fromSteps: hasSteps };
}

// ---------------------------------------------------------------------------
// Reference weight
// ---------------------------------------------------------------------------

/**
 * Where prediction equations stop being quotable to the nearest hundred.
 * Reported error in class II–III obesity runs to ±250–315 kcal/day.
 */
const SEVERE_OBESITY_BMI = 40;
const SEVERE_OBESITY_RMR_ERROR = 300;

/** The BMI an adjusted reference weight is anchored to. */
const REFERENCE_BMI = 22.5;
/** Above this BMI, actual weight stops being a sensible basis for protein. */
const ADJUSTMENT_THRESHOLD_BMI = 30;
/**
 * The share of excess weight that still counts. The standard clinical
 * adjustment, and it reproduces the worked example in the guidance: a 180 kg
 * adult lands on a reference near 100 kg rather than on 350 g of protein.
 */
const EXCESS_WEIGHT_SHARE = 0.25;

/**
 * The weight that protein and fat targets are calculated against.
 *
 * For most people this is simply what they weigh. Multiplying 2.2 g/kg by
 * 180 kg gives 396 g of protein, which is not a target anybody needs or will
 * eat — fat mass does not have a protein requirement. Above a BMI of 30 the
 * excess is discounted rather than ignored, so the figure still rises with
 * body size without rising in proportion to it.
 */
export function referenceWeightKg(weightKg: number, heightCm: number): number {
  const bmi = bmiOf(weightKg, heightCm);
  if (bmi <= ADJUSTMENT_THRESHOLD_BMI || heightCm <= 0) return weightKg;

  const heightM = heightCm / 100;
  const anchor = REFERENCE_BMI * heightM * heightM;
  return anchor + EXCESS_WEIGHT_SHARE * (weightKg - anchor);
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface GoalStrategy {
  label: string;
  /** What the goal does to maintenance, as a proportion. Negative is a deficit. */
  adjustment: [number, number];
  /** Grams of protein per kg of reference weight. */
  proteinPerKg: [number, number];
  /**
   * Expected weekly change as a percentage of body weight. Null where the
   * scale is not the measure of success — recomposition, chiefly.
   */
  weeklyPercent: [number, number] | null;
  /** Whether the goal is not achievable without lifting something. */
  needsResistanceTraining: boolean;
  detail: string;
}

/**
 * The nine ways this app will change somebody's intake.
 *
 * Every adjustment is a percentage of maintenance, never a flat number of
 * calories. A flat 500 kcal cut is a third of a small woman's intake and an
 * eighth of a large man's — the same setting meaning two completely different
 * diets depending on who picked it. Percentages are how published guidance
 * states these bands and the only way one setting means one thing.
 */
export const GOAL_STRATEGIES: Record<GoalMode, GoalStrategy> = {
  maintain: {
    label: "Maintain",
    adjustment: [0, 0],
    proteinPerKg: [1.2, 1.6],
    weeklyPercent: [0, 0],
    needsResistanceTraining: false,
    detail: "Stay where you are",
  },
  "lose-slow": {
    label: "Lose slowly",
    adjustment: [-0.1, -0.05],
    proteinPerKg: [1.6, 2.0],
    weeklyPercent: [-0.5, -0.25],
    needsResistanceTraining: false,
    detail: "Easiest to stick to, best for training",
  },
  lose: {
    label: "Lose steadily",
    adjustment: [-0.2, -0.1],
    proteinPerKg: [1.6, 2.2],
    weeklyPercent: [-0.75, -0.5],
    needsResistanceTraining: false,
    detail: "The usual choice",
  },
  "lose-fast": {
    label: "Lose faster",
    adjustment: [-0.25, -0.2],
    proteinPerKg: [1.8, 2.2],
    weeklyPercent: [-1, -0.5],
    needsResistanceTraining: false,
    detail: "Harder to hold. Protein and weights matter more",
  },
  ripping: {
    label: "Ripping",
    adjustment: [-0.25, -0.2],
    proteinPerKg: [2.0, 2.4],
    weeklyPercent: [-1, -0.5],
    needsResistanceTraining: true,
    detail: "A hard cut built to keep muscle. Weights are not optional",
  },
  recomp: {
    label: "Recomposition",
    adjustment: [-0.08, 0],
    proteinPerKg: [1.8, 2.2],
    weeklyPercent: null,
    needsResistanceTraining: true,
    detail: "Lose fat and build muscle. Judged on the tape, not the scale",
  },
  "lean-gain": {
    label: "Lean gain",
    adjustment: [0.05, 0.1],
    proteinPerKg: [1.6, 2.2],
    weeklyPercent: [0.15, 0.35],
    needsResistanceTraining: true,
    detail: "Build slowly with the least fat",
  },
  bulk: {
    label: "Bulking",
    adjustment: [0.1, 0.15],
    proteinPerKg: [1.6, 2.2],
    weeklyPercent: [0.25, 0.5],
    needsResistanceTraining: true,
    detail: "Faster muscle gain, some fat with it",
  },
  gain: {
    label: "Gain weight",
    adjustment: [0.1, 0.15],
    proteinPerKg: [1.4, 1.8],
    weeklyPercent: [0.25, 0.5],
    needsResistanceTraining: false,
    detail: "Put weight on, however it comes",
  },
};

/**
 * Expected weekly change, narrowed by training experience where that is what
 * decides it.
 *
 * Muscle is built at a rate the body sets, not the fridge: a beginner can add
 * around 0.25–0.5% of body weight a week and an advanced lifter perhaps half
 * of that, and eating past it produces fat rather than a faster result. Fat
 * loss does not work that way round, so experience leaves it alone.
 */
export function expectedWeeklyPercent(
  goal: GoalMode,
  experience: TrainingExperience | null,
): [number, number] | null {
  const base = GOAL_STRATEGIES[goal].weeklyPercent;
  if (!base || base[1] <= 0 || !experience) return base;

  const byExperience: Record<TrainingExperience, [number, number]> = {
    beginner: [0.25, 0.5],
    intermediate: [0.15, 0.35],
    advanced: [0.1, 0.25],
  };
  const range = byExperience[experience];

  // Never widen past what the goal itself allows: a beginner choosing lean gain
  // is still choosing the slower of the two settings.
  return [Math.max(base[0], range[0]), Math.min(base[1], range[1])];
}

// ---------------------------------------------------------------------------
// Safety rails
// ---------------------------------------------------------------------------

/**
 * The lowest daily energy the calculator will hand somebody unprompted. Where a
 * percentage deficit would land below this, the deficit is reduced instead —
 * the alternative is silently clamping the calorie figure and leaving the user
 * looking at a "25% deficit" label that is no longer true.
 */
const FLOOR_CALORIES = { female: 1200, male: 1500 } as const;

/**
 * The most a surplus may add in absolute terms. Fifteen percent of a very large
 * maintenance figure is more food than anybody needs to grow, and past this
 * point the extra reliably arrives as fat.
 */
const MAX_SURPLUS_KCAL = 500;

// ---------------------------------------------------------------------------
// The estimate
// ---------------------------------------------------------------------------

export type EstimateConfidence = "low" | "medium" | "high";

export interface EnergyEstimate {
  bmi: number;
  /** Resting energy, and the spread between equations where two were usable. */
  rmr: number;
  rmrRange: [number, number];
  activityFactor: number;
  /** Estimated maintenance, as a point figure and as the honest range. */
  maintenance: number;
  maintenanceRange: [number, number];
  /** Whether maintenance came from an equation or from the user's own results. */
  basis: "equation" | "observed";
  confidence: EstimateConfidence;
  /** What protein and fat were calculated against. Differs from weight above BMI 30. */
  referenceWeightKg: number;
  /** Steps were supplied, so the activity figure rests on something real. */
  fromSteps: boolean;
}

/**
 * Maintenance for this person, before any goal is applied.
 *
 * `observedMaintenance` is the figure worked back from what they have actually
 * eaten and what the scale has actually done. When it exists it wins outright,
 * because a measurement of this person beats a prediction about people like
 * them — that is the whole reason the app asks them to weigh in.
 */
export function estimateEnergy(
  profile: UserProfile,
  observedMaintenance?: number | null,
): EnergyEstimate {
  const bmi = bmiOf(profile.weightKg, profile.heightCm);
  const mifflin = mifflinStJeor(profile);

  const bodyFat = Number(profile.bodyFatPercent);
  const hasBodyFat = Number.isFinite(bodyFat) && bodyFat > 3 && bodyFat < 70;
  const katch = hasBodyFat ? katchMcArdle(profile.weightKg, bodyFat) : null;

  // Mifflin stays the point estimate even when Katch–McArdle is available: a
  // body-fat reading from a smart scale is not a measurement, and letting one
  // move the headline figure would dress a guess up as precision. What it does
  // earn is a wider range, which is the honest response to two equations
  // disagreeing.
  const rmr = mifflin;
  let rmrRange: [number, number] = katch
    ? [Math.min(mifflin, katch), Math.max(mifflin, katch)]
    : [mifflin, mifflin];

  /**
   * Above a BMI of 40 the equation stops being reliable enough to quote
   * tightly. Validation work puts the error at roughly ±250–315 kcal/day in
   * class II–III obesity — larger than the difference between two goal
   * settings — and the literature thins out almost entirely past a BMI of 50.
   * Widening the band is the honest response; narrowing the advice is not.
   */
  if (bmi >= SEVERE_OBESITY_BMI) {
    rmrRange = [
      Math.min(rmrRange[0], mifflin - SEVERE_OBESITY_RMR_ERROR),
      Math.max(rmrRange[1], mifflin + SEVERE_OBESITY_RMR_ERROR),
    ];
  }

  const { factor, fromSteps } = activityFactor(profile);

  const equationMaintenance = rmr * factor;
  const equationRange: [number, number] = [
    rmrRange[0] * (factor - FACTOR_UNCERTAINTY),
    rmrRange[1] * (factor + FACTOR_UNCERTAINTY),
  ];

  const observed = Number(observedMaintenance);
  const hasObserved = Number.isFinite(observed) && observed > 0;

  return {
    bmi: round1(bmi),
    rmr: Math.round(rmr),
    rmrRange: [Math.round(rmrRange[0]), Math.round(rmrRange[1])],
    activityFactor: Math.round(factor * 100) / 100,
    maintenance: Math.round(hasObserved ? observed : equationMaintenance),
    // Observed maintenance is measured rather than predicted, so its band is
    // tighter — but it is still built on logged food, which is never exact.
    maintenanceRange: hasObserved
      ? [Math.round(observed * 0.95), Math.round(observed * 1.05)]
      : [Math.round(equationRange[0]), Math.round(equationRange[1])],
    basis: hasObserved ? "observed" : "equation",
    confidence: confidenceOf(profile, hasObserved, fromSteps, bmi),
    referenceWeightKg: round1(referenceWeightKg(profile.weightKg, profile.heightCm)),
    fromSteps,
  };
}

/**
 * How much the estimate deserves to be trusted.
 *
 * Not decoration: it decides how wide a range the user is shown, and a wide
 * range is the correct answer when the inputs are guesses. Real results beat
 * real movement data, which beats a self-description.
 */
function confidenceOf(
  profile: UserProfile,
  hasObserved: boolean,
  fromSteps: boolean,
  bmi: number,
): EstimateConfidence {
  if (hasObserved) return "high";
  // Prediction equations lose accuracy at the extremes of body size, whatever
  // else is known about the person.
  if (bmi >= 40 || bmi < 16) return "low";
  if (fromSteps) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface TargetPlan {
  targets: DailyTargets;
  estimate: EnergyEstimate;
  /** Calories above or below maintenance. Negative is a deficit. */
  adjustmentKcal: number;
  /** The same thing as a share of maintenance, after any rail was applied. */
  adjustmentPercent: number;
  /** Protein and fat as the ranges they really are, not single grams. */
  proteinRange: [number, number];
  fatRange: [number, number];
  carbsRange: [number, number];
  /** Expected weekly weight change in kg, or null when the scale is not the measure. */
  weeklyChangeKg: [number, number] | null;
  /** Set when the deficit was cut back to keep intake above the floor. */
  reducedForFloor: boolean;
}

/**
 * The ceiling on grams per kilogram once the reference weight is an adjusted
 * one. Clinical guidance for obesity puts protein at 1.0–1.5 g/kg of adjusted
 * weight and states that nothing reliable supports exceeding 2.0.
 */
const MAX_PROTEIN_PER_ADJUSTED_KG = 2.0;

/** Fat below this share of energy starts costing more than it saves. */
const MIN_FAT_SHARE = 0.2;
const MAX_FAT_SHARE = 0.35;
/** Grams of fat per kg of reference weight, as the other way of setting a floor. */
const FAT_PER_KG = 0.8;

/** UK guidance is 30 g. Larger appetites need more, but not without limit. */
const FIBRE_FLOOR = 30;
const FIBRE_CEILING = 45;
const FIBRE_PER_1000_KCAL = 14;

/**
 * A full daily plan: calories from the goal, protein from body size, fat from
 * whichever floor binds, and carbohydrate takes what is left.
 *
 * The order matters and is not arbitrary. Protein and fat have requirements
 * that do not shrink just because somebody chose a bigger deficit, so they are
 * set first and carbohydrate absorbs the difference. Setting macros as fixed
 * percentages of calories — which is what this app used to do — quietly cuts
 * protein exactly when a deficit makes it most important.
 */
export function buildTargetPlan(
  profile: UserProfile,
  observedMaintenance?: number | null,
): TargetPlan {
  const estimate = estimateEnergy(profile, observedMaintenance);
  const strategy = GOAL_STRATEGIES[profile.goalMode] ?? GOAL_STRATEGIES.maintain;
  const maintenance = estimate.maintenance;

  // The midpoint of the published band. The band itself is what the user is
  // shown; a single number is what the ring on the Today screen needs.
  const share = (strategy.adjustment[0] + strategy.adjustment[1]) / 2;
  let adjustment = maintenance * share;

  // A surplus that is a sensible percentage for an average body becomes a great
  // deal of food on a large one.
  if (adjustment > MAX_SURPLUS_KCAL) adjustment = MAX_SURPLUS_KCAL;

  const floor = FLOOR_CALORIES[profile.calculationSex];
  let reducedForFloor = false;
  if (maintenance + adjustment < floor) {
    // Reduce the deficit rather than clamping the total, so the percentage the
    // user is told still describes the plan they were given.
    adjustment = floor - maintenance;
    reducedForFloor = true;
  }

  const calories = Math.round(Math.max(floor, maintenance + adjustment));
  const reference = estimate.referenceWeightKg;

  /**
   * Where the reference weight is an adjusted one, the grams-per-kg figure is
   * capped lower than it would be for a lean athlete.
   *
   * The two are not the same currency. 2.2–2.4 g/kg of *actual* weight is well
   * supported in trained, lean people; the same multiplier against an
   * *adjusted* weight is a different and much less evidenced claim, and
   * clinical guidance for obesity states plainly that nothing reliable
   * supports going past 2.0 g/kg of adjusted weight. So the band is clamped
   * rather than the reference being quietly inflated to hide the difference.
   */
  const adjusted = reference < profile.weightKg;
  const perKg: [number, number] = adjusted
    ? [
      Math.min(strategy.proteinPerKg[0], MAX_PROTEIN_PER_ADJUSTED_KG),
      Math.min(strategy.proteinPerKg[1], MAX_PROTEIN_PER_ADJUSTED_KG),
    ]
    : strategy.proteinPerKg;

  const proteinRange: [number, number] = [
    Math.round(reference * perKg[0]),
    Math.round(reference * perKg[1]),
  ];

  const fatFloor = Math.max(reference * FAT_PER_KG, (calories * MIN_FAT_SHARE) / 9);
  const fatCeiling = (calories * MAX_FAT_SHARE) / 9;
  const fatRange: [number, number] = [
    Math.round(Math.min(fatFloor, fatCeiling)),
    Math.round(Math.max(fatFloor, fatCeiling)),
  ];

  const { protein, fat, carbs } = fitMacros(calories, proteinRange, fatRange);

  const weeklyPercent = expectedWeeklyPercent(profile.goalMode, profile.trainingExperience);

  return {
    targets: {
      calories,
      protein,
      fat,
      carbs,
      fibre: fibreFor(calories),
    },
    estimate,
    adjustmentKcal: Math.round(adjustment),
    adjustmentPercent: maintenance > 0 ? Math.round((adjustment / maintenance) * 1000) / 10 : 0,
    proteinRange,
    fatRange,
    carbsRange: [
      Math.max(0, Math.round((calories - proteinRange[1] * 4 - fatRange[1] * 9) / 4)),
      Math.max(0, Math.round((calories - proteinRange[0] * 4 - fatRange[0] * 9) / 4)),
    ],
    weeklyChangeKg: weeklyPercent
      ? [
        round2((weeklyPercent[0] / 100) * profile.weightKg),
        round2((weeklyPercent[1] / 100) * profile.weightKg),
      ]
      : null,
    reducedForFloor,
  };
}

/**
 * Fits protein, fat and carbohydrate into a calorie total that may not have
 * room for the middle of every range.
 *
 * A hard cut on a large frame can leave protein and fat at their midpoints
 * already accounting for the whole day, which would hand the user negative
 * carbohydrate. Rather than let that happen, each is walked down towards the
 * bottom of its own band — fat first, since its range is wider and its floor
 * is the one published guidance states most loosely — and carbohydrate is
 * whatever survives.
 */
function fitMacros(
  calories: number,
  proteinRange: [number, number],
  fatRange: [number, number],
): { protein: number; fat: number; carbs: number } {
  let protein = Math.round((proteinRange[0] + proteinRange[1]) / 2);
  let fat = Math.round((fatRange[0] + fatRange[1]) / 2);

  const spare = () => calories - protein * 4 - fat * 9;

  // A day with no carbohydrate at all is a diet the app should not invent for
  // somebody, so leave room for a minimum before touching anything else.
  const MIN_CARB_KCAL = 0;

  if (spare() < MIN_CARB_KCAL) {
    fat = Math.max(fatRange[0], fat + Math.floor((spare() - MIN_CARB_KCAL) / 9));
  }
  if (spare() < MIN_CARB_KCAL) {
    protein = Math.max(proteinRange[0], protein + Math.floor((spare() - MIN_CARB_KCAL) / 4));
  }
  if (spare() < MIN_CARB_KCAL) {
    // Both are at their published floors and the day still does not balance.
    // Protein is the one that matters most here, so fat gives way further —
    // but never below 15% of energy, which is where deficiency starts.
    fat = Math.max(Math.round((calories * 0.15) / 9), fat + Math.floor(spare() / 9));
  }

  return { protein, fat, carbs: Math.max(0, Math.round(spare() / 4)) };
}

function fibreFor(calories: number): number {
  const scaled = Math.round((calories / 1000) * FIBRE_PER_1000_KCAL);
  return Math.min(FIBRE_CEILING, Math.max(FIBRE_FLOOR, scaled));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
