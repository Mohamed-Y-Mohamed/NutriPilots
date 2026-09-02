import { Check, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { Alert, Button, Card, Field, inputClass } from "./ui";
import { presentError } from "../lib/errors";
import { useAppData } from "../state/AppDataContext";

/**
 * This morning's weight, and what the last few weeks of them add up to.
 *
 * The card leads with the seven-day average rather than the last weigh-in, and
 * never shows a single day's number as a result. That is the whole point of
 * collecting them: one morning on the scales says almost nothing, and an app
 * that reacts to one teaches the user to do the same.
 */
export function WeighInCard() {
  const { weightTrend, calibration, logWeight, date, profile } = useAppData();

  const [editing, setEditing] = useState(false);
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    // Prefill from the running average rather than from nothing: it is the
    // closest guess available and saves typing three of the four characters.
    setWeight(String(weightTrend.currentAverage ?? profile.weightKg ?? ""));
    setWaist("");
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const save = async () => {
    const weightKg = Number(weight);
    if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 500) {
      setError("Enter a weight in kilograms.");
      return;
    }

    const waistCm = waist.trim() === "" ? null : Number(waist);
    if (waistCm !== null && (!Number.isFinite(waistCm) || waistCm < 30 || waistCm > 250)) {
      setError("Enter a waist measurement in centimetres, or leave it blank.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await logWeight({ date, weightKg, waistCm });
      setEditing(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(presentError(reason, "Could not save your weigh-in."));
    } finally {
      setBusy(false);
    }
  };

  const change = weightTrend.weeklyChangeKg;

  return (
    <Card className="animate-stagger p-5" style={{ "--np-i": 2 } as CSSProperties}>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">Weight</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Weigh in most mornings and the app corrects your targets from what actually happens.
          </p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <Scale size={17} />
        </span>
      </div>

      {weightTrend.currentAverage !== null ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-semibold tabular-nums">
            {weightTrend.currentAverage.toFixed(1)}
          </span>
          <span className="text-[13px] text-ink-muted">kg, 7-day average</span>

          {change !== null && change !== 0 && (
            <span
              className={`flex items-center gap-1 text-[13px] font-medium tabular-nums ${
                change < 0 ? "text-[var(--color-macro-protein)]" : "text-ink-muted"
              }`}
            >
              {change < 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />}
              {Math.abs(change).toFixed(2)} kg on last week
            </span>
          )}
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-ink-muted">
          No average yet — three weigh-ins in a week is enough to start one. A single morning on
          the scales moves with salt, sleep and what is still in your gut, so the app waits for a
          few before it says anything.
        </p>
      )}

      {calibration && (
        <Alert tone="info" className="mt-3">
          Over the last {calibration.windowDays} days you have eaten and moved like someone whose
          maintenance is about{" "}
          <strong className="font-medium">
            {calibration.maintenance.toLocaleString()} kcal
          </strong>
          . Your targets now come from that rather than from the equation.
        </Alert>
      )}

      {saved && (
        <Alert tone="success" className="mt-3">
          Weigh-in saved.
        </Alert>
      )}
      {error && !editing && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      {editing ? (
        <div className="animate-fade-in mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Weight (kg)">
              <input
                type="number"
                min="20"
                max="500"
                step="0.1"
                inputMode="decimal"
                autoFocus
                className={inputClass}
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
              />
            </Field>
            <Field label="Waist (cm, optional)" hint="Every few weeks is plenty.">
              <input
                type="number"
                min="30"
                max="250"
                step="0.5"
                inputMode="decimal"
                className={inputClass}
                value={waist}
                onChange={(event) => setWaist(event.target.value)}
              />
            </Field>
          </div>

          {error && (
            <Alert tone="error" className="mt-3">
              {error}
            </Alert>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              className="press"
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save weigh-in"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="press"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="press mt-4" onClick={open}>
          {saved ? <Check size={15} /> : <Scale size={15} />}
          Log today&rsquo;s weight
        </Button>
      )}
    </Card>
  );
}
