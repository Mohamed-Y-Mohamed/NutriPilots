import { Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { ScrollingText } from "./ScrollingText";
import { Button, Card, IconButton, Segmented } from "./ui";
import { useAppData } from "../state/AppDataContext";
import { MEALS, type DiaryEntry, type MealName } from "../types";

/** "All" is not a meal, so the filter is its own type. */
type Filter = "All" | MealName;

const FILTER_OPTIONS: Array<{ value: Filter; label: string }> = [
  { value: "All", label: "All" },
  ...MEALS.map((meal) => ({ value: meal as Filter, label: meal })),
];

/**
 * What has been eaten today, by meal.
 *
 * Opens on All, because the usual question is "how has today gone" rather than
 * "what was in lunch". Picking a meal narrows it to that one.
 */
export function TodayFood({ onAddTo }: { onAddTo: (meal: MealName) => void }) {
  const { diary, removeDiaryEntry } = useAppData();
  const [filter, setFilter] = useState<Filter>("All");

  const groups = MEALS.filter((meal) => filter === "All" || meal === filter).map((meal) => ({
    meal,
    entries: diary.filter((entry) => entry.meal === meal),
  }));

  // A meal with nothing in it is worth showing when it is the one asked for —
  // "did I log breakfast?" deserves an answer — but four empty headings under
  // All is just noise.
  const shown = filter === "All" ? groups.filter((group) => group.entries.length > 0) : groups;

  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <h2 className="text-sm font-medium text-ink-muted">Your food today</h2>

      <div className="mt-3">
        <Segmented
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
          ariaLabel="Meal"
          // Five options where the others have four: "Breakfast" is cut off at
          // full size on a narrow phone.
          compact
        />
      </div>

      {shown.length === 0 ? (
        <Empty onAdd={() => onAddTo(mealForNow())} />
      ) : (
        <div className="mt-4 grid min-w-0 gap-4">
          {shown.map((group) => (
            <MealGroup
              key={group.meal}
              meal={group.meal}
              entries={group.entries}
              onAdd={() => onAddTo(group.meal)}
              onRemove={removeDiaryEntry}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function MealGroup({
  meal,
  entries,
  onAdd,
  onRemove,
}: {
  meal: MealName;
  entries: DiaryEntry[];
  onAdd: () => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const calories = entries.reduce((sum, entry) => sum + entry.calories, 0);

  return (
    <section className="min-w-0">
      <div className="flex min-w-0 items-center gap-2 border-b border-line-soft pb-1.5">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{meal}</h3>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
          {Math.round(calories)} kcal
        </span>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add to ${meal.toLowerCase()}`}
          className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-brand transition-colors hover:bg-brand-soft"
        >
          <Plus size={13} /> Add
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="py-2.5 text-[12px] text-ink-faint">Nothing logged.</p>
      ) : (
        <ul className="grid min-w-0">
          {entries.map((entry, index) => (
            <li
              key={entry.id}
              // Arriving in order rather than all at once. Capped at six steps
              // so a long day's diary still finishes appearing quickly — past
              // about a quarter of a second this stops reading as polish and
              // starts reading as the list being slow to load.
              style={{ "--np-i": Math.min(index, 6) } as CSSProperties}
              className="animate-stagger flex min-h-12 min-w-0 items-center gap-2.5 border-b border-line-soft py-1.5 last:border-0"
            >
              <span className="min-w-0 flex-1">
                <ScrollingText className="text-[13px] font-medium" title={entry.name}>
                  {entry.name}
                </ScrollingText>
                <span className="block truncate text-[11px] tabular-nums text-ink-faint">
                  {describePortion(entry)} &middot; P {Math.round(entry.protein)} &middot; C{" "}
                  {Math.round(entry.carbs)} &middot; F {Math.round(entry.fat)}
                </span>
              </span>
              <span className="shrink-0 text-[12px] font-medium tabular-nums text-ink-muted">
                {Math.round(entry.calories)} kcal
              </span>
              {/* Directly under the meal's Add, so the two controls for a meal
                  sit in one column rather than either side of the row. */}
              <IconButton danger label={`Remove ${entry.name}`} onClick={() => void onRemove(entry.id)}>
                <Trash2 size={15} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A day with nothing on it is the commonest state of the app's main screen —
 * every morning, for everyone. It has to offer the way in, not just describe
 * one: under "All" there are no meal headings yet, so without this there is no
 * button anywhere on the card.
 */
function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mt-4 flex flex-col items-center rounded-xl bg-muted px-4 py-6 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-surface text-ink-faint">
        <UtensilsCrossed size={19} />
      </span>
      <p className="mt-3 text-[13px] font-medium">Nothing logged yet</p>
      <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-ink-muted">
        Add your first food and it will appear here, under the meal you chose.
      </p>
      <Button variant="primary" size="sm" className="mt-4" onClick={onAdd}>
        <Plus size={15} /> Add food
      </Button>
    </div>
  );
}

/**
 * Whichever meal it probably is. Breakfast at nine and dinner at seven is a
 * better opening guess than always offering lunch.
 */
function mealForNow(): MealName {
  const hour = new Date().getHours();
  if (hour < 11) return "Breakfast";
  if (hour < 16) return "Lunch";
  if (hour < 21) return "Dinner";
  return "Snacks";
}

function describePortion(entry: DiaryEntry): string {
  if (entry.source === "recipe" || entry.source === "user_recipe") {
    const servings = entry.servings ?? 1;
    return `${format(servings)} serving${servings === 1 ? "" : "s"}`;
  }
  if (entry.source === "ai_photo") return "Photo estimate";
  return `${format(entry.amount)}${entry.unit}`;
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
