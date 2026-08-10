import { ChefHat, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Chip,
  EmptyState,
  FoodImage,
  Page,
  PageHeader,
  Spinner,
} from "../components/ui";
import { loadRecipes } from "../services/foodSearch";
import type { DietTag, Recipe } from "../types";

const FILTERS: Array<{ value: DietTag | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "weight-loss", label: "Weight loss" },
  { value: "high-protein", label: "High protein" },
  { value: "high-fibre", label: "High fibre" },
  { value: "low-carb", label: "Low carb" },
  { value: "low-fat", label: "Low fat" },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "pescatarian", label: "Pescatarian" },
  { value: "omnivore", label: "Omnivore" },
  { value: "gluten-free", label: "Gluten free" },
  { value: "dairy-free", label: "Dairy free" },
];

/** A recipe carries exactly one of these, so selecting one replaces the other. */
const BASE_DIETS = new Set<DietTag>(["vegan", "vegetarian", "pescatarian", "omnivore"]);

export function RecipesPage() {
  const [params, setParams] = useSearchParams();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const search = params.get("q") ?? "";
  const ingredientInput = params.get("ingredients") ?? "";

  const selectedTags = useMemo(
    () => (params.get("diet") ?? "").split(",").filter(Boolean) as DietTag[],
    [params],
  );

  const wantedIngredients = useMemo(
    () =>
      ingredientInput
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    [ingredientInput],
  );

  useEffect(() => {
    void loadRecipes()
      .then(setRecipes)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Could not load recipes."),
      )
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () =>
      recipes
        .map((recipe) => ({
          recipe,
          matches: countIngredientMatches(recipe, wantedIngredients),
        }))
        .filter(({ recipe, matches }) => {
          const haystack =
            `${recipe.name} ${recipe.description} ${recipe.cuisine ?? ""}`.toLowerCase();
          const matchesText = !search || haystack.includes(search.toLowerCase());
          const matchesTag = selectedTags.every((tag) => recipe.dietary_tags.includes(tag));
          const minimum =
            wantedIngredients.length === 0
              ? 0
              : Math.max(1, Math.ceil(wantedIngredients.length * 0.5));
          return matchesText && matchesTag && matches >= minimum;
        })
        .sort((a, b) => b.matches - a.matches),
    [recipes, search, selectedTags, wantedIngredients],
  );

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const toggleDiet = (value: DietTag | "all") => {
    if (value === "all") {
      updateParam("diet", "");
      return;
    }
    let next = selectedTags.includes(value)
      ? selectedTags.filter((item) => item !== value)
      : [...selectedTags, value];

    if (BASE_DIETS.has(value) && !selectedTags.includes(value)) {
      next = next.filter((item) => item === value || !BASE_DIETS.has(item));
    }
    updateParam("diet", next.join(","));
  };

  return (
    <Page>
      <PageHeader
        title="Recipes"
        subtitle="Filter by diet, or match recipes to the ingredients you already have."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex min-h-12 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 focus-within:border-brand">
          <Search size={18} className="shrink-0 text-ink-faint" aria-hidden="true" />
          <span className="sr-only">Search recipes</span>
          <input
            value={search}
            onChange={(event) => updateParam("q", event.target.value)}
            placeholder="Search recipes or cuisine…"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
        </label>

        <label className="flex min-h-12 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 focus-within:border-brand">
          <SlidersHorizontal size={17} className="shrink-0 text-ink-faint" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Cook with what I have
            </span>
            <input
              value={ingredientInput}
              onChange={(event) => updateParam("ingredients", event.target.value)}
              placeholder="chicken, rice, peppers"
              className="w-full bg-transparent text-[13px] outline-none"
            />
          </span>
        </label>
      </div>

      <div
        role="group"
        aria-label="Diet filters"
        className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {FILTERS.map((filter) => (
          <Chip
            key={filter.value}
            active={
              filter.value === "all" ? selectedTags.length === 0 : selectedTags.includes(filter.value)
            }
            onClick={() => toggleDiet(filter.value)}
          >
            {filter.label}
          </Chip>
        ))}
      </div>

      <p className="mt-4 mb-3 text-xs text-ink-muted">
        <span className="font-medium text-ink">{filtered.length} recipes</span>
        {wantedIngredients.length > 0
          ? ` · ranked by matches to ${wantedIngredients.length} ingredient${wantedIngredients.length > 1 ? "s" : ""}`
          : " · nutrition is per serving"}
      </p>

      {loading ? (
        <Spinner label="Loading recipes…" />
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ChefHat size={20} />}
          title="No matching recipes"
          text="Remove a filter or try broader ingredient names."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(({ recipe, matches }) => (
            <RecipeCard
              key={`${recipe.owned ? "u" : "r"}-${recipe.id}`}
              recipe={recipe}
              matches={matches}
              wantedCount={wantedIngredients.length}
              queryString={params.toString()}
            />
          ))}
        </div>
      )}
    </Page>
  );
}

function RecipeCard({
  recipe,
  matches,
  wantedCount,
  queryString,
}: {
  recipe: Recipe;
  matches: number;
  wantedCount: number;
  queryString: string;
}) {
  return (
    <Link
      to={`/recipes/${recipe.id}${recipe.owned ? "?mine=1" : ""}`}
      state={{ from: queryString }}
      className="group overflow-hidden rounded-2xl border border-line bg-surface transition-colors hover:border-brand/40"
    >
      <div className="relative h-40 overflow-hidden bg-muted">
        <FoodImage
          src={recipe.image_url}
          alt={recipe.name}
          className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
        {wantedCount > 0 && (
          <span className="absolute bottom-2.5 left-2.5 rounded-lg bg-olive-deep/80 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
            {matches}/{wantedCount} matches
          </span>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between gap-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          <span className="truncate">{recipe.owned ? "My recipe" : recipe.cuisine || "Global"}</span>
          <span className="shrink-0 tabular-nums text-brand">
            {Math.round(recipe.calories_per_serving)} kcal
          </span>
        </div>

        <h2 className="mt-2 line-clamp-2 text-base font-semibold leading-snug tracking-tight">
          {recipe.name}
        </h2>
        {recipe.description && (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
            {recipe.description}
          </p>
        )}

        <div className="mt-3 flex gap-4 border-t border-line-soft pt-3 text-[11px] text-ink-muted">
          <span>
            <span className="font-semibold text-ink">
              {Math.round(recipe.protein_per_serving_g)}g
            </span>{" "}
            protein
          </span>
          <span>
            <span className="font-semibold text-ink">
              {Math.round(recipe.carbs_per_serving_g)}g
            </span>{" "}
            carbs
          </span>
          <span>
            <span className="font-semibold text-ink">{Math.round(recipe.fat_per_serving_g)}g</span>{" "}
            fat
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {recipe.dietary_tags.slice(0, 3).map((tag) => (
            <Badge key={tag} tone="neutral">
              {tag.replaceAll("-", " ")}
            </Badge>
          ))}
        </div>
      </div>
    </Link>
  );
}

function countIngredientMatches(recipe: Recipe, wanted: string[]): number {
  if (wanted.length === 0) return 0;
  const names = recipe.ingredients.map((item) =>
    `${item.name ?? ""} ${item.ingredient_name ?? ""} ${item.normalized_ingredient_name ?? ""} ${item.original_text}`.toLowerCase(),
  );
  return wanted.filter((wantedName) => names.some((name) => name.includes(wantedName))).length;
}
