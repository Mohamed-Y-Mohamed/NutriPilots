import { LineChart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Alert, Card, cx, Segmented, Skeleton } from "./ui";
import { rangeBounds, summariseTrend, type TrendBucket, type TrendRange } from "../lib/trends";
import { loadDailyTotals } from "../services/analyticsRepository";
import type { DayTotals } from "../types";

const RANGES = [
  { value: "week" as const, label: "Week" },
  { value: "month" as const, label: "Month" },
  { value: "year" as const, label: "Year" },
];

/**
 * Below this there is no trend, only a couple of days. Drawing a chart from two
 * bars invites conclusions the data cannot support.
 */
const ENOUGH_DAYS = 3;

/**
 * How the last week, month or year has actually gone.
 *
 * One bar per day (per month, over a year), and a line marking the calorie
 * target so a bar can be read against something. Every average is per *logged*
 * day and says so: a month logged eight times out of thirty averaged whatever
 * those eight days held, and pretending the other twenty-two were zeroes would
 * turn a patchy month into a fast.
 */
export function IntakeTrends({ target, today }: { target: number; today: string }) {
  const [range, setRange] = useState<TrendRange>("week");
  const [days, setDays] = useState<DayTotals[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const { from, to } = rangeBounds(range, today);
    let live = true;

    setLoading(true);
    setError(null);
    setPicked(null);

    void loadDailyTotals(from, to)
      .then((loaded) => {
        if (live) setDays(loaded);
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : "Could not load your history.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [range, today]);

  const summary = useMemo(
    () => summariseTrend(days, { range, today, target }),
    [days, range, today, target],
  );

  const selected = summary.buckets.find((bucket) => bucket.key === picked) ?? null;
  // Buckets are days for a week or month and months for a year, so counting
  // them keeps the header honest whichever range is showing.
  const bucketsLogged = summary.buckets.filter((bucket) => bucket.logged).length;

  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="text-sm font-medium text-ink-muted">Your intake</h2>
        <span className="text-xs text-ink-faint">
          {bucketsLogged} of {summary.daysInRange}{" "}
          {range === "year" ? "months" : "days"} logged
        </span>
      </div>

      <div className="mt-3">
        <Segmented options={RANGES} value={range} onChange={setRange} ariaLabel="Range" />
      </div>

      {error ? (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      ) : loading ? (
        <div className="mt-5 grid gap-3">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : summary.daysLogged < ENOUGH_DAYS ? (
        <NotEnoughYet range={range} logged={summary.daysLogged} />
      ) : (
        <>
          <Readout summary={summary} selected={selected} range={range} />
          <Bars
            buckets={summary.buckets}
            target={target}
            picked={picked}
            onPick={setPicked}
            range={range}
          />
          <Stats
            average={summary.averageProtein}
            onTarget={summary.daysOnTarget}
            logged={summary.daysLogged}
            total={summary.totalCalories}
            range={range}
          />
        </>
      )}
    </Card>
  );
}

/**
 * The headline, or the detail of whichever bar was tapped. A phone has no
 * hover, so a value has to be reachable by touch rather than by pointing.
 */
function Readout({
  summary,
  selected,
  range,
}: {
  summary: ReturnType<typeof summariseTrend>;
  selected: TrendBucket | null;
  range: TrendRange;
}) {
  if (selected) {
    return (
      <div className="mt-5">
        <p className="text-xs text-ink-muted">{longLabel(selected, range)}</p>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums">
          {selected.logged ? `${Math.round(selected.calories).toLocaleString()} kcal` : "Not logged"}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <p className="text-xs text-ink-muted">Average per logged day</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">
        {Math.round(summary.averageCalories).toLocaleString()}{" "}
        <span className="text-base font-normal text-ink-muted">kcal</span>
      </p>
    </div>
  );
}

function Bars({
  buckets,
  target,
  picked,
  onPick,
  range,
}: {
  buckets: TrendBucket[];
  target: number;
  picked: string | null;
  onPick: (key: string | null) => void;
  range: TrendRange;
}) {
  // Headroom above whichever is taller so the target line never sits on the
  // ceiling, and a record day still has somewhere to go.
  const ceiling = Math.max(target, ...buckets.map((bucket) => bucket.calories)) * 1.12 || 1;
  const targetAt = (target / ceiling) * 100;

  return (
    <figure className="mt-4">
      <div className="relative h-32">
        {/* The target, as something to read the bars against. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 border-t border-dashed border-ink-faint/50"
          style={{ bottom: `${targetAt}%` }}
        />
        <div className="flex h-full items-end gap-[2px]">
          {buckets.map((bucket) => (
            <button
              key={bucket.key}
              type="button"
              onClick={() => onPick(picked === bucket.key ? null : bucket.key)}
              aria-label={`${longLabel(bucket, range)}: ${
                bucket.logged ? `${Math.round(bucket.calories)} kcal` : "nothing logged"
              }`}
              aria-pressed={picked === bucket.key}
              className="group relative flex h-full min-w-0 flex-1 items-end"
            >
              {bucket.logged ? (
                <span
                  className="w-full rounded-t bg-chart transition-opacity group-active:opacity-70"
                  style={{
                    height: `${Math.max((bucket.calories / ceiling) * 100, 2)}%`,
                    // The tapped bar keeps full strength; the rest step back so
                    // the selection is not carried by colour alone.
                    opacity: picked && picked !== bucket.key ? 0.4 : 1,
                  }}
                />
              ) : (
                // A day with no data is not a day at zero. It gets a stub on
                // the baseline rather than a bar of no height, which would be
                // indistinguishable from having eaten nothing.
                <span className="h-[2px] w-full rounded-t bg-line" />
              )}
            </button>
          ))}
        </div>
      </div>

      <Axis buckets={buckets} range={range} />

      <figcaption className="mt-2 text-[11px] text-ink-faint">
        Each bar is a {range === "year" ? "month's average" : "day"}. The dashed line is your{" "}
        {target.toLocaleString()} kcal target; a faint line on the baseline means nothing was
        logged that {range === "year" ? "month" : "day"}.
      </figcaption>
    </figure>
  );
}

/**
 * The scale under the bars.
 *
 * A week and a year are twelve labels at most, so each bar gets its own and
 * they are aligned to their ends at the edges — centring the last one pushes
 * half of it past the chart. Thirty day-labels would be a grey smear, so a
 * month is labelled by date at its start, middle and end instead. Weekday
 * names would say nothing useful across a month anyway.
 */
function Axis({ buckets, range }: { buckets: TrendBucket[]; range: TrendRange }) {
  if (range === "month") {
    const at = [0, Math.floor(buckets.length / 2), buckets.length - 1]
      .map((index) => buckets[index])
      .filter(Boolean);

    return (
      <div className="mt-1.5 flex justify-between text-[9px] text-ink-faint">
        {at.map((bucket) => (
          <span key={bucket.key}>{dayAndMonth(bucket.key)}</span>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex gap-[2px]">
      {buckets.map((bucket, index) => (
        <span
          key={bucket.key}
          className={cx(
            "min-w-0 flex-1 overflow-hidden text-[9px] text-ink-faint",
            index === 0 ? "text-left" : index === buckets.length - 1 ? "text-right" : "text-center",
          )}
        >
          {bucket.label}
        </span>
      ))}
    </div>
  );
}

/** "2026-08-20" as "20 Aug". */
function dayAndMonth(key: string): string {
  const [, month, day] = key.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

function Stats({
  average,
  onTarget,
  logged,
  total,
  range,
}: {
  average: number;
  onTarget: number;
  logged: number;
  total: number;
  range: TrendRange;
}) {
  return (
    <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-center">
      <Stat label="Protein/day" value={`${Math.round(average)}g`} />
      <Stat label="Within target" value={`${onTarget}/${logged}`} />
      <Stat
        label={range === "week" ? "This week" : range === "month" ? "This month" : "This year"}
        value={`${compact(total)} kcal`}
      />
    </dl>
  );
}

/** 840, 15.2k, 712k — a year of eating does not fit in a third of a phone. */
function compact(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.round(value));
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dd className="text-[15px] font-semibold tabular-nums">{value}</dd>
      <dt className="truncate text-[11px] text-ink-muted">{label}</dt>
    </div>
  );
}

function NotEnoughYet({ range, logged }: { range: TrendRange; logged: number }) {
  return (
    <div className="mt-5 flex flex-col items-center rounded-xl bg-muted px-4 py-6 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-surface text-ink-faint">
        <LineChart size={19} />
      </span>
      <p className="mt-3 text-[13px] font-medium">Not enough to show a trend yet</p>
      <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-ink-muted">
        {logged === 0
          ? `Nothing is logged in the last ${range === "week" ? "week" : range === "month" ? "month" : "year"}.`
          : `Only ${logged} ${logged === 1 ? "day" : "days"} logged so far.`}{" "}
        Log a few more days and the pattern will be worth looking at.
      </p>
    </div>
  );
}

/** "Thu 20 Aug" for a day, "Aug 2026" for a month. */
function longLabel(bucket: TrendBucket, range: TrendRange): string {
  if (range === "year") {
    const [year] = bucket.key.split("-");
    return `${bucket.label} ${year}`;
  }
  const [, month, day] = bucket.key.split("-");
  return `${bucket.label} ${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
