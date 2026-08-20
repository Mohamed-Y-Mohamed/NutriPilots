import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  IconButton,
  MacroBar,
  Page,
  PageHeader,
} from "../components/ui";
import { CoachBanner } from "../components/CoachBanner";
import { IntakeTrends } from "../components/IntakeTrends";
import { QuickAdd } from "../components/QuickAdd";
import { addDays, formatDayLabel, localDateKey } from "../lib/dates";
import { useAppData } from "../state/AppDataContext";


/** Marks that the photo-estimate hint has had its one showing. */
const COACH_HINT_SEEN = "nutripilot.coachHintSeen";

export function DashboardPage() {
  const {
    profile,
    hasProfile,
    targets,
    diary,
    totals,
    date,
    setDate,
    error,
  } = useAppData();
  const navigate = useNavigate();

  // First run only. Written the moment it is shown, so a reload settles it.
  const [showCoachHint, setShowCoachHint] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(COACH_HINT_SEEN)) return;
      localStorage.setItem(COACH_HINT_SEEN, "1");
      setShowCoachHint(true);
    } catch {
      // Private browsing with storage blocked. Not worth a banner either way.
    }
  }, []);

  const remaining = targets.calories - totals.calories;
  const percent = Math.min(100, (totals.calories / Math.max(targets.calories, 1)) * 100);
  const isOver = totals.calories > targets.calories;
  const today = localDateKey();
  const firstName = profile.name.trim().split(" ")[0];

  return (
    <Page>
      <PageHeader
        title={firstName ? `Hello, ${firstName}` : "Your day"}
        subtitle="Everything you have logged, and how much room is left."
        actions={
          <Button variant="primary" onClick={() => navigate("/diary")}>
            <Plus size={17} /> Add food
          </Button>
        }
      />

      <div className="mb-5 flex items-center justify-between rounded-xl border border-line bg-surface p-1">
        <IconButton label="Previous day" onClick={() => setDate(addDays(date, -1))}>
          <ChevronLeft size={19} />
        </IconButton>
        <span className="text-sm font-medium">{formatDayLabel(date)}</span>
        <IconButton
          label="Next day"
          disabled={date >= today}
          onClick={() => setDate(addDays(date, 1))}
          className="disabled:opacity-25"
        >
          <ChevronRight size={19} />
        </IconButton>
      </div>

      {error && (
        <Alert tone="error" className="mb-5">
          {error}
        </Alert>
      )}

      {!hasProfile ? (
        <GoalPrompt onStart={() => navigate("/goals")} />
      ) : (
      <div className="grid gap-4">
        <QuickAdd />

        <div className="grid gap-4 md:grid-cols-2">
        <Card className="min-w-0 p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-sm font-medium text-ink-muted">
              {isOver ? "Over your target" : "Energy left"}
            </h2>
            <span className="text-xs text-ink-faint">{Math.round(percent)}% of target</span>
          </div>

          <div className="mt-5 flex items-center gap-6">
            <CalorieRing percent={percent} isOver={isOver} remaining={remaining} />

            <dl className="min-w-0 flex-1 grid gap-3 text-sm">
              <Stat label="Target" value={targets.calories} />
              <Stat label="Eaten" value={Math.round(totals.calories)} />
              <Stat label="Items" value={diary.length} />
            </dl>
          </div>
        </Card>

        <Card className="min-w-0 p-5 sm:p-6">
          <h2 className="text-sm font-medium text-ink-muted">Macros</h2>
          <div className="mt-5 grid gap-4">
            <MacroBar label="Protein" value={totals.protein} target={targets.protein} colour="var(--color-brand)" />
            <MacroBar label="Carbs" value={totals.carbs} target={targets.carbs} colour="var(--color-lime)" />
            <MacroBar label="Fat" value={totals.fat} target={targets.fat} colour="#e5a663" />
            <MacroBar label="Fibre" value={totals.fibre} target={targets.fibre} colour="#8fa9d8" />
          </div>
        </Card>
        </div>

        <IntakeTrends target={targets.calories} today={today} />
      </div>
      )}

      {/* Only for someone who cannot see it anywhere else. Once the goals are
          set it lives inside the food card above, and a first-run hint that
          repeated it would be the same banner twice on one screen. Shown once,
          ever, because a permanent advert for a feature you have already found
          is just something to scroll past. */}
      {!hasProfile && showCoachHint && <CoachBanner className="mt-4" />}

    </Page>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line-soft pb-2.5 last:border-0 last:pb-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function CalorieRing({
  percent,
  isOver,
  remaining,
}: {
  percent: number;
  isOver: boolean;
  remaining: number;
}) {
  return (
    <div
      role="img"
      aria-label={`${Math.round(percent)} percent of your calorie target logged`}
      className="relative grid size-32 shrink-0 place-items-center rounded-full sm:size-36"
      style={{
        background: `conic-gradient(${
          isOver ? "var(--color-danger)" : "var(--color-brand)"
        } ${percent * 3.6}deg, var(--color-muted) 0)`,
      }}
    >
      <div className="absolute inset-2.5 rounded-full bg-surface" />
      <div className="relative grid justify-items-center">
        <strong className="text-2xl font-semibold tabular-nums">
          {Math.abs(Math.round(remaining))}
        </strong>
        <span className="text-[11px] text-ink-muted">{isOver ? "kcal over" : "kcal left"}</span>
      </div>
    </div>
  );
}

function GoalPrompt({ onStart }: { onStart: () => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:gap-6">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand">
          <Target size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight">Let&rsquo;s get you set up</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            Fill in your height, weight, how much you exercise and what you want to achieve, and
            NutriPilot works out the calories and macros that fit you. It takes a minute.
          </p>
        </div>
        <Button variant="primary" size="lg" onClick={onStart} className="shrink-0">
          Let&rsquo;s start <ArrowRight size={17} />
        </Button>
      </div>
    </Card>
  );
}
