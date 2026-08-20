import { Check, Dumbbell, Target } from "lucide-react";
import { useState } from "react";
import { Alert, Button } from "./ui";
import { useAppData } from "../state/AppDataContext";
import type { CoachPlan, DailyTargets } from "../types";

/**
 * New daily targets the coach has proposed, and the one tap that adopts them.
 *
 * The coach never changes a target on its own, for the same reason it cannot
 * write to the diary: a number someone measures themselves against every day
 * should not move without them agreeing to it. Until Apply is tapped this card
 * is a suggestion on a screen and nothing more.
 */
export function PlanCard({
  plan,
  applied,
  onApplied,
}: {
  plan: CoachPlan;
  applied: boolean;
  onApplied: () => void;
}) {
  const { targets, saveTargets } = useAppData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveTargets(plan.targets, "coach");
      onApplied();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update your targets.");
    } finally {
      setBusy(false);
    }
  };

  if (applied) {
    return (
      <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-[12px] font-medium text-ok">
        <Check size={14} /> Your daily targets have been updated
      </p>
    );
  }

  return (
    <div className="animate-fade-in mt-3 min-w-0 border-t border-line pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
        <Target size={13} className="shrink-0" />
        Suggested daily targets
      </p>

      <div className="grid min-w-0 gap-1.5 rounded-xl bg-surface p-2.5">
        <Row label="Calories" from={targets.calories} to={plan.targets.calories} unit="kcal" />
        <Row label="Protein" from={targets.protein} to={plan.targets.protein} unit="g" />
        <Row label="Carbs" from={targets.carbs} to={plan.targets.carbs} unit="g" />
        <Row label="Fat" from={targets.fat} to={plan.targets.fat} unit="g" />
        <Row label="Fibre" from={targets.fibre} to={plan.targets.fibre} unit="g" />
      </div>

      {plan.reason && (
        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-muted">{plan.reason}</p>
      )}

      {plan.exercise && (
        <div className="mt-2.5 flex gap-2 rounded-xl bg-muted p-2.5">
          <Dumbbell size={14} className="mt-0.5 shrink-0 text-ink-faint" />
          <p className="min-w-0 text-[12px] leading-relaxed text-ink-muted">{plan.exercise}</p>
        </div>
      )}

      {error && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => void apply()} disabled={busy}>
          <Check size={15} /> {busy ? "Applying…" : "Apply these targets"}
        </Button>
        <span className="text-[11px] text-ink-faint">You can change them again in Settings.</span>
      </div>
    </div>
  );
}

/**
 * One target, before and after. The old figure stays visible because "2,100
 * kcal" means nothing on its own — whether that is a cut or a rise is the
 * entire point, and it should not need working out.
 */
function Row({
  label,
  from,
  to,
  unit,
}: {
  label: keyof DailyTargets | string;
  from: number;
  to: number;
  unit: string;
}) {
  const change = Math.round(to) - Math.round(from);

  return (
    <div className="flex min-w-0 items-baseline gap-2 text-[12px]">
      <span className="min-w-0 flex-1 truncate text-ink-muted">{label}</span>
      <span className="shrink-0 tabular-nums text-ink-faint line-through">
        {Math.round(from).toLocaleString()}
      </span>
      <span className="shrink-0 font-semibold tabular-nums">
        {Math.round(to).toLocaleString()}
        <span className="ml-0.5 font-normal text-ink-muted">{unit}</span>
      </span>
      <span
        className={`w-12 shrink-0 text-right tabular-nums ${
          change === 0 ? "text-ink-faint" : "text-ink-muted"
        }`}
      >
        {change === 0 ? "—" : `${change > 0 ? "+" : "−"}${Math.abs(change).toLocaleString()}`}
      </span>
    </div>
  );
}
