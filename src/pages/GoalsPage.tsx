import { Check, Footprints, Pill, Ruler, Target } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Card,
  cx,
  Field,
  inputClass,
  Page,
  PageHeader,
} from "../components/ui";
import { buildTargetPlan, GOAL_STRATEGIES } from "../lib/energy";
import { useAppData } from "../state/AppDataContext";
import type { ActivityLevel, GoalMode, TrainingExperience, UserProfile } from "../types";

import { presentError } from "../lib/errors";
const ACTIVITY_OPTIONS: Array<{ value: ActivityLevel; label: string; detail: string }> = [
  { value: "sedentary", label: "Mostly sitting", detail: "Little or no exercise" },
  { value: "light", label: "Lightly active", detail: "1–2 sessions a week" },
  { value: "moderate", label: "Moderately active", detail: "3–4 sessions a week" },
  { value: "very", label: "Very active", detail: "5–6 sessions a week" },
  { value: "athlete", label: "Athlete", detail: "Daily hard training" },
];

/**
 * Read from the strategies themselves rather than restated here, so a label on
 * this screen can never drift from the numbers behind the button. The order is
 * the one people think in: hold, lose, reshape, build.
 */
const GOAL_ORDER: GoalMode[] = [
  "maintain",
  "lose-slow",
  "lose",
  "lose-fast",
  "ripping",
  "recomp",
  "lean-gain",
  "bulk",
  "gain",
];

const GOAL_OPTIONS = GOAL_ORDER.map((value) => ({
  value,
  label: GOAL_STRATEGIES[value].label,
  detail: GOAL_STRATEGIES[value].detail,
}));

const EXPERIENCE_OPTIONS: Array<{ value: TrainingExperience; label: string }> = [
  { value: "beginner", label: "Under a year" },
  { value: "intermediate", label: "One to three years" },
  { value: "advanced", label: "Three years or more" },
];

/** Numeric fields are strings so a new user sees empty boxes, not invented values. */
interface FormState {
  name: string;
  age: string;
  calculationSex: UserProfile["calculationSex"];
  heightCm: string;
  weightKg: string;
  targetWeightKg: string;
  activityLevel: ActivityLevel | "";
  goalMode: GoalMode | "";
  stepsPerDay: string;
  resistanceSessions: string;
  cardioSessions: string;
  bodyFatPercent: string;
  waistCm: string;
  trainingExperience: TrainingExperience | "";
  onMedication: boolean;
}

const EMPTY: FormState = {
  name: "",
  age: "",
  calculationSex: "female",
  heightCm: "",
  weightKg: "",
  targetWeightKg: "",
  activityLevel: "",
  goalMode: "",
  stepsPerDay: "",
  resistanceSessions: "",
  cardioSessions: "",
  bodyFatPercent: "",
  waistCm: "",
  trainingExperience: "",
  onMedication: false,
};

export function GoalsPage() {
  const { profile, hasProfile, saveUserProfile } = useAppData();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only pre-fill once the user genuinely has saved goals before.
  useEffect(() => {
    if (!hasProfile) return;
    setForm({
      name: profile.name,
      age: String(profile.age),
      calculationSex: profile.calculationSex,
      heightCm: String(profile.heightCm),
      weightKg: String(profile.weightKg),
      targetWeightKg: String(profile.targetWeightKg),
      activityLevel: profile.activityLevel,
      goalMode: profile.goalMode,
      stepsPerDay: optionalText(profile.stepsPerDay),
      resistanceSessions: optionalText(profile.resistanceSessions),
      cardioSessions: optionalText(profile.cardioSessions),
      bodyFatPercent: optionalText(profile.bodyFatPercent),
      waistCm: optionalText(profile.waistCm),
      trainingExperience: profile.trainingExperience ?? "",
      onMedication: profile.onMedication,
    });
  }, [hasProfile, profile]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const missing = requiredMissing(form);
  const complete = missing.length === 0;

  // The preview only appears once there is enough to calculate honestly.
  const plan = useMemo(
    () => (complete ? buildTargetPlan(toProfile(form, profile.theme)) : null),
    [complete, form, profile.theme],
  );
  const targets = plan?.targets ?? null;

  const save = async () => {
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveUserProfile(toProfile(form, profile.theme));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(presentError(reason, "Could not save your goals."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title={hasProfile ? "Your goals" : "Set your goals"}
        subtitle={
          hasProfile
            ? "These numbers set your daily target. Update them whenever your body or routine changes."
            : "A few details and NutriPilot works out the calories and macros that fit you."
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="grid gap-4">
          <Card className="p-5 sm:p-6">
            <SectionHeading
              icon={<Ruler size={17} />}
              title="About you"
              detail="Used to estimate the energy your body needs at rest."
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name (optional)">
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  placeholder="Alex"
                />
              </Field>
              <Field label="Age">
                <input
                  type="number"
                  min="13"
                  max="120"
                  inputMode="numeric"
                  className={inputClass}
                  value={form.age}
                  onChange={(event) => set("age", event.target.value)}
                  placeholder="30"
                />
              </Field>
              <Field
                label="Sex used for calculation"
                hint="The equation needs this; it changes nothing else."
              >
                <select
                  className={inputClass}
                  value={form.calculationSex}
                  onChange={(event) =>
                    set("calculationSex", event.target.value as UserProfile["calculationSex"])
                  }
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </Field>
              <Field label="Height (cm)">
                <input
                  type="number"
                  min="100"
                  max="250"
                  inputMode="numeric"
                  className={inputClass}
                  value={form.heightCm}
                  onChange={(event) => set("heightCm", event.target.value)}
                  placeholder="175"
                />
              </Field>
              <Field label="Current weight (kg)">
                <input
                  type="number"
                  min="30"
                  max="400"
                  step="0.1"
                  inputMode="decimal"
                  className={inputClass}
                  value={form.weightKg}
                  onChange={(event) => set("weightKg", event.target.value)}
                  placeholder="72"
                />
              </Field>
              <Field label="Target weight (kg)">
                <input
                  type="number"
                  min="30"
                  max="400"
                  step="0.1"
                  inputMode="decimal"
                  className={inputClass}
                  value={form.targetWeightKg}
                  onChange={(event) => set("targetWeightKg", event.target.value)}
                  placeholder="68"
                />
              </Field>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionHeading
              icon={<Target size={17} />}
              title="Activity and goal"
              detail="Be honest about activity — overestimating is the usual reason targets feel wrong."
            />

            <fieldset>
              <legend className="mb-2 text-xs font-medium text-ink-muted">
                How much do you exercise each week?
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {ACTIVITY_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.value}
                    active={form.activityLevel === option.value}
                    label={option.label}
                    detail={option.detail}
                    // Tapping the chosen one again clears it, so a mis-tap is
                    // undoable rather than permanent.
                    onClick={() =>
                      set("activityLevel", form.activityLevel === option.value ? "" : option.value)
                    }
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-5">
              <legend className="mb-2 text-xs font-medium text-ink-muted">
                What do you want to do?
              </legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {GOAL_OPTIONS.map((option) => (
                  <ChoiceCard
                    key={option.value}
                    active={form.goalMode === option.value}
                    label={option.label}
                    detail={option.detail}
                    onClick={() =>
                      set("goalMode", form.goalMode === option.value ? "" : option.value)
                    }
                  />
                ))}
              </div>
            </fieldset>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionHeading
              icon={<Footprints size={17} />}
              title="Movement and training"
              detail="All optional — but steps are the single biggest thing that stops a target being too generous."
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Average daily steps"
                hint="Your phone or watch will have a weekly average."
              >
                <input
                  type="number"
                  min="0"
                  max="60000"
                  inputMode="numeric"
                  className={inputClass}
                  value={form.stepsPerDay}
                  onChange={(event) => set("stepsPerDay", event.target.value)}
                  placeholder="7000"
                />
              </Field>
              <Field label="Training experience" hint="How long you have lifted regularly.">
                <select
                  className={inputClass}
                  value={form.trainingExperience}
                  onChange={(event) =>
                    set("trainingExperience", event.target.value as TrainingExperience | "")
                  }
                >
                  <option value="">Prefer not to say</option>
                  {EXPERIENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Weights sessions a week">
                <input
                  type="number"
                  min="0"
                  max="14"
                  inputMode="numeric"
                  className={inputClass}
                  value={form.resistanceSessions}
                  onChange={(event) => set("resistanceSessions", event.target.value)}
                  placeholder="3"
                />
              </Field>
              <Field label="Cardio sessions a week">
                <input
                  type="number"
                  min="0"
                  max="14"
                  inputMode="numeric"
                  className={inputClass}
                  value={form.cardioSessions}
                  onChange={(event) => set("cardioSessions", event.target.value)}
                  placeholder="2"
                />
              </Field>
              <Field label="Body fat % (optional)" hint="Only if you have a real measurement.">
                <input
                  type="number"
                  min="3"
                  max="70"
                  step="0.1"
                  inputMode="decimal"
                  className={inputClass}
                  value={form.bodyFatPercent}
                  onChange={(event) => set("bodyFatPercent", event.target.value)}
                  placeholder="28"
                />
              </Field>
              <Field label="Waist (cm, optional)" hint="Shows progress the scale can miss.">
                <input
                  type="number"
                  min="40"
                  max="200"
                  step="0.5"
                  inputMode="decimal"
                  className={inputClass}
                  value={form.waistCm}
                  onChange={(event) => set("waistCm", event.target.value)}
                  placeholder="94"
                />
              </Field>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <SectionHeading
              icon={<Pill size={17} />}
              title="Medication"
              detail="One question, and it changes what these numbers can claim."
            />

            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
                checked={form.onMedication}
                onChange={(event) => set("onMedication", event.target.checked)}
              />
              <span className="text-[13px] leading-relaxed">
                I take medication that could affect my appetite, weight or energy levels
              </span>
            </label>

            {form.onMedication && (
              <Alert tone="info" className="mt-3">
                Noted — and worth being straight with you: these figures are worked out from your
                body and your activity only. They do not account for what your medication does to
                appetite, weight or the energy you burn. Show them to your doctor or pharmacist and
                ask whether this target still fits your goal while you are taking it.
              </Alert>
            )}
          </Card>
        </div>

        <Card className="p-5 lg:sticky lg:top-24">
          <h2 className="text-sm font-medium text-ink-muted">Your daily target</h2>

          {targets && plan ? (
            <>
              <p className="mt-3 text-4xl font-semibold tabular-nums">{targets.calories}</p>
              <p className="text-[13px] text-ink-muted">kcal per day</p>

              <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                Maintenance is estimated around{" "}
                <span className="font-medium tabular-nums">
                  {plan.estimate.maintenanceRange[0].toLocaleString()}–
                  {plan.estimate.maintenanceRange[1].toLocaleString()}
                </span>{" "}
                kcal.{" "}
                {plan.adjustmentKcal === 0
                  ? "This target sits at maintenance."
                  : `This is ${Math.abs(plan.adjustmentPercent)}% ${
                    plan.adjustmentKcal < 0 ? "below" : "above"
                  } it.`}
              </p>

              <dl className="mt-5 border-t border-line-soft">
                <TargetRow label="Protein" value={`${targets.protein}g`} colour="var(--color-macro-protein)" />
                <TargetRow label="Carbs" value={`${targets.carbs}g`} colour="var(--color-macro-carbs)" />
                <TargetRow label="Fat" value={`${targets.fat}g`} colour="var(--color-macro-fat)" />
                <TargetRow label="Fibre" value={`${targets.fibre}g`} colour="var(--color-macro-fibre)" />
              </dl>

              {plan.weeklyChangeKg && plan.weeklyChangeKg[1] !== 0 && (
                <p className="mt-3 text-[12px] text-ink-muted">
                  Expect roughly{" "}
                  <span className="font-medium tabular-nums">
                    {Math.abs(plan.weeklyChangeKg[0])}–{Math.abs(plan.weeklyChangeKg[1])} kg
                  </span>{" "}
                  a week {plan.weeklyChangeKg[1] < 0 ? "down" : "on"}.
                </p>
              )}

              {!plan.weeklyChangeKg && (
                <p className="mt-3 text-[12px] text-ink-muted">
                  The scale is not the measure here — judge this one on the waist tape, your
                  strength in the gym and how clothes fit.
                </p>
              )}

              {plan.reducedForFloor && (
                <Alert tone="warn" className="mt-3">
                  A full deficit at your size would drop below what anyone should eat unsupervised,
                  so it has been eased back to {targets.calories.toLocaleString()} kcal.
                </Alert>
              )}

              {GOAL_STRATEGIES[toProfile(form, profile.theme).goalMode].needsResistanceTraining && (
                <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                  This goal only works with weights. Without resistance training you will lose or
                  fail to build the muscle it is designed to protect.
                </p>
              )}

              <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
                {plan.estimate.fromSteps
                  ? "Worked out from Mifflin–St Jeor, your step count and your training."
                  : "Worked out from Mifflin–St Jeor and your stated activity level. Adding your daily steps would tighten this considerably."}{" "}
                It is an estimate, not a measurement — log your weight for a fortnight and the app
                will recalculate it from what actually happens.
              </p>
            </>
          ) : (
            <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
              Fill in the fields on the left and your personalised target appears here.
              {missing.length > 0 && (
                <span className="mt-2 block text-ink-faint">Still needed: {missing.join(", ")}.</span>
              )}
            </p>
          )}

          {error && (
            <Alert tone="error" className="mt-3">
              {error}
            </Alert>
          )}

          <Button
            variant="primary"
            size="lg"
            full
            className="mt-4"
            onClick={() => void save()}
            disabled={busy || !complete}
          >
            {saved ? <Check size={17} /> : null}
            {saved ? "Saved" : busy ? "Saving…" : hasProfile ? "Save goals" : "Save my goals"}
          </Button>
        </Card>
      </div>
    </Page>
  );
}

function SectionHeading({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-[13px] text-ink-muted">{detail}</p>
      </div>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
        {icon}
      </span>
    </div>
  );
}

function ChoiceCard({
  active,
  label,
  detail,
  onClick,
}: {
  active: boolean;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
        active ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand/40",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "mt-0.5 size-3.5 shrink-0 rounded-full border-2 transition-all",
          active ? "border-[5px] border-brand" : "border-ink-faint",
        )}
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-[11px] text-ink-muted">{detail}</span>
      </span>
    </button>
  );
}

function TargetRow({ label, value, colour }: { label: string; value: string; colour: string }) {
  return (
    <div className="flex min-h-11 items-center gap-2.5 border-b border-line-soft">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: colour }} />
      <dt className="flex-1 text-[13px] text-ink-muted">{label}</dt>
      <dd className="text-[13px] font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function requiredMissing(form: FormState): string[] {
  const missing: string[] = [];
  if (!inRange(form.age, 13, 120)) missing.push("age");
  if (!inRange(form.heightCm, 100, 250)) missing.push("height");
  if (!inRange(form.weightKg, 30, 400)) missing.push("current weight");
  if (!inRange(form.targetWeightKg, 30, 400)) missing.push("target weight");
  if (!form.activityLevel) missing.push("activity level");
  if (!form.goalMode) missing.push("goal");
  return missing;
}

function inRange(value: string, min: number, max: number): boolean {
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) && number >= min && number <= max;
}

/**
 * An empty box means "I did not say", not "zero". The calculator behaves
 * differently for the two — a missing step count falls back to the activity
 * band, where a zero would be taken at face value.
 */
function optionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalText(value: number | null): string {
  return value === null || value === undefined ? "" : String(value);
}

function toProfile(form: FormState, theme: UserProfile["theme"]): UserProfile {
  return {
    name: form.name.trim(),
    age: Number(form.age),
    calculationSex: form.calculationSex,
    heightCm: Number(form.heightCm),
    weightKg: Number(form.weightKg),
    targetWeightKg: Number(form.targetWeightKg),
    activityLevel: (form.activityLevel || "moderate") as ActivityLevel,
    goalMode: (form.goalMode || "maintain") as GoalMode,
    theme,
    onboarded: true,
    stepsPerDay: optionalNumber(form.stepsPerDay),
    resistanceSessions: optionalNumber(form.resistanceSessions),
    cardioSessions: optionalNumber(form.cardioSessions),
    bodyFatPercent: optionalNumber(form.bodyFatPercent),
    waistCm: optionalNumber(form.waistCm),
    trainingExperience: form.trainingExperience || null,
    onMedication: form.onMedication,
    // Finishing the wizard is a request to work the targets out again, so any
    // figure the coach or the user had set by hand gives way to the fresh
    // calculation. Settings is where a bespoke plan is kept and reset.
    targetOverride: null,
    targetsSource: null,
    targetsSetAt: null,
  };
}
