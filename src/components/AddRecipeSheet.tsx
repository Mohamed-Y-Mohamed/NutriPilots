import { AlertTriangle, Check, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { ReasonList } from "./AddIngredientSheet";
import { Alert, Button, Chip, Field, IconButton, inputClass, labelClass, Sheet } from "./ui";
import { macroCalorieMismatch } from "../lib/nutrition";
import { submitRecipe } from "../services/libraryRepository";
import type { FoodReview, RecipeDraft } from "../types";

/** The reference `recipes` table requires exactly one of these, so user recipes match. */
const BASE_DIETS = ["omnivore", "vegetarian", "vegan", "pescatarian"] as const;
const EXTRA_TAGS = [
  "dairy-free",
  "gluten-free",
  "high-protein",
  "weight-loss",
  "high-fibre",
  "low-carb",
  "low-fat",
] as const;

const EMPTY = {
  name: "",
  description: "",
  servings: "2",
  prep_time_minutes: "",
  cook_time_minutes: "",
  instructions: "",
  calories_per_serving: "",
  protein_per_serving_g: "",
  carbs_per_serving_g: "",
  fat_per_serving_g: "",
  fibre_per_serving_g: "",
  cuisine: "",
};

type FormState = typeof EMPTY;

export function AddRecipeSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [ingredients, setIngredients] = useState<string[]>([""]);
  const [baseDiet, setBaseDiet] = useState<(typeof BASE_DIETS)[number]>("omnivore");
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<FoodReview | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const set = (key: keyof FormState, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const filledIngredients = ingredients.map((line) => line.trim()).filter(Boolean);
  const missing = requiredMissing(form, filledIngredients);

  const derivedCalories =
    Number(form.protein_per_serving_g) * 4 +
    Number(form.carbs_per_serving_g) * 4 +
    Number(form.fat_per_serving_g) * 9;

  const showMismatch =
    missing.length === 0 &&
    macroCalorieMismatch(
      Number(form.calories_per_serving),
      Number(form.protein_per_serving_g),
      Number(form.carbs_per_serving_g),
      Number(form.fat_per_serving_g),
    ) > 0.25;

  const save = async (acceptWarnings: boolean) => {
    if (busy || missing.length > 0) return;
    setBusy(true);
    setError(null);

    try {
      const result = await submitRecipe(
        toDraft(form, filledIngredients, [baseDiet, ...extraTags]),
        acceptWarnings,
      );
      setReview(result.review);

      if (result.saved) {
        onSaved();
        return;
      }
      setNeedsConfirm(Boolean(result.requiresConfirmation));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save that recipe.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Add a recipe"
      description="NutriPilot asks the AI whether this is a real recipe and whether the nutrition adds up before saving it."
      onClose={onClose}
      footer={
        <>
          {review?.verdict === "rejected" && (
            <Alert tone="error">
              <p className="font-medium">This does not look like a real recipe.</p>
              <ReasonList reasons={review.reasons} />
            </Alert>
          )}
          {needsConfirm && review && (
            <Alert tone="warn">
              <p className="font-medium">The AI is not confident about this one.</p>
              <ReasonList reasons={review.reasons} />
            </Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}

          <Button
            variant="primary"
            size="lg"
            full
            onClick={() => void save(needsConfirm)}
            disabled={busy || missing.length > 0}
          >
            {busy ? (
              "Checking with AI…"
            ) : needsConfirm ? (
              <>
                <Check size={16} /> Save anyway
              </>
            ) : (
              <>
                <Sparkles size={16} /> Verify and save
              </>
            )}
          </Button>

          {missing.length > 0 && (
            <p className="text-center text-[11px] text-ink-faint">
              Still needed: {missing.join(", ")}
            </p>
          )}
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Recipe name">
          <input
            className={inputClass}
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Chicken and chickpea traybake"
            autoFocus
          />
        </Field>

        <Field label="Short description" hint="One sentence about what it is.">
          <input
            className={inputClass}
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
            placeholder="One-tray roast chicken thighs with chickpeas, peppers and paprika."
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Servings *">
            <input
              type="number"
              min="1"
              max="50"
              inputMode="numeric"
              className={inputClass}
              value={form.servings}
              onChange={(event) => set("servings", event.target.value)}
            />
          </Field>
          <Field label="Cuisine (optional)">
            <input
              className={inputClass}
              value={form.cuisine}
              onChange={(event) => set("cuisine", event.target.value)}
              placeholder="Mediterranean"
            />
          </Field>
          <Field label="Prep time (min)">
            <input
              type="number"
              min="0"
              inputMode="numeric"
              className={inputClass}
              value={form.prep_time_minutes}
              onChange={(event) => set("prep_time_minutes", event.target.value)}
            />
          </Field>
          <Field label="Cook time (min)">
            <input
              type="number"
              min="0"
              inputMode="numeric"
              className={inputClass}
              value={form.cook_time_minutes}
              onChange={(event) => set("cook_time_minutes", event.target.value)}
            />
          </Field>
        </div>

        <div>
          <span className={labelClass}>Ingredients *</span>
          <div className="mt-2 grid gap-2">
            {ingredients.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  className={inputClass}
                  value={line}
                  onChange={(event) =>
                    setIngredients((current) =>
                      current.map((item, position) =>
                        position === index ? event.target.value : item,
                      ),
                    )
                  }
                  placeholder={index === 0 ? "400g chicken thighs" : "1 tbsp olive oil"}
                />
                <IconButton
                  label="Remove ingredient"
                  disabled={ingredients.length === 1}
                  onClick={() =>
                    setIngredients((current) => current.filter((_, position) => position !== index))
                  }
                >
                  <X size={16} />
                </IconButton>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => setIngredients((current) => [...current, ""])}
          >
            <Plus size={14} /> Add ingredient
          </Button>
        </div>

        <Field label="Method *" hint="How to cook it, in your own words.">
          <textarea
            rows={5}
            className={`${inputClass} resize-y leading-relaxed`}
            value={form.instructions}
            onChange={(event) => set("instructions", event.target.value)}
            placeholder="Heat the oven to 200C. Toss everything on a tray and roast for 35 minutes…"
          />
        </Field>

        <p className="text-[12px] text-ink-faint">
          Nutrition <span className="font-medium text-ink-muted">per serving</span>.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Calories (kcal) *" value={form.calories_per_serving} onChange={(v) => set("calories_per_serving", v)} />
          <NumberField label="Protein (g) *" value={form.protein_per_serving_g} onChange={(v) => set("protein_per_serving_g", v)} />
          <NumberField label="Carbohydrates (g) *" value={form.carbs_per_serving_g} onChange={(v) => set("carbs_per_serving_g", v)} />
          <NumberField label="Fat (g) *" value={form.fat_per_serving_g} onChange={(v) => set("fat_per_serving_g", v)} />
          <NumberField label="Fibre (g)" value={form.fibre_per_serving_g} onChange={(v) => set("fibre_per_serving_g", v)} />
        </div>

        {showMismatch && (
          <Alert tone="warn">
            <span className="inline-flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                The macros add up to roughly {Math.round(derivedCalories)} kcal per serving, not{" "}
                {form.calories_per_serving}. The AI will flag this too.
              </span>
            </span>
          </Alert>
        )}

        <div>
          <span className={labelClass}>Diet type (pick one)</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {BASE_DIETS.map((diet) => (
              <Chip key={diet} active={baseDiet === diet} onClick={() => setBaseDiet(diet)}>
                {diet}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <span className={labelClass}>Other tags (optional)</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXTRA_TAGS.map((tag) => (
              <Chip
                key={tag}
                active={extraTags.includes(tag)}
                onClick={() =>
                  setExtraTags((current) =>
                    current.includes(tag)
                      ? current.filter((item) => item !== tag)
                      : [...current, tag],
                  )
                }
              >
                {tag.replace("-", " ")}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min="0"
        step="0.1"
        inputMode="decimal"
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
      />
    </Field>
  );
}

function requiredMissing(form: FormState, ingredients: string[]): string[] {
  const missing: string[] = [];
  if (form.name.trim().length < 2) missing.push("name");
  if (ingredients.length === 0) missing.push("ingredients");
  if (form.instructions.trim().length < 11) missing.push("method");
  if (!isNumber(form.servings) || Number(form.servings) <= 0) missing.push("servings");
  if (!isNumber(form.calories_per_serving)) missing.push("calories");
  if (!isNumber(form.protein_per_serving_g)) missing.push("protein");
  if (!isNumber(form.carbs_per_serving_g)) missing.push("carbohydrates");
  if (!isNumber(form.fat_per_serving_g)) missing.push("fat");
  return missing;
}

function isNumber(value: string): boolean {
  if (value.trim() === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function toDraft(form: FormState, ingredients: string[], tags: string[]): RecipeDraft {
  return {
    name: form.name.trim(),
    description: form.description.trim() || `${form.name.trim()} — a recipe from your library.`,
    servings: Number(form.servings),
    prep_time_minutes: isNumber(form.prep_time_minutes) ? Number(form.prep_time_minutes) : null,
    cook_time_minutes: isNumber(form.cook_time_minutes) ? Number(form.cook_time_minutes) : null,
    instructions: form.instructions.trim(),
    calories_per_serving: Number(form.calories_per_serving),
    protein_per_serving_g: Number(form.protein_per_serving_g),
    carbs_per_serving_g: Number(form.carbs_per_serving_g),
    fat_per_serving_g: Number(form.fat_per_serving_g),
    fibre_per_serving_g: isNumber(form.fibre_per_serving_g)
      ? Number(form.fibre_per_serving_g)
      : null,
    cuisine: form.cuisine.trim() || null,
    dietary_tags: tags,
    ingredients: ingredients.map((line) => ({
      original_text: line,
      name: line.replace(/^[\d.,/\s]*(g|kg|ml|l|tbsp|tsp|cups?|cloves?)?\s*/i, "").trim() || line,
      quantity: null,
      unit: null,
    })),
  };
}
