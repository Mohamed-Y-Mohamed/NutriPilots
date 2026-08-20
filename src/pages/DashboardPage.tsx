import {
  ArrowRight,
  Bot,
  ChevronLeft,
  ChevronRight,
  Plus,
  Target,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  IconButton,
  MacroBar,
  Page,
  PageHeader,
  Skeleton,
  SkeletonBlock,
} from "../components/ui";
import { IntakeTrends } from "../components/IntakeTrends";
import { QuickAdd } from "../components/QuickAdd";
import { ScrollingText } from "../components/ScrollingText";
import { addDays, formatDayLabel, localDateKey } from "../lib/dates";
import { useAppData } from "../state/AppDataContext";
import { MEALS, type DiaryEntry, type MealName } from "../types";

export function DashboardPage() {
  const {
    profile,
    hasProfile,
    targets,
    diary,
    totals,
    date,
    setDate,
    isLoading,
    error,
    removeDiaryEntry,
  } = useAppData();
  const navigate = useNavigate();

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

      <Link
        to="/coach"
        className="mt-4 flex items-center gap-4 rounded-2xl bg-olive px-5 py-4 transition-colors hover:bg-olive-deep"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-lime">
          <Bot size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-white">Not sure what you just ate?</span>
          <span className="block text-[13px] text-white/55">
            Photograph the plate and the coach estimates it.
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-white/40" />
      </Link>

      <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight">
        {formatDayLabel(date)}&rsquo;s food
      </h2>

      {isLoading ? (
        <DiarySkeleton />
      ) : diary.length === 0 ? (
        <Card>
          <EmptyState
            icon={<UtensilsCrossed size={20} />}
            title="Nothing logged yet"
            text="Search a food, pick a recipe, or photograph your meal — whichever is quickest."
            action={
              <Button variant="primary" onClick={() => navigate("/diary")}>
                <Plus size={16} /> Add your first food
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {MEALS.map((meal) => (
            <MealGroup
              key={meal}
              meal={meal}
              entries={diary.filter((entry) => entry.meal === meal)}
              onRemove={removeDiaryEntry}
              onAdd={() => navigate(`/diary?meal=${meal}`)}
            />
          ))}
        </div>
      )}
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

function MealGroup({
  meal,
  entries,
  onRemove,
  onAdd,
}: {
  meal: MealName;
  entries: DiaryEntry[];
  onRemove: (id: string) => Promise<void>;
  onAdd: () => void;
}) {
  const calories = entries.reduce((sum, entry) => sum + entry.calories, 0);

  return (
    <Card className="min-w-0 px-4 py-1 sm:px-5">
      <div className="flex min-h-14 items-center justify-between gap-3">
        <h3 className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 text-sm font-semibold">
          {meal}
          {entries.length > 0 && (
            <span className="text-xs font-normal text-ink-muted">
              {Math.round(calories)} kcal
            </span>
          )}
        </h3>
        <button
          onClick={onAdd}
          className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-brand hover:bg-brand-soft"
        >
          <Plus size={13} /> Add
        </button>
      </div>

      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex min-h-14 items-center gap-3 border-t border-line-soft py-2"
        >
          <div className="min-w-0 flex-1">
            <ScrollingText className="text-[13px] font-medium" title={entry.name}>
              {entry.name}
            </ScrollingText>
            <p className="truncate text-[11px] text-ink-muted">{describePortion(entry)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[13px] font-medium tabular-nums">
              {Math.round(entry.calories)} kcal
            </p>
            <p className="text-[11px] text-ink-faint tabular-nums">
              P {Math.round(entry.protein)} · C {Math.round(entry.carbs)} · F{" "}
              {Math.round(entry.fat)}
            </p>
          </div>
          <IconButton danger label={`Remove ${entry.name}`} onClick={() => void onRemove(entry.id)}>
            <Trash2 size={16} />
          </IconButton>
        </div>
      ))}
    </Card>
  );
}

function describePortion(entry: DiaryEntry): string {
  if (entry.source === "recipe" || entry.source === "user_recipe") {
    const servings = entry.servings ?? 1;
    return `${formatNumber(servings)} serving${servings === 1 ? "" : "s"}`;
  }
  if (entry.source === "ai_photo") return "Photo estimate";
  return `${formatNumber(entry.amount)}${entry.unit}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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

function DiarySkeleton() {
  return (
    <div role="status" aria-label="Loading your diary" className="grid gap-3">
      {[0, 1, 2].map((group) => (
        <Card key={group} className="px-4 py-4 sm:px-5">
          <div className="mb-3 flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-12" />
          </div>
          <SkeletonBlock lines={2} />
        </Card>
      ))}
    </div>
  );
}
