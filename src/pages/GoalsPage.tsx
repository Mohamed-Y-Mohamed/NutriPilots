import { Check, Ruler, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, cx, Field, inputClass, Page, PageHeader } from "../components/ui";
import { calculateDailyTargets } from "../lib/nutrition";
import { useAppData } from "../state/AppDataContext";
import type { ActivityLevel, GoalMode, UserProfile } from "../types";

const ACTIVITY_OPTIONS: Array<{ value: ActivityLevel; label: string }> = [
  { value: "sedentary", label: "Mostly sitting" },
  { value: "light", label: "Lightly active" },
  { value: "moderate", label: "Moderately active" },
  { value: "very", label: "Very active" },
  { value: "athlete", label: "Athlete" },
];

const GOAL_OPTIONS: Array<{ value: GoalMode; label: string; detail: string }> = [
  { value: "lose-fast", label: "Lose faster", detail: "About 0.5 kg a week" },
  { value: "lose", label: "Lose steadily", detail: "About 0.3 kg a week" },
  { value: "maintain", label: "Maintain", detail: "Stay where you are" },
  { value: "lean-gain", label: "Lean gain", detail: "Build slowly" },
  { value: "gain", label: "Gain", detail: "Add weight faster" },
];

export function GoalsPage() {
  const { profile, saveUserProfile } = useAppData();
  const [draft, setDraft] = useState<UserProfile>(profile);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The profile arrives after the first render, so the form has to catch up.
  useEffect(() => setDraft(profile), [profile]);

  const targets = useMemo(() => calculateDailyTargets(draft), [draft]);

  const set = <K extends keyof UserProfile>(key: K, value: UserProfile[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveUserProfile({ ...draft, onboarded: true });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save your goals.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Your goals"
        subtitle="These numbers set your daily target. Update them whenever your body or routine changes."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="grid gap-4">
          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight">About you</h2>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Used to estimate the energy your body needs at rest.
                </p>
              </div>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                <Ruler size={17} />
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <input
                  className={inputClass}
                  value={draft.name}
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
                  value={draft.age}
                  onChange={(event) => set("age", Number(event.target.value))}
                />
              </Field>
              <Field
                label="Sex used for calculation"
                hint="The BMR equation needs this; it does not change anything else."
              >
                <select
                  className={inputClass}
                  value={draft.calculationSex}
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
                  value={draft.heightCm}
                  onChange={(event) => set("heightCm", Number(event.target.value))}
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
                  value={draft.weightKg}
                  onChange={(event) => set("weightKg", Number(event.target.value))}
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
                  value={draft.targetWeightKg}
                  onChange={(event) => set("targetWeightKg", Number(event.target.value))}
                />
              </Field>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Activity and goal</h2>
                <p className="mt-1 text-[13px] text-ink-muted">
                  Be honest about activity — overestimating is the usual reason targets feel wrong.
                </p>
              </div>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                <Target size={17} />
              </span>
            </div>

            <Field label="How active are you?">
              <select
                className={inputClass}
                value={draft.activityLevel}
                onChange={(event) => set("activityLevel", event.target.value as ActivityLevel)}
              >
                {ACTIVITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <fieldset className="mt-4">
              <legend className="mb-2 text-xs font-medium text-ink-muted">
                What do you want to do?
              </legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {GOAL_OPTIONS.map((option) => {
                  const active = draft.goalMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => set("goalMode", option.value)}
                      className={cx(
                        "flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors",
                        active
                          ? "border-brand bg-brand-soft"
                          : "border-line bg-surface hover:border-brand/40",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cx(
                          "mt-0.5 size-3.5 shrink-0 rounded-full border-2 transition-colors",
                          active ? "border-[5px] border-brand" : "border-ink-faint",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium">{option.label}</span>
                        <span className="block text-[11px] text-ink-muted">{option.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </Card>
        </div>

        <Card className="p-5 lg:sticky lg:top-24">
          <h2 className="text-sm font-medium text-ink-muted">Your daily target</h2>
          <p className="mt-3 text-4xl font-semibold tabular-nums">{targets.calories}</p>
          <p className="text-[13px] text-ink-muted">kcal per day</p>

          <dl className="mt-5 border-t border-line-soft">
            <TargetRow label="Protein" value={`${targets.protein}g`} colour="var(--color-brand)" />
            <TargetRow label="Carbs" value={`${targets.carbs}g`} colour="var(--color-lime)" />
            <TargetRow label="Fat" value={`${targets.fat}g`} colour="#e5a663" />
            <TargetRow label="Fibre" value={`${targets.fibre}g`} colour="#8fa9d8" />
          </dl>

          <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
            Calculated with the Mifflin&ndash;St Jeor equation and your activity level. It is a
            starting point — adjust after two weeks of real data.
          </p>

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
            disabled={busy}
          >
            {saved ? <Check size={17} /> : null}
            {saved ? "Saved" : busy ? "Saving…" : "Save goals"}
          </Button>
        </Card>
      </div>
    </Page>
  );
}

function TargetRow({
  label,
  value,
  colour,
}: {
  label: string;
  value: string;
  colour: string;
}) {
  return (
    <div className="flex min-h-11 items-center gap-2.5 border-b border-line-soft">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ background: colour }}
      />
      <dt className="flex-1 text-[13px] text-ink-muted">{label}</dt>
      <dd className="text-[13px] font-medium tabular-nums">{value}</dd>
    </div>
  );
}
