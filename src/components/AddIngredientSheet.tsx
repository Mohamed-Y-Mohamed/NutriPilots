import { AlertTriangle, Camera, Check, Info, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Alert, Badge, Button, Chip, Field, inputClass, labelClass, Sheet } from "./ui";
import { prepareImage } from "../lib/image";
import { capturePhoto, isNative } from "../lib/native";
import { macroCalorieMismatch } from "../lib/nutrition";
import { uploadMealPhoto } from "../services/aiClient";
import { findExistingIngredients } from "../services/foodSearch";
import {
  promoteToSharedDatabase,
  scanIngredientPhoto,
  submitIngredient,
} from "../services/libraryRepository";
import { useAuth } from "../state/AuthContext";
import {
  DIET_TAGS,
  type FoodReview,
  type Ingredient,
  type IngredientDraft,
} from "../types";

import { presentError } from "../lib/errors";
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
  salt_g: "",
  category: "",
};

type FormState = typeof EMPTY;

/**
 * Adds a food to the signed-in user's own library. The row is owned by them and
 * visible only to them, which is why a merely plausible food is still worth
 * saving. An AI-approved one is additionally offered to the shared reference
 * database, so everyone benefits — see `promoteToSharedDatabase`.
 */
export function AddIngredientSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<FoodReview | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [estimated, setEstimated] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<Ingredient[]>([]);
  const [duplicatesDismissed, setDuplicatesDismissed] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    // Any edit invalidates a verdict the AI gave for different numbers.
    setReview(null);
    setNeedsConfirm(false);
  };

  // Looks for an existing reference food while the user types the name.
  useEffect(() => {
    const name = form.name.trim();
    if (name.length < 3) {
      setDuplicates([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      void findExistingIngredients(name)
        .then(setDuplicates)
        .catch(() => setDuplicates([]));
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [form.name]);

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

  const scan = async (source: "camera" | "gallery") => {
    if (!user) return;

    if (!isNative && source === "camera") {
      fileRef.current?.click();
      return;
    }

    try {
      const captured = await capturePhoto(source);
      if (captured) await runScan(captured.blob);
    } catch {
      // The camera sheet was dismissed, which is not an error.
    }
  };

  const scanFromFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const prepared = await prepareImage(file);
      await runScan(prepared.blob);
    } catch (reason) {
      setError(presentError(reason, "Could not read that image."));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const runScan = async (blob: Blob) => {
    if (!user || scanning) return;
    setScanning(true);
    setError(null);

    try {
      const path = await uploadMealPhoto(user.id, blob);
      const result = await scanIngredientPhoto(path);

      if (!result.recognised) {
        setError(result.error ?? "That photo does not look like a food or a label.");
        return;
      }

      const draft = result.draft;
      setForm({
        name: draft.name ?? "",
        brand: draft.brand ?? "",
        basis_unit: draft.basis_unit ?? "g",
        calories_kcal: text(draft.calories_kcal),
        protein_g: text(draft.protein_g),
        carbohydrates_g: text(draft.carbohydrates_g),
        fat_g: text(draft.fat_g),
        fibre_g: text(draft.fibre_g),
        sugars_g: text(draft.sugars_g),
        saturated_fat_g: text(draft.saturated_fat_g),
        sodium_mg: text(draft.sodium_mg),
        salt_g: text(draft.salt_g),
        category: draft.category ?? "",
      });
      setTags(draft.dietary_tags ?? []);
      setEstimated(result.estimatedFields ?? []);
      // The scan already judged these exact numbers, so save reuses the verdict.
      setReview(result.review);
      setNeedsConfirm(result.review.verdict === "needs_review");
    } catch (reason) {
      setError(presentError(reason, "Could not read that photo."));
    } finally {
      setScanning(false);
    }
  };

  const save = async (acceptWarnings: boolean) => {
    if (busy || missing.length > 0) return;
    setBusy(true);
    setError(null);

    try {
      const result = await submitIngredient(toDraft(form, tags), acceptWarnings, review);
      setReview(result.review);

      if (result.saved) {
        // Offer it to the shared database too. Approved foods help everyone;
        // anything less confident stays private. Never blocks the save.
        const saved = result.item as { id?: string } | undefined;
        if (saved?.id) void promoteToSharedDatabase("ingredient", saved.id);
        onSaved();
        return;
      }
      setNeedsConfirm(Boolean(result.requiresConfirmation));
    } catch (reason) {
      setError(presentError(reason, "Could not save that food."));
    } finally {
      setBusy(false);
    }
  };

  const showDuplicates = duplicates.length > 0 && !duplicatesDismissed;

  return (
    <Sheet
      title="Add a food"
      description="Photograph the label or type it in. It is checked by AI and saved to your foods — only you will see it."
      onClose={onClose}
      footer={
        <>
          {review?.verdict === "rejected" && (
            <Alert tone="error">
              <p className="font-medium">This does not look like a real food.</p>
              <ReasonList reasons={review.reasons} />
            </Alert>
          )}
          {needsConfirm && review && review.verdict !== "rejected" && (
            <Alert tone="warn">
              <p className="font-medium">The AI is not fully confident about these numbers.</p>
              <ReasonList reasons={review.reasons} />
              <p className="mt-1.5">
                You can still save it — it goes to your foods only and will not affect anyone
                else&rsquo;s search results.
              </p>
            </Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}

          <Button
            variant="primary"
            size="lg"
            full
            onClick={() => void save(needsConfirm)}
            disabled={busy || scanning || missing.length > 0}
          >
            {busy ? (
              "Saving…"
            ) : needsConfirm ? (
              <>
                <Check size={16} /> Save to my foods anyway
              </>
            ) : review ? (
              <>
                <Check size={16} /> Save to my foods
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
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => void scanFromFile(event)}
          />
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => void scan("camera")}
              disabled={scanning || busy}
            >
              <Camera size={16} /> {scanning ? "Reading photo…" : "Scan label or food"}
            </Button>
            {isNative && (
              <Button onClick={() => void scan("gallery")} disabled={scanning || busy}>
                <Wand2 size={16} />
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
            One photo fills in every field. Anything the label does not show is estimated from
            typical values for that food, and flagged so you can correct it.
          </p>
        </div>

        {estimated.length > 0 && (
          <Alert tone="info">
            <span className="inline-flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                Estimated rather than read from the photo:{" "}
                <span className="font-medium">{estimated.map(prettyField).join(", ")}</span>. Worth
                a quick check.
              </span>
            </span>
          </Alert>
        )}

        <Field label="Food name">
          <input
            className={inputClass}
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Greek yoghurt, 0% fat"
            autoFocus
          />
        </Field>

        {showDuplicates && (
          <Alert tone="info">
            <p className="font-medium text-ink">
              {duplicates[0].name} is already in the food database.
            </p>
            <p className="mt-1">
              You can log it straight from search — no need to add it. Save your own copy anyway
              if the brand or recipe differs.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button size="sm" onClick={onClose}>
                Use the existing food
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDuplicatesDismissed(true)}>
                Save mine anyway
              </Button>
            </div>
          </Alert>
        )}

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
          <NumberField label="Calories (kcal)" required value={form.calories_kcal} estimated={estimated.includes("calories_kcal")} onChange={(v) => set("calories_kcal", v)} />
          <NumberField label="Protein (g)" required value={form.protein_g} estimated={estimated.includes("protein_g")} onChange={(v) => set("protein_g", v)} />
          <NumberField label="Carbohydrates (g)" required value={form.carbohydrates_g} estimated={estimated.includes("carbohydrates_g")} onChange={(v) => set("carbohydrates_g", v)} />
          <NumberField label="Fat (g)" required value={form.fat_g} estimated={estimated.includes("fat_g")} onChange={(v) => set("fat_g", v)} />
          <NumberField label="Fibre (g)" value={form.fibre_g} estimated={estimated.includes("fibre_g")} onChange={(v) => set("fibre_g", v)} />
          <NumberField label="Sugars (g)" value={form.sugars_g} estimated={estimated.includes("sugars_g")} onChange={(v) => set("sugars_g", v)} />
          <NumberField label="Saturated fat (g)" value={form.saturated_fat_g} estimated={estimated.includes("saturated_fat_g")} onChange={(v) => set("saturated_fat_g", v)} />
          <NumberField label="Sodium (mg)" value={form.sodium_mg} estimated={estimated.includes("sodium_mg")} onChange={(v) => set("sodium_mg", v)} />
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
  estimated,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  estimated?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1.5">
        <span className={labelClass}>{required ? `${label} *` : label}</span>
        {estimated && <Badge tone="warn">Est.</Badge>}
      </span>
      <input
        type="number"
        min="0"
        step="0.1"
        inputMode="decimal"
        aria-label={required ? `${label} *` : label}
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
      />
    </div>
  );
}

function prettyField(field: string): string {
  return field
    .replace(/_g$|_mg$|_kcal$/, "")
    .replaceAll("_", " ")
    .replace("carbohydrates", "carbs");
}

function text(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
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
    salt_g: optional(form.salt_g),
    category: form.category.trim() || null,
    dietary_tags: tags,
  };
}

function optional(value: string): number | null {
  return isNumber(value) ? Number(value) : null;
}
