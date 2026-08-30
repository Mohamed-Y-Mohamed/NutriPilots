import { Check, Ruler, Target } from "lucide-react";
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
import { calculateDailyTargets } from "../lib/nutrition";
import { useAppData } from "../state/AppDataContext";
import type { ActivityLevel, GoalMode, UserProfile } from "../types";

import { presentError } from "../lib/errors";
const ACTIVITY_OPTIONS: Array<{ value: ActivityLevel; label: string; detail: string }> = [
  { value: "sedentary", label: "Mostly sitting", detail: "Little or no exercise" },
  { value: "light", label: "Lightly active", detail: "1–2 sessions a week" },
  { value: "moderate", label: "Moderately active", detail: "3–4 sessions a week" },
  { value: "very", label: "Very active", detail: "5–6 sessions a week" },
  { value: "athlete", label: "Athlete", detail: "Daily hard training" },
];

const GOAL_OPTIONS: Array<{ value: GoalMode; label: string; detail: string }> = [
  { value: "lose-fast", label: "Lose faster", detail: "About 0.5 kg a week" },
  { value: "lose", label: "Lose steadily", detail: "About 0.3 kg a week" },
  { value: "maintain", label: "Maintain", detail: "Stay where you are" },
  { value: "lean-gain", label: "Lean gain", detail: "Build slowly" },
  { value: "gain", label: "Gain", detail: "Add weight faster" },
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
    });
  }, [hasProfile, profile]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const missing = requiredMissing(form);
  const complete = missing.length === 0;

  // The preview only appears once there is enough to calculate honestly.
  const targets = useMemo(
    () => (complete ? calculateDailyTargets(toProfile(form, profile.theme)) : null),
    [complete, form, profile.theme],
  );

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
        </div>

        <Card className="p-5 lg:sticky lg:top-24">
          <h2 className="text-sm font-medium text-ink-muted">Your daily target</h2>

          {targets ? (
            <>
              <p className="mt-3 text-4xl font-semibold tabular-nums">{targets.calories}</p>
              <p className="text-[13px] text-ink-muted">kcal per day</p>

              <dl className="mt-5 border-t border-line-soft">
                <TargetRow label="Protein" value={`${targets.protein}g`} colour="var(--color-macro-protein)" />
                <TargetRow label="Carbs" value={`${targets.carbs}g`} colour="var(--color-macro-carbs)" />
                <TargetRow label="Fat" value={`${targets.fat}g`} colour="var(--color-macro-fat)" />
                <TargetRow label="Fibre" value={`${targets.fibre}g`} colour="var(--color-macro-fibre)" />
              </dl>

              <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
                Calculated with the Mifflin&ndash;St Jeor equation and your activity level. It is a
                starting point — adjust after two weeks of real data.
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
    // Finishing the wizard is a request to work the targets out again, so any
    // figure the coach or the user had set by hand gives way to the fresh
    // calculation. Settings is where a bespoke plan is kept and reset.
    targetOverride: null,
    targetsSource: null,
    targetsSetAt: null,
  };
}
