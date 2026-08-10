import { AlertTriangle, Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { Alert, Button, Chip, Field, inputClass, labelClass, Sheet } from "./ui";
import { macroCalorieMismatch } from "../lib/nutrition";
import { submitIngredient } from "../services/libraryRepository";
import { DIET_TAGS, type FoodReview, type IngredientDraft } from "../types";

const EMPTY = {
  name: "",
  brand: "",
  basis_unit: "g" as "g" | "ml",
  calories_kcal: "",
  protein_g: "",
  carbohydrates_g: "",
  fat_g: "",
  fibre_g: "",
  sugars_g: "",
  saturated_fat_g: "",
  sodium_mg: "",
  category: "",
};

type FormState = typeof EMPTY;

/**
 * Nothing is saved until the AI review comes back. The client checks the shape
 * first so a review is never spent on a form that is simply incomplete.
 */
export function AddIngredientSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<FoodReview | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const set = (key: keyof FormState, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const missing = requiredMissing(form);
  const derivedCalories =
    Number(form.protein_g) * 4 + Number(form.carbohydrates_g) * 4 + Number(form.fat_g) * 9;
  const showMismatch =
    missing.length === 0 &&
    macroCalorieMismatch(
      Number(form.calories_kcal),
      Number(form.protein_g),
      Number(form.carbohydrates_g),
      Number(form.fat_g),
    ) > 0.25;

  const save = async (acceptWarnings: boolean) => {
    if (busy || missing.length > 0) return;
    setBusy(true);
    setError(null);

    try {
      const result = await submitIngredient(toDraft(form, tags), acceptWarnings);
      setReview(result.review);

      if (result.saved) {
        onSaved();
        return;
      }
      setNeedsConfirm(Boolean(result.requiresConfirmation));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save that food.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Add a food"
      description="Enter the nutrition from the label. NutriPilot checks it with AI before saving it to your library."
      onClose={onClose}
      footer={
        <>
          {review?.verdict === "rejected" && (
            <Alert tone="error">
              <p className="font-medium">This does not look like a real food.</p>
              <ReasonList reasons={review.reasons} />
            </Alert>
          )}
          {needsConfirm && review && (
            <Alert tone="warn">
              <p className="font-medium">The AI is not confident about these numbers.</p>
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
        <Field label="Food name">
          <input
            className={inputClass}
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Greek yoghurt, 0% fat"
            autoFocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand (optional)">
            <input
              className={inputClass}
              value={form.brand}
              onChange={(event) => set("brand", event.target.value)}
              placeholder="Own brand"
            />
          </Field>
          <Field label="Measured per">
            <select
              className={inputClass}
              value={form.basis_unit}
              onChange={(event) => set("basis_unit", event.target.value)}
            >
              <option value="g">100 g</option>
              <option value="ml">100 ml</option>
            </select>
          </Field>
        </div>

        <p className="text-[12px] text-ink-faint">
          All values below are per 100{form.basis_unit} — the same basis the food database uses.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Calories (kcal)" required value={form.calories_kcal} onChange={(v) => set("calories_kcal", v)} />
          <NumberField label="Protein (g)" required value={form.protein_g} onChange={(v) => set("protein_g", v)} />
          <NumberField label="Carbohydrates (g)" required value={form.carbohydrates_g} onChange={(v) => set("carbohydrates_g", v)} />
          <NumberField label="Fat (g)" required value={form.fat_g} onChange={(v) => set("fat_g", v)} />
          <NumberField label="Fibre (g)" value={form.fibre_g} onChange={(v) => set("fibre_g", v)} />
          <NumberField label="Sugars (g)" value={form.sugars_g} onChange={(v) => set("sugars_g", v)} />
          <NumberField label="Saturated fat (g)" value={form.saturated_fat_g} onChange={(v) => set("saturated_fat_g", v)} />
          <NumberField label="Sodium (mg)" value={form.sodium_mg} onChange={(v) => set("sodium_mg", v)} />
        </div>

        {showMismatch && (
          <Alert tone="warn">
            <span className="inline-flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Protein, carbs and fat add up to about {Math.round(derivedCalories)} kcal, a long
                way from the {form.calories_kcal} kcal you entered. Worth a second look at the
                label.
              </span>
            </span>
          </Alert>
        )}

        <div>
          <span className={labelClass}>Dietary tags (optional)</span>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DIET_TAGS.map((tag) => (
              <Chip
                key={tag}
                active={tags.includes(tag)}
                onClick={() =>
                  setTags((current) =>
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

export function ReasonList({ reasons }: { reasons: string[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="mt-1.5 list-disc pl-4 text-[12px] leading-relaxed opacity-90">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  );
}

function NumberField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <Field label={required ? `${label} *` : label}>
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

function requiredMissing(form: FormState): string[] {
  const missing: string[] = [];
  if (form.name.trim().length < 2) missing.push("name");
  if (!isNumber(form.calories_kcal)) missing.push("calories");
  if (!isNumber(form.protein_g)) missing.push("protein");
  if (!isNumber(form.carbohydrates_g)) missing.push("carbohydrates");
  if (!isNumber(form.fat_g)) missing.push("fat");
  return missing;
}

function isNumber(value: string): boolean {
  if (value.trim() === "") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function toDraft(form: FormState, tags: string[]): IngredientDraft {
  return {
    name: form.name.trim(),
    brand: form.brand.trim(),
    basis_quantity: 100,
    basis_unit: form.basis_unit,
    calories_kcal: Number(form.calories_kcal),
    protein_g: Number(form.protein_g),
    carbohydrates_g: Number(form.carbohydrates_g),
    fat_g: Number(form.fat_g),
    fibre_g: optional(form.fibre_g),
    sugars_g: optional(form.sugars_g),
    saturated_fat_g: optional(form.saturated_fat_g),
    sodium_mg: optional(form.sodium_mg),
    category: form.category.trim() || null,
    dietary_tags: tags,
  };
}

function optional(value: string): number | null {
  return isNumber(value) ? Number(value) : null;
}
