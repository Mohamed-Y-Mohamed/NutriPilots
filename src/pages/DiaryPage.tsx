import { ChevronRight, Clock, CookingPot, Plus, Salad, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AddIngredientSheet } from "../components/AddIngredientSheet";
import { AddRecipeSheet } from "../components/AddRecipeSheet";
import { CoachBanner } from "../components/CoachBanner";
import { FoodList, FoodRow } from "../components/FoodRow";
import { PortionEditor } from "../components/PortionEditor";
import {
  Alert,
  Button,
  EmptyState,
  labelClass,
  Page,
  PageHeader,
  Segmented,
  SkeletonList,
} from "../components/ui";
import { formatDayLabel } from "../lib/dates";
import { loadRecentFoods } from "../services/diaryRepository";
import { loadRecipes, searchIngredients } from "../services/foodSearch";
import { useAppData } from "../state/AppDataContext";
import { MEALS, type Ingredient, type MealName, type RecentFood, type Recipe } from "../types";

import { presentError } from "../lib/errors";
type Tab = "ingredients" | "recipes" | "mine";

const TAB_OPTIONS = [
  { value: "ingredients" as const, label: "Ingredients", icon: <Salad size={15} /> },
  { value: "recipes" as const, label: "Recipes", icon: <CookingPot size={15} /> },
  { value: "mine" as const, label: "My foods", icon: <Clock size={15} /> },
];

const MEAL_OPTIONS = MEALS.map((meal) => ({ value: meal, label: meal }));

export function DiaryPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { date, logFood } = useAppData();

  const mealFromUrl = params.get("meal");
  const [meal, setMeal] = useState<MealName>(
    MEALS.includes(mealFromUrl as MealName) ? (mealFromUrl as MealName) : "Lunch",
  );
  const [tab, setTab] = useState<Tab>("ingredients");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Ingredient | null>(null);
  const [sheet, setSheet] = useState<"ingredient" | "recipe" | null>(null);

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recents, setRecents] = useState<RecentFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reloadRecents = useCallback(() => {
    void loadRecentFoods()
      .then(setRecents)
      .catch(() => setRecents([]));
  }, []);

  // Ingredient search hits the network, so it is debounced.
  useEffect(() => {
    if (tab !== "ingredients") return;
    setLoading(true);
    setError(null);

    const timeout = window.setTimeout(() => {
      void searchIngredients(query)
        .then(setIngredients)
        .catch((reason: unknown) =>
          setError(presentError(reason, "Could not load foods.")),
        )
        .finally(() => setLoading(false));
    }, 260);

    return () => window.clearTimeout(timeout);
  }, [query, tab]);

  // Recipes are one bounded fetch, then filtered in memory.
  useEffect(() => {
    if (tab !== "recipes" || recipes.length > 0) return;
    setLoading(true);
    void loadRecipes()
      .then(setRecipes)
      .catch((reason: unknown) =>
        setError(presentError(reason, "Could not load recipes.")),
      )
      .finally(() => setLoading(false));
  }, [tab, recipes.length]);

  useEffect(() => {
    if (tab !== "mine") return;
    setLoading(true);
    void loadRecentFoods()
      .then(setRecents)
      .catch((reason: unknown) =>
        setError(presentError(reason, "Could not load your foods.")),
      )
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    setParams(meal === "Lunch" ? {} : { meal }, { replace: true });
  }, [meal, setParams]);

  const filteredRecipes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return recipes.slice(0, 40);
    return recipes.filter((recipe) => recipe.name.toLowerCase().includes(needle)).slice(0, 40);
  }, [recipes, query]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  };

  const logRecent = async (food: RecentFood) => {
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
        servings:
          food.source === "recipe" || food.source === "user_recipe" ? food.amount : null,
        ingredientId: food.ingredientId,
        recipeId: food.recipeId,
        userIngredientId: food.userIngredientId,
        userRecipeId: food.userRecipeId,
      });
      showToast(`${food.name} added to ${meal}`);
      reloadRecents();
    } catch (reason) {
      setError(presentError(reason, "Could not add that food."));
    }
  };

  if (selected) {
    return (
      <PortionEditor
        ingredient={selected}
        defaultMeal={meal}
        onBack={() => setSelected(null)}
        onAdded={reloadRecents}
      />
    );
  }

  return (
    <Page>
      <PageHeader
        title="What did you eat?"
        subtitle={`Adding to ${formatDayLabel(date).toLowerCase()}. Search a food, pick a recipe, or reuse something you have logged before.`}
      />

      <CoachBanner className="mb-4" />

      <div className="mb-4">
        <span className={labelClass}>Meal</span>
        <div className="mt-1.5">
          <Segmented options={MEAL_OPTIONS} value={meal} onChange={setMeal} ariaLabel="Meal" />
        </div>
      </div>

      <Segmented options={TAB_OPTIONS} value={tab} onChange={setTab} ariaLabel="Food source" />

      {tab !== "mine" && (
        <label className="mt-4 flex min-h-12 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 focus-within:border-brand">
          <Search size={18} className="shrink-0 text-ink-faint" aria-hidden="true" />
          <span className="sr-only">
            {tab === "ingredients" ? "Search foods" : "Search recipes"}
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              tab === "ingredients"
                ? "Try chicken breast, rice, yoghurt…"
                : "Try curry, salad, pasta…"
            }
            autoComplete="off"
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="min-h-8 shrink-0 text-xs font-medium text-brand"
            >
              Clear
            </button>
          )}
        </label>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setSheet("ingredient")}>
          <Plus size={15} /> Add ingredient
        </Button>
        <Button size="sm" onClick={() => setSheet("recipe")}>
          <Plus size={15} /> Add recipe
        </Button>
        <Button size="sm" onClick={() => navigate("/coach")}>
          <Sparkles size={15} /> Estimate from photo
        </Button>
      </div>

      {toast && (
        <Alert tone="success" className="mt-4">
          {toast}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      )}

      <div className="mt-4">
        {loading ? (
          <SkeletonList rows={7} />
        ) : tab === "ingredients" ? (
          <IngredientResults items={ingredients} onSelect={setSelected} />
        ) : tab === "recipes" ? (
          <RecipeResults recipes={filteredRecipes} />
        ) : (
          <RecentResults foods={recents} onLog={logRecent} onBrowse={() => setTab("ingredients")} />
        )}
      </div>

      {sheet === "ingredient" && (
        <AddIngredientSheet
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            showToast("Food verified and added to your library");
            setQuery("");
          }}
        />
      )}
      {sheet === "recipe" && (
        <AddRecipeSheet
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            showToast("Recipe verified and added to your library");
            setRecipes([]);
          }}
        />
      )}
    </Page>
  );
}

function IngredientResults({
  items,
  onSelect,
}: {
  items: Ingredient[];
  onSelect: (item: Ingredient) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Search size={20} />}
        title="No foods found"
        text="Try a shorter or more general name — or add it yourself with “Add ingredient” above."
      />
    );
  }

  return (
    <FoodList>
      {items.map((item) => (
        <FoodRow
          key={`${item.owned ? "u" : "r"}-${item.id}`}
          title={item.name}
          subtitle={item.brand || item.category || "Generic food"}
          imageUrl={item.image_url}
          mine={item.owned}
          calories={item.calories_kcal ?? 0}
          protein={item.protein_g ?? 0}
          carbs={item.carbohydrates_g ?? 0}
          fat={item.fat_g ?? 0}
          trailing={<ChevronRight size={17} />}
          onClick={() => onSelect(item)}
        />
      ))}
    </FoodList>
  );
}

function RecipeResults({ recipes }: { recipes: Recipe[] }) {
  if (recipes.length === 0) {
    return (
      <EmptyState
        icon={<CookingPot size={20} />}
        title="No recipes found"
        text="Try a different word, or add your own recipe above."
      />
    );
  }

  return (
    <FoodList>
      {recipes.map((recipe) => (
        <FoodRow
          key={`${recipe.owned ? "u" : "r"}-${recipe.id}`}
          title={recipe.name}
          subtitle={`${recipe.cuisine || "Recipe"} · ${recipe.ingredient_count} ingredients`}
          imageUrl={recipe.image_url}
          mine={recipe.owned}
          calories={recipe.calories_per_serving}
          protein={recipe.protein_per_serving_g}
          carbs={recipe.carbs_per_serving_g}
          fat={recipe.fat_per_serving_g}
          trailing={<ChevronRight size={17} />}
          to={`/recipes/${recipe.id}${recipe.owned ? "?mine=1" : ""}`}
        />
      ))}
    </FoodList>
  );
}

function RecentResults({
  foods,
  onLog,
  onBrowse,
}: {
  foods: RecentFood[];
  onLog: (food: RecentFood) => Promise<void>;
  onBrowse: () => void;
}) {
  if (foods.length === 0) {
    return (
      <EmptyState
        icon={<Clock size={20} />}
        title="Nothing here yet"
        text="Foods you log will appear here so you can add them again in one tap."
        action={
          <Button variant="primary" size="sm" onClick={onBrowse}>
            Search foods
          </Button>
        }
      />
    );
  }

  return (
    <FoodList>
      {foods.map((food) => (
        <FoodRow
          key={`${food.name}-${food.source}`}
          title={food.name}
          subtitle={`${describeAmount(food)} · last logged ${relativeDay(food.lastLogged)}`}
          leading={
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-[13px] font-semibold text-ink-muted tabular-nums">
              {food.timesLogged}×
            </span>
          }
          calories={food.calories}
          protein={food.protein}
          carbs={food.carbs}
          fat={food.fat}
          trailing={<Plus size={17} />}
          onClick={() => void onLog(food)}
        />
      ))}
    </FoodList>
  );
}

function describeAmount(food: RecentFood): string {
  if (food.source === "recipe" || food.source === "user_recipe") {
    return `${food.amount} serving${food.amount === 1 ? "" : "s"}`;
  }
  return `${Math.round(food.amount)}${food.unit}`;
}

function relativeDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recently";

  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
