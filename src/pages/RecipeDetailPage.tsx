import {
  ArrowLeft,
  Check,
  Clock3,
  ExternalLink,
  Minus,
  Play,
  Plus,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  cx,
  FoodImage,
  inputClass,
  Page,
  Skeleton,
} from "../components/ui";
import { intensityFromOverrides, scaleRecipeNutrition } from "../lib/nutrition";
import { getRecipe } from "../services/foodSearch";
import { useAppData } from "../state/AppDataContext";
import { MEALS, type MealName, type Recipe } from "../types";

/** "I used less / the usual / more" — the three answers people actually give. */
const AMOUNT_STEPS = [
  { label: "Less", value: 0.6 },
  { label: "Usual", value: 1 },
  { label: "More", value: 1.4 },
];

export function RecipeDetailPage() {
  const { recipeId } = useParams();
  const location = useLocation();
  const [params] = useSearchParams();
  const owned = params.get("mine") === "1";

  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const from = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    if (!recipeId) return;
    setLoading(true);
    void getRecipe(recipeId, owned)
      .then(setRecipe)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Could not load this recipe."),
      )
      .finally(() => setLoading(false));
  }, [recipeId, owned]);

  if (loading) {
    return (
      <Page className="max-w-6xl">
        <div role="status" aria-label="Loading recipe" className="grid gap-5">
          <Skeleton className="h-80 rounded-3xl" />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="grid gap-5">
              <Skeleton className="h-64 rounded-2xl" />
              <Skeleton className="h-48 rounded-2xl" />
            </div>
            <Skeleton className="h-96 rounded-2xl" />
          </div>
        </div>
      </Page>
    );
  }

  const backLink = `/recipes${from ? `?${from}` : ""}`;

  if (error || !recipe) {
    return (
      <Page>
        <BackLink to={backLink} />
        <Alert tone="error">{error || "Recipe not found."}</Alert>
      </Page>
    );
  }

  const totalTime = (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);

  return (
    <Page className="max-w-6xl">
      <BackLink to={backLink} />

      <div className="relative overflow-hidden rounded-3xl bg-olive-deep">
        <FoodImage
          src={recipe.image_url}
          alt={recipe.name}
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-linear-to-t from-olive-deep via-olive-deep/70 to-olive-deep/10 sm:bg-linear-to-r sm:from-olive-deep sm:via-olive-deep/75 sm:to-transparent" />

        <div className="relative flex min-h-80 flex-col justify-end p-6 sm:min-h-96 sm:max-w-xl sm:justify-center sm:p-10">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {recipe.dietary_tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm"
              >
                {tag.replaceAll("-", " ")}
              </span>
            ))}
          </div>

          <p className="text-[11px] font-medium uppercase tracking-widest text-lime">
            {recipe.owned ? "My recipe" : recipe.cuisine || "Global"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
            {recipe.name}
          </h1>
          {recipe.description && (
            <p className="mt-3 text-sm leading-relaxed text-white/65">{recipe.description}</p>
          )}

          <div className="mt-5 flex flex-wrap gap-5 text-[13px] text-white/75">
            <span className="inline-flex items-center gap-1.5">
              <Users size={16} /> {recipe.servings} servings
            </span>
            {totalTime > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Clock3 size={16} /> {totalTime} min
              </span>
            )}
            <span>
              <span className="font-semibold text-white">
                {Math.round(recipe.calories_per_serving)}
              </span>{" "}
              kcal / serving
            </span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-5">
          <Card className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight">Ingredients</h2>
            <ol className="mt-3 grid sm:grid-cols-2 sm:gap-x-8">
              {recipe.ingredients.map((item, index) => (
                <li
                  key={`${item.original_text}-${index}`}
                  className="flex min-h-12 items-center gap-3 border-b border-line-soft py-2 text-[13px]"
                >
                  <span className="w-5 shrink-0 text-[11px] tabular-nums text-ink-faint">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="leading-snug">{item.original_text}</span>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold tracking-tight">Method</h2>
            <div className="mt-3 grid gap-3">
              {recipe.instructions
                .split(/\n+/)
                .filter(Boolean)
                .map((step, index) => (
                  <p key={index} className="text-[14px] leading-relaxed text-ink-muted">
                    {step}
                  </p>
                ))}
            </div>
          </Card>

          {recipe.video_url && (
            <Card className="p-5 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <Play size={18} /> Recipe video
                </h2>
                {recipe.video_verified_short && recipe.video_duration_seconds && (
                  <Badge tone="info">
                    {Math.ceil(recipe.video_duration_seconds / 60)} min
                  </Badge>
                )}
              </div>
              <div className="aspect-video overflow-hidden rounded-xl bg-olive-deep">
                <iframe
                  src={recipe.video_url}
                  title={`${recipe.name} cooking video`}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="size-full border-0"
                />
              </div>
              {recipe.video_source_url && (
                <a
                  href={recipe.video_source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand"
                >
                  Open video source <ExternalLink size={13} />
                </a>
              )}
            </Card>
          )}
        </div>

        <aside className="lg:sticky lg:top-6">
          <LogRecipeCard recipe={recipe} />
        </aside>
      </div>
    </Page>
  );
}

function BackLink({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="mb-5 inline-flex min-h-9 items-center gap-2 text-[13px] text-ink-muted hover:text-ink"
    >
      <ArrowLeft size={16} /> Back to recipes
    </Link>
  );
}

/**
 * Turns "a bit more than one serving, and I went heavy on the beef" into an
 * honest set of numbers, then writes them to the diary.
 */
function LogRecipeCard({ recipe }: { recipe: Recipe }) {
  const { logFood, date } = useAppData();
  const [servings, setServings] = useState(1);
  const [meal, setMeal] = useState<MealName>("Dinner");
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [showAdjust, setShowAdjust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intensity = useMemo(
    () => intensityFromOverrides(overrides, recipe.ingredients.length),
    [overrides, recipe.ingredients.length],
  );

  const nutrition = useMemo(
    () => scaleRecipeNutrition(recipe, servings, intensity),
    [recipe, servings, intensity],
  );

  const adjusted = Object.values(overrides).some((value) => value !== 1);

  const add = async () => {
    if (busy || servings <= 0) return;
    setBusy(true);
    setError(null);

    try {
      await logFood({
        name: recipe.name,
        amount: servings,
        unit: "serving",
        meal,
        calories: nutrition.calories,
        protein: nutrition.protein,
        carbs: nutrition.carbs,
        fat: nutrition.fat,
        fibre: nutrition.fibre,
        date,
        source: recipe.owned ? "user_recipe" : "recipe",
        servings,
        notes: adjusted ? describeAdjustments(recipe, overrides) : null,
        recipeId: recipe.owned ? null : recipe.id,
        userRecipeId: recipe.owned ? recipe.id : null,
      });
      setAdded(true);
      window.setTimeout(() => setAdded(false), 2000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add this to your diary.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-medium text-ink-muted">Log this meal</h2>

      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-line p-1">
        <button
          onClick={() => setServings((current) => Math.max(0.5, round1(current - 0.5)))}
          disabled={servings <= 0.5}
          aria-label="Fewer servings"
          className="grid size-10 place-items-center rounded-lg bg-muted disabled:opacity-30"
        >
          <Minus size={17} />
        </button>
        <span className="grid justify-items-center">
          <strong className="text-lg font-semibold tabular-nums">{servings}</strong>
          <small className="text-[11px] text-ink-muted">
            serving{servings === 1 ? "" : "s"}
          </small>
        </span>
        <button
          onClick={() => setServings((current) => Math.min(20, round1(current + 0.5)))}
          disabled={servings >= 20}
          aria-label="More servings"
          className="grid size-10 place-items-center rounded-lg bg-muted disabled:opacity-30"
        >
          <Plus size={17} />
        </button>
      </div>

      <label className="mt-3 grid gap-1.5">
        <span className="text-xs font-medium text-ink-muted">Meal</span>
        <select
          className={inputClass}
          value={meal}
          onChange={(event) => setMeal(event.target.value as MealName)}
        >
          {MEALS.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </label>

      <button
        onClick={() => setShowAdjust((current) => !current)}
        aria-expanded={showAdjust}
        className="mt-3 min-h-9 text-[13px] font-medium text-brand"
      >
        {showAdjust ? "Hide adjustments" : "Cooked it differently?"}
      </button>

      {showAdjust && (
        <div className="mt-2">
          <p className="mb-2 text-[12px] leading-relaxed text-ink-faint">
            Tell NutriPilot where you went heavier or lighter and the numbers follow.
          </p>
          <div className="max-h-72 overflow-y-auto">
            {recipe.ingredients.map((item, index) => (
              <div
                key={`${item.original_text}-${index}`}
                className="flex items-center gap-2 border-b border-line-soft py-2"
              >
                <span className="min-w-0 flex-1 truncate text-[12px]">
                  {item.name || item.ingredient_name || item.original_text}
                </span>
                <span className="flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5">
                  {AMOUNT_STEPS.map((step) => (
                    <button
                      key={step.label}
                      onClick={() => setOverrides((current) => ({ ...current, [index]: step.value }))}
                      className={cx(
                        "min-h-8 rounded-md px-2 text-[11px] font-medium transition-colors",
                        (overrides[index] ?? 1) === step.value
                          ? "bg-surface text-ink"
                          : "text-ink-muted",
                      )}
                    >
                      {step.label}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-baseline gap-2 border-b border-line-soft pb-3">
        <strong className="text-3xl font-semibold tabular-nums">{nutrition.calories}</strong>
        <span className="text-[13px] text-ink-muted">kcal total</span>
      </div>

      <dl className="mb-1">
        <NutritionRow label="Protein" value={`${nutrition.protein}g`} />
        <NutritionRow label="Carbohydrates" value={`${nutrition.carbs}g`} />
        <NutritionRow label="Fat" value={`${nutrition.fat}g`} />
        <NutritionRow label="Fibre" value={`${nutrition.fibre}g`} />
      </dl>

      {adjusted && (
        <p className="mt-2 text-[11px] text-ink-faint">
          Adjusted for your changes ({Math.round(intensity * 100)}% of the standard recipe).
        </p>
      )}

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      <Button
        variant="primary"
        size="lg"
        full
        className="mt-4"
        onClick={() => void add()}
        disabled={busy}
      >
        {added ? <Check size={17} /> : <Plus size={17} />}
        {added ? "Added to diary" : busy ? "Adding…" : "Add to diary"}
      </Button>
    </Card>
  );
}

function NutritionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-10 items-center justify-between border-b border-line-soft">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="text-[13px] font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function describeAdjustments(recipe: Recipe, overrides: Record<number, number>): string {
  const parts = Object.entries(overrides)
    .filter(([, value]) => value !== 1)
    .map(([index, value]) => {
      const item = recipe.ingredients[Number(index)];
      const name = item?.name || item?.ingredient_name || item?.original_text || "an ingredient";
      return `${value > 1 ? "more" : "less"} ${name}`;
    });

  return parts.length > 0 ? `Adjusted: ${parts.join(", ")}` : "";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
