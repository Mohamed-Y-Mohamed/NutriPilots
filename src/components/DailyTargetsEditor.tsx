import { Pencil, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { Alert, Button, cx } from "./ui";
import { rescaleTargets } from "../lib/nutrition";
import { checkTargets, type TargetCheck } from "../lib/targetRanges";
import { useAppData } from "../state/AppDataContext";
import type { DailyTargets } from "../types";

type Field = keyof DailyTargets;

const FIELDS: Array<{ key: Field; label: string; unit: string }> = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
  { key: "fibre", label: "Fibre", unit: "g" },
];

/** The draft while it is being typed — strings, so a field can be mid-edit. */
type Draft = Record<Field, string>;

function draftFrom(targets: DailyTargets): Draft {
  return {
    calories: String(Math.round(targets.calories)),
    protein: String(Math.round(targets.protein)),
    carbs: String(Math.round(targets.carbs)),
    fat: String(Math.round(targets.fat)),
    fibre: String(Math.round(targets.fibre)),
  };
}

function numbersFrom(draft: Draft): DailyTargets {
  const read = (value: string) => (value.trim() === "" ? NaN : Number(value));
  return {
    calories: read(draft.calories),
    protein: read(draft.protein),
    carbs: read(draft.carbs),
    fat: read(draft.fat),
    fibre: read(draft.fibre),
  };
}

/**
 * The daily figures, and the means to change them.
 *
 * Three things can set them: the formula from the body stats, the coach after
 * looking at what has actually been eaten, and the person themselves — because
 * plenty of people are following a plan from a dietitian or a trainer, and an
 * app that cannot be told about it is an app they will stop using.
 */
export function DailyTargetsEditor() {
  const { profile, targets, calculatedTargets, saveTargets } = useAppData();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(targets));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const values = numbersFrom(draft);
  const check: TargetCheck = checkTargets(values, profile);
  const blocked = Object.keys(check.errors).length > 0;

  const open = () => {
    setDraft(draftFrom(targets));
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  /**
   * Changing the energy rescales the macros with it; changing a macro leaves
   * the rest alone.
   *
   * Dropping to 1,800 kcal while the macros still describe 2,400 is not a
   * plan, it is two. But someone deliberately moving protein up and carbs down
   * at the same energy is doing exactly what this editor is for, so that is
   * left untouched.
   */
  const edit = (field: Field, raw: string) => {
    // Whole numbers only. Anything else is a slip, not an intention.
    const cleaned = raw.replace(/[^\d]/g, "");

    if (field !== "calories") {
      setDraft((current) => ({ ...current, [field]: cleaned }));
      return;
    }

    setDraft((current) => {
      const before = numbersFrom(current);
      const wanted = cleaned.trim() === "" ? NaN : Number(cleaned);

      // Mid-typing, or nothing to scale from: change the one field and wait.
      if (!Number.isFinite(wanted) || !Number.isFinite(before.calories) || before.calories <= 0) {
        return { ...current, calories: cleaned };
      }

      const scaled = rescaleTargets(before, wanted);
      return { ...draftFrom(scaled), calories: cleaned };
    });
  };

  const save = async () => {
    if (busy || blocked) return;
    setBusy(true);
    setError(null);
    try {
      await saveTargets(
        {
          calories: Math.round(values.calories),
          protein: Math.round(values.protein),
          carbs: Math.round(values.carbs),
          fat: Math.round(values.fat),
          fibre: Math.round(values.fibre),
        },
        "manual",
      );
      setEditing(false);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save your targets.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveTargets(null, "manual");
      setEditing(false);
      setSaved(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reset your targets.");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="min-w-0">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          {FIELDS.map(({ key, label, unit }) => (
            <div key={key} className="min-w-0">
              <dd className="text-[17px] font-semibold tabular-nums">
                {Math.round(targets[key]).toLocaleString()}
                <span className="ml-1 text-[12px] font-normal text-ink-muted">{unit}</span>
              </dd>
              <dt className="truncate text-[12px] text-ink-muted">{label}</dt>
            </div>
          ))}
        </dl>

        <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">{provenance()}</p>

        {saved && (
          <Alert tone="success" className="mt-3">
            Targets updated. Today&rsquo;s ring and macro bars now use them.
          </Alert>
        )}
        {error && (
          <Alert tone="error" className="mt-3">
            {error}
          </Alert>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={open}>
            <Pencil size={15} /> Edit targets
          </Button>
          {profile.targetOverride && (
            <Button size="sm" variant="ghost" onClick={() => void reset()} disabled={busy}>
              <RotateCcw size={15} /> Use calculated
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3">
        {FIELDS.map(({ key, label, unit }) => (
          <NumberField
            key={key}
            label={label}
            unit={unit}
            value={draft[key]}
            onChange={(raw) => edit(key, raw)}
            error={check.errors[key]?.message}
            coachCanOverride={check.errors[key]?.coachCanOverride ?? false}
            warning={check.warnings[key]}
          />
        ))}
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
        Changing calories moves the macros with it. Change a macro on its own and the rest stay
        where they are.
        {check.style && (
          <>
            {" "}
            This looks like a <strong className="font-medium text-ink">{check.style}</strong>{" "}
            split.
          </>
        )}
      </p>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy || blocked}>
          {busy ? "Saving…" : "Save targets"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );

  function provenance(): string {
    if (!profile.targetOverride) {
      return "Worked out from your height, weight, age, activity and goal.";
    }
    const when = profile.targetsSetAt
      ? new Date(profile.targetsSetAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })
      : null;
    const who = profile.targetsSource === "coach" ? "Set by the coach" : "Set by you";
    const calculated = `The calculated figure is ${Math.round(calculatedTargets.calories).toLocaleString()} kcal.`;
    return when ? `${who} on ${when}. ${calculated}` : `${who}. ${calculated}`;
  }
}

function NumberField({
  label,
  unit,
  value,
  onChange,
  error,
  coachCanOverride,
  warning,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (raw: string) => void;
  error?: string;
  coachCanOverride: boolean;
  warning?: string;
}) {
  return (
    <label className="grid min-w-0 content-start gap-1">
      <span className="text-[11px] font-medium text-ink-muted">
        {label} <span className="text-ink-faint">({unit})</span>
      </span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        className={cx(
          // 16px so iOS does not zoom the page when the field takes focus.
          "min-h-11 w-full min-w-0 rounded-xl border bg-surface px-3 text-[16px] font-semibold tabular-nums outline-none",
          error ? "border-danger" : "border-line focus:border-brand",
        )}
      />

      {/* The hint only appears once someone has actually gone past a limit,
          which is the only moment it is useful rather than noise. */}
      {error && (
        <span className="text-[11px] leading-relaxed text-danger">
          {error}
          {coachCanOverride && (
            <span className="mt-0.5 flex items-start gap-1 text-ink-muted">
              <Sparkles size={11} className="mt-[3px] shrink-0" />
              <span>Ask the coach — it can set a figure beyond this limit for you.</span>
            </span>
          )}
        </span>
      )}

      {!error && warning && (
        <span className="text-[11px] leading-relaxed text-warn">{warning}</span>
      )}
    </label>
  );
}
