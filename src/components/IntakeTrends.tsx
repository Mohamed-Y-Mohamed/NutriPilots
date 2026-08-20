import { LineChart } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Card, cx, Segmented, Skeleton } from "./ui";
import {
  MONTHS,
  rangeBounds,
  summariseTrend,
  type TrendBucket,
  type TrendRange,
  type TrendSummary,
} from "../lib/trends";
import { loadDailyTotals, MissingMigrationError } from "../services/analyticsRepository";
import { useAppData } from "../state/AppDataContext";
import type { DayTotals } from "../types";

const RANGES = [
  { value: "week" as const, label: "Week" },
  { value: "month" as const, label: "Month" },
  { value: "year" as const, label: "Year" },
];

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
  // Today's bar is drawn from the same rows the diary shows, so adding or
  // deleting food has to send it back for them. Without this a deleted meal
  // stays in the chart and the averages until the range is switched. The array
  // identity is the signal: AppDataContext only ever replaces it, never mutates.
  const { diary } = useAppData();

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
        if (!live) return;
        // Nothing is wrong with their data, so this is stated plainly rather
        // than as a failure they might think they caused.
        if (reason instanceof MissingMigrationError) {
          setError(reason.message);
          return;
        }
        setError(reason instanceof Error ? reason.message : "Could not load your history.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [range, today, diary]);

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
        <Alert tone="warn" className="mt-4">
          {error}
        </Alert>
      ) : loading ? (
        <div className="mt-5 grid gap-3">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : summary.daysLogged === 0 ? (
        <NothingYet range={range} />
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
          <Averages summary={summary} range={range} />
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
  summary: TrendSummary;
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

  const plot = useRef<HTMLDivElement>(null);

  /**
   * Whichever bar the finger is over, by position rather than by hit-testing a
   * bar.
   *
   * A month is thirty-one bars in about 300 points of width — eight points
   * each, a fifth of a usable target. Tapping one meant landing on whichever
   * neighbour was nearest and being shown a plausible, wrong day with nothing
   * to signal the miss. Reading the x offset instead makes every bar equally
   * reachable however many there are.
   */
  const pickAt = (clientX: number) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || buckets.length === 0) return;
    const ratio = (clientX - box.left) / box.width;
    const index = Math.min(buckets.length - 1, Math.max(0, Math.floor(ratio * buckets.length)));
    onPick(buckets[index].key);
  };

  const step = (by: number) => {
    const at = buckets.findIndex((bucket) => bucket.key === picked);
    const next = at === -1 ? buckets.length - 1 : at + by;
    if (next >= 0 && next < buckets.length) onPick(buckets[next].key);
  };

  return (
    <figure className="mt-4">
      {/* Ahead of the chart, not after it: read out, this is the sentence that
          says what the dashed line and the faint stubs mean, and it was
          arriving last. */}
      <figcaption id="trend-caption" className="mb-2 text-[11px] text-ink-faint">
        Each bar is a {range === "year" ? "month's average" : "day"}. The dashed line is your{" "}
        {target.toLocaleString()} kcal target; a faint line on the baseline means nothing was
        logged that {range === "year" ? "month" : "day"}. Tap the chart to read a single one.
      </figcaption>

      {/*
        One control, not one per bar — the same choice CalorieRing already makes.
        A screen reader gets a summary and arrow keys; a thumb gets the whole
        plot rather than an eight-point sliver.
      */}
      <div
        ref={plot}
        role="img"
        tabIndex={0}
        aria-describedby="trend-caption"
        aria-label={summarise(buckets, range)}
        onPointerDown={(event) => pickAt(event.clientX)}
        onPointerMove={(event) => {
          if (event.buttons === 1) pickAt(event.clientX);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") step(-1);
          else if (event.key === "ArrowRight") step(1);
          else if (event.key === "Escape") onPick(null);
          else return;
          event.preventDefault();
        }}
        className="relative h-32 touch-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {/* The target, as something to read the bars against. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 border-t border-dashed border-ink-faint/50"
          style={{ bottom: `${targetAt}%` }}
        />
        <div className="flex h-full items-end gap-[2px]">
          {buckets.map((bucket) => (
            <span key={bucket.key} className="flex h-full min-w-0 flex-1 items-end">
              {bucket.logged ? (
                <span
                  className="w-full rounded-t bg-chart"
                  style={{
                    height: `${Math.max((bucket.calories / ceiling) * 100, 2)}%`,
                    // The chosen bar keeps full strength; the rest step back so
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
            </span>
          ))}
        </div>
      </div>

      <Axis buckets={buckets} range={range} />
    </figure>
  );
}

/** One sentence for a reader who cannot see thirty bars. */
function summarise(buckets: TrendBucket[], range: TrendRange): string {
  const logged = buckets.filter((bucket) => bucket.logged);
  const unit = range === "year" ? "month" : "day";
  if (logged.length === 0) return `Intake chart: nothing logged in this ${range}.`;

  const values = logged.map((bucket) => bucket.calories);
  const average = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const highest = logged[values.indexOf(Math.max(...values))];
  const lowest = logged[values.indexOf(Math.min(...values))];

  return (
    `Intake chart, one bar per ${unit}. ${logged.length} of ${buckets.length} logged, ` +
    `averaging ${average.toLocaleString()} kcal. Highest ${longLabel(highest, range)} at ` +
    `${Math.round(highest.calories).toLocaleString()}, lowest ${longLabel(lowest, range)} at ` +
    `${Math.round(lowest.calories).toLocaleString()}. Use the arrow keys to read each ${unit}.`
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
      <div aria-hidden="true" className="mt-1.5 flex justify-between text-[10px] text-ink-faint">
        {at.map((bucket) => (
          <span key={bucket.key}>{dayAndMonth(bucket.key)}</span>
        ))}
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="mt-1.5 flex gap-[2px]">
      {buckets.map((bucket, index) => (
        <span
          key={bucket.key}
          className={cx(
            "min-w-0 flex-1 overflow-hidden text-[10px] text-ink-faint",
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

/**
 * What an average day looked like over the range, in words rather than bars.
 *
 * The chart shows the shape; this says the figure. Both are per *logged* day
 * and the count is right there, so a fortnight logged four times reads as four
 * days at whatever they held — not as a fortnight of near-starvation.
 */
function Averages({
  summary,
  range,
}: {
  summary: TrendSummary;
  range: TrendRange;
}) {
  const macros = [
    { label: "protein", value: summary.averageProtein },
    { label: "carbs", value: summary.averageCarbs },
    { label: "fat", value: summary.averageFat },
  ];

  return (
    <dl className="mt-4 grid gap-2.5 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <dt className="text-[12px] text-ink-muted">Average daily intake</dt>
        <dd className="text-[15px] font-semibold tabular-nums">
          {Math.round(summary.averageCalories).toLocaleString()}
          <span className="ml-1 text-[12px] font-normal text-ink-muted">kcal</span>
        </dd>
        <dd className="ml-auto text-[11px] text-ink-faint">
          over {summary.daysLogged} logged {summary.daysLogged === 1 ? "day" : "days"}
        </dd>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
        <dt className="sr-only">Average daily macros</dt>
        {macros.map((macro) => (
          <dd key={macro.label} className="text-ink-muted">
            {macro.label}{" "}
            <strong className="font-semibold tabular-nums text-ink">
              {Math.round(macro.value)}g
            </strong>
          </dd>
        ))}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <dd>
          Within target on{" "}
          <strong className="font-semibold tabular-nums text-ink">
            {summary.daysOnTarget} of {summary.daysLogged}
          </strong>
        </dd>
        <dd>
          This {range}{" "}
          <strong className="font-semibold tabular-nums text-ink">
            {compact(summary.totalCalories)} kcal
          </strong>
        </dd>
      </div>
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

/** Only when there is genuinely nothing — one logged day already draws. */
function NothingYet({ range }: { range: TrendRange }) {
  return (
    <div className="mt-5 flex flex-col items-center rounded-xl bg-muted px-4 py-6 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-surface text-ink-faint">
        <LineChart size={19} />
      </span>
      <p className="mt-3 text-[13px] font-medium">Nothing logged this {range}</p>
      <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-ink-muted">
        Log a meal and it will show up here from the very first day.
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
  return `${bucket.label} ${dayAndMonth(bucket.key)}`;
}

