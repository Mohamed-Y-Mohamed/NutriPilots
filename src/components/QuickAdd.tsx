import { Camera, Check, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AddIngredientSheet } from "./AddIngredientSheet";
import { CoachBanner } from "./CoachBanner";
import { AddRecipeSheet } from "./AddRecipeSheet";
import { ScrollingText } from "./ScrollingText";
import { Alert, Button, Card, Segmented, Skeleton } from "./ui";
import { loadRecentFoods } from "../services/diaryRepository";
import { useAppData } from "../state/AppDataContext";
import { MEALS, type MealName, type RecentFood } from "../types";

/** Enough to cover a habit without turning the top of the day into a list. */
const SHOWN = 4;

const MEAL_OPTIONS = MEALS.map((meal) => ({ value: meal, label: meal }));

/**
 * The foods this person actually eats, one tap from the top of their day.
 *
 * Most days are made of the same dozen things. Searching the whole food table
 * for porridge every morning is the wrong default, so what they have logged
 * before comes first and the search is one tap further on.
 */
export function QuickAdd({
  meal,
  onMealChange,
}: {
  meal: MealName;
  onMealChange: (meal: MealName) => void;
}) {
  const navigate = useNavigate();
  const { date, diary, logFood } = useAppData();
  const setMeal = onMealChange;
  const [recents, setRecents] = useState<RecentFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<"ingredient" | "recipe" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    void loadRecentFoods(SHOWN * 3)
      .then(setRecents)
      .catch(() => setRecents([]))
      .finally(() => setLoading(false));
  }, []);

  // Recents are derived from the diary, so they are re-read whenever it
  // changes — including a delete, which would otherwise leave a food listed
  // with a count that is no longer true.
  const diarySignature = `${diary.length}:${Math.round(
    diary.reduce((sum, entry) => sum + entry.calories, 0),
  )}`;
  useEffect(reload, [reload, diarySignature]);

  const add = async (food: RecentFood) => {
    if (busy) return;
    setBusy(keyFor(food));
    setNote(null);
    try {
      await logFood({
        name: food.name,
        amount: food.amount,
        unit: food.unit,
        meal,
        calories: food.calories,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
        fibre: 0,
        date,
        source: food.source,
        servings: food.source === "recipe" || food.source === "user_recipe" ? food.amount : null,
        ingredientId: food.ingredientId,
        recipeId: food.recipeId,
        userIngredientId: food.userIngredientId,
        userRecipeId: food.userRecipeId,
      });
      setNote({ tone: "success", text: `${food.name} added to ${meal}` });
      reload();
    } catch (reason) {
      setNote({
        tone: "error",
        text: reason instanceof Error ? reason.message : "Could not add that food.",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="min-w-0 p-5 sm:p-6">
      <h2 className="text-sm font-medium text-ink-muted">Add food</h2>

      <CoachBanner className="mt-3" />

      <div className="mt-3">
        <Segmented options={MEAL_OPTIONS} value={meal} onChange={setMeal} ariaLabel="Add to" />
      </div>

      {note && (
        <Alert tone={note.tone} className="mt-3">
          {note.text}
        </Alert>
      )}

      <p className="mt-4 text-[11px] font-medium text-ink-muted">
        Your usual foods
      </p>

      <div className="mt-2 min-w-0">
        {loading ? (
          <div className="grid gap-2">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-11 w-full rounded-xl" />
            ))}
          </div>
        ) : recents.length === 0 ? (
          <p className="rounded-xl bg-muted px-3.5 py-3 text-[12px] leading-relaxed text-ink-muted">
            Foods you log will show up here, so tomorrow they are one tap away.
          </p>
        ) : (
          <ul className="grid min-w-0 gap-1">
            {recents.slice(0, SHOWN).map((food) => (
              <li key={keyFor(food)} className="min-w-0">
                <button
                  type="button"
                  onClick={() => void add(food)}
                  disabled={busy !== null}
                  className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-xl px-1 text-left transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-[11px] font-semibold tabular-nums text-ink-muted">
                    {food.timesLogged}&times;
                  </span>

                  <span className="min-w-0 flex-1">
                    <ScrollingText className="text-[13px] font-medium" title={food.name}>
                      {food.name}
                    </ScrollingText>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {describeAmount(food)}
                    </span>
                  </span>

                  <span className="shrink-0 text-[12px] font-medium tabular-nums text-ink-muted">
                    {Math.round(food.calories)} kcal
                  </span>
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
                    {busy === keyFor(food) ? <Check size={14} /> : <Plus size={15} />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <Button size="sm" onClick={() => navigate(`/diary?meal=${meal}`)}>
          <Search size={15} /> Search foods
        </Button>
        <Button size="sm" onClick={() => setSheet("ingredient")}>
          <Plus size={15} /> Ingredient
        </Button>
        <Button size="sm" onClick={() => setSheet("recipe")}>
          <Plus size={15} /> Recipe
        </Button>
        <Button size="sm" onClick={() => navigate("/coach")}>
          <Camera size={15} /> Photo
        </Button>
      </div>

      {sheet === "ingredient" && (
        <AddIngredientSheet
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            setNote({ tone: "success", text: "Food verified and added to your library" });
          }}
        />
      )}
      {sheet === "recipe" && (
        <AddRecipeSheet
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            setNote({ tone: "success", text: "Recipe verified and added to your library" });
          }}
        />
      )}
    </Card>
  );
}

/** Two foods can share a name across sources, so both make the key. */
function keyFor(food: RecentFood): string {
  return `${food.name}-${food.source}`;
}

function describeAmount(food: RecentFood): string {
  if (food.source === "recipe" || food.source === "user_recipe") {
    return `${food.amount} serving${food.amount === 1 ? "" : "s"}`;
  }
  return `${Math.round(food.amount)}${food.unit}`;
}
