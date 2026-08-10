import { ArrowLeft, Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Chip,
  cx,
  Field,
  FoodImage,
  inputClass,
  Page,
} from "./ui";
import { scaleIngredientNutrition } from "../lib/nutrition";
import { useAppData } from "../state/AppDataContext";
import { MEALS, type Ingredient, type MealName } from "../types";

const QUICK_AMOUNTS = [30, 50, 100, 150, 200, 250];

/**
 * One screen for "how much of this did you eat". Shared by diary search, the
 * library and recents, so portion behaviour cannot drift between them.
 */
export function PortionEditor({
  ingredient,
  defaultMeal,
  onBack,
  onAdded,
}: {
  ingredient: Ingredient;
  defaultMeal: MealName;
  onBack: () => void;
  onAdded?: () => void;
}) {
  const { logFood, date } = useAppData();
  const [amount, setAmount] = useState(100);
  const [meal, setMeal] = useState<MealName>(defaultMeal);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nutrition = useMemo(
    () => scaleIngredientNutrition(ingredient, Math.max(0, amount)),
    [ingredient, amount],
  );

  const add = async () => {
    if (amount <= 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await logFood({
        name: ingredient.name,
        amount,
        unit: ingredient.basis_unit,
        meal,
        calories: nutrition.calories,
        protein: nutrition.protein,
        carbs: nutrition.carbs,
        fat: nutrition.fat,
        fibre: nutrition.fibre,
        date,
        source: ingredient.owned ? "user_ingredient" : "ingredient",
        ingredientId: ingredient.owned ? null : ingredient.id,
        userIngredientId: ingredient.owned ? ingredient.id : null,
      });
      setAdded(true);
      onAdded?.();
      window.setTimeout(() => setAdded(false), 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add that to your diary.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <button
        onClick={onBack}
        className="mb-5 inline-flex min-h-9 items-center gap-2 text-[13px] text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={16} /> Back to search
      </button>

      <div className="mb-6 flex items-center gap-4 sm:gap-6">
        <FoodImage
          src={ingredient.image_url ?? undefined}
          alt={ingredient.name}
          className="size-20 shrink-0 rounded-2xl object-cover sm:size-28"
        />
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-brand">
            {ingredient.owned ? "Your food" : ingredient.food_type.replaceAll("_", " ")}
          </p>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{ingredient.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {ingredient.brand || ingredient.category || "Nutrition reference food"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Your portion</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{nutrition.calories} kcal</p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {QUICK_AMOUNTS.map((value) => (
              <Chip key={value} active={amount === value} onClick={() => setAmount(value)}>
                {value}
                {ingredient.basis_unit}
              </Chip>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label={`Amount (${ingredient.basis_unit})`}>
              <input
                type="number"
                min="1"
                max="5000"
                inputMode="numeric"
                className={inputClass}
                value={amount}
                onChange={(event) => setAmount(Number(event.target.value))}
              />
            </Field>
            <Field label="Meal">
              <select
                className={inputClass}
                value={meal}
                onChange={(event) => setMeal(event.target.value as MealName)}
              >
                {MEALS.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </Field>
          </div>

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
            disabled={amount <= 0 || busy}
          >
            {added ? <Check size={17} /> : <Plus size={17} />}
            {added ? "Added to diary" : busy ? "Adding…" : "Add to diary"}
          </Button>
        </Card>

        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-ink-muted">Nutrition</h2>
            <span className="text-xs text-ink-faint">
              for {amount || 0}
              {ingredient.basis_unit}
            </span>
          </div>

          <dl className="mt-3 grid sm:grid-cols-2 sm:gap-x-8">
            <Nutrient label="Protein" value={`${nutrition.protein}g`} />
            <Nutrient label="Carbohydrates" value={`${nutrition.carbs}g`} />
            <Nutrient label="Fat" value={`${nutrition.fat}g`} />
            <Nutrient label="Fibre" value={`${nutrition.fibre}g`} />
            <Nutrient label="Sugars" value={`${nutrition.sugars}g`} />
            <Nutrient label="Saturated fat" value={`${nutrition.saturatedFat}g`} />
            <Nutrient label="Sodium" value={`${nutrition.sodium}mg`} />
          </dl>

          <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
            Values are stored per {ingredient.basis_quantity}
            {ingredient.basis_unit}.
          </p>
        </Card>
      </div>
    </Page>
  );
}

function Nutrient({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cx("flex min-h-11 items-center justify-between border-b border-line-soft", className)}>
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="text-[13px] font-medium tabular-nums">{value}</dd>
    </div>
  );
}
