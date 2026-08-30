import {
  AlertTriangle,
  Camera,
  Check,
  Database,
  Info,
  PencilLine,
  Plus,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ReasonList } from "./AddIngredientSheet";
import {
  Alert,
  Badge,
  Button,
  Chip,
  Field,
  IconButton,
  inputClass,
  labelClass,
  Sheet,
} from "./ui";
import { prepareImage } from "../lib/image";
import { capturePhoto, isNative } from "../lib/native";
import { uploadMealPhoto } from "../services/aiClient";
import { useAuth } from "../state/AuthContext";
import { macroCalorieMismatch, round1, totalsForLines } from "../lib/nutrition";
import { IngredientLines } from "./IngredientLines";
import {
  estimateDishFromText,
  promoteToSharedDatabase,
  scanRecipePhoto,
  submitRecipe,
} from "../services/libraryRepository";
import type { EstimateLine, FoodReview, RecipeDraft, RecipeScan } from "../types";

import { presentError } from "../lib/errors";
const MAX_DESCRIPTION = 1500;

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
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<FoodReview | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [estimated, setEstimated] = useState<string[]>([]);
  const [describing, setDescribing] = useState(false);
  const [description, setDescription] = useState("");
  const [grounded, setGrounded] = useState<{ matched: number; total: number } | null>(null);
  const [lines, setLines] = useState<EstimateLine[]>([]);

  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    // Any edit invalidates a verdict the AI gave for different numbers, and the
    // note about which ingredients came from the database describes numbers
    // that no longer exist.
    setReview(null);
    setNeedsConfirm(false);
    setGrounded(null);
  };

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
      const result = await scanRecipePhoto(path);

      if (!result.recognised) {
        setError(result.error ?? "That photo does not look like a recipe.");
        return;
      }

      applyDraft(result);
    } catch (reason) {
      setError(presentError(reason, "Could not read that photo."));
    } finally {
      setScanning(false);
    }
  };

  /**
   * Typing a dish and photographing one return the same shape, so they fill the
   * form through the same path — the only difference a reader has to hold is
   * where the draft came from.
   */
  const applyDraft = (result: RecipeScan) => {
    const draft = result.draft;
    setForm({
      name: draft.name,
      description: draft.description,
      servings: String(draft.servings || 1),
      prep_time_minutes: draft.prep_time_minutes ? String(draft.prep_time_minutes) : "",
      cook_time_minutes: draft.cook_time_minutes ? String(draft.cook_time_minutes) : "",
      instructions: draft.instructions,
      calories_per_serving: String(draft.calories_per_serving),
      protein_per_serving_g: String(draft.protein_per_serving_g),
      carbs_per_serving_g: String(draft.carbs_per_serving_g),
      fat_per_serving_g: String(draft.fat_per_serving_g),
      fibre_per_serving_g: String(draft.fibre_per_serving_g),
      cuisine: draft.cuisine,
    });
    if (draft.ingredients.length > 0) setIngredients(draft.ingredients);

    const base = draft.dietary_tags.find((tag) =>
      (BASE_DIETS as readonly string[]).includes(tag),
    );
    if (base) setBaseDiet(base as (typeof BASE_DIETS)[number]);
    setExtraTags(draft.dietary_tags.filter((tag) => tag !== base));

    setLines(result.lines ?? []);
    setEstimated(result.estimatedFields ?? []);
    setGrounded(
      typeof result.matchedFromDatabase === "number" && result.totalIngredients
        ? { matched: result.matchedFromDatabase, total: result.totalIngredients }
        : null,
    );
    // The draft was already judged against these exact numbers, so saving
    // reuses the verdict rather than paying for a second check.
    setReview(result.review);
    setNeedsConfirm(result.review.verdict === "needs_review");
  };

  const runEstimate = async () => {
    const text = description.trim();
    if (!text || scanning || busy) return;
    setScanning(true);
    setError(null);

    try {
      const result = await estimateDishFromText(text);
      if (!result.recognised) {
        setError(result.error ?? "That did not look like a dish.");
        return;
      }
      applyDraft(result);
      setDescribing(false);
    } catch (reason) {
      setError(presentError(reason, "Could not work that one out."));
    } finally {
      setScanning(false);
    }
  };

  // With itemised ingredients the per-serving figures are never typed, only
  // derived — so correcting an amount, or changing how many servings it makes,
  // updates the nutrition without the user touching four separate boxes.
  useEffect(() => {
    if (lines.length === 0) return;
    const servings = Math.max(1, Number(form.servings) || 1);
    const totals = totalsForLines(lines);

    setForm((current) => ({
      ...current,
      calories_per_serving: String(Math.round(totals.calories / servings)),
      protein_per_serving_g: String(round1(totals.protein / servings)),
      carbs_per_serving_g: String(round1(totals.carbs / servings)),
      fat_per_serving_g: String(round1(totals.fat / servings)),
      fibre_per_serving_g: String(round1(totals.fibre / servings)),
    }));
    setIngredients(
      lines.map((line) => `${Math.max(1, Math.round(line.amount))}${line.unit} ${line.name}`),
    );
  }, [lines, form.servings]);

  const editLines = (next: EstimateLine[]) => {
    setLines(next);
    // The numbers the AI judged are no longer the numbers being saved.
    setReview(null);
    setNeedsConfirm(false);
    setGrounded(null);
  };

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
        review,
      );
      setReview(result.review);

      if (result.saved) {
        // Offer it to the shared database too. Approved foods help everyone;
        // anything less confident stays private. Never blocks the save.
        const saved = result.item as { id?: string } | undefined;
        if (saved?.id) void promoteToSharedDatabase("recipe", saved.id);
        onSaved();
        return;
      }
      setNeedsConfirm(Boolean(result.requiresConfirmation));
    } catch (reason) {
      setError(presentError(reason, "Could not save that recipe."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Add a recipe"
      description="Photograph the recipe or type it in. It is checked by AI and saved to your recipes — only you will see it."
      onClose={onClose}
      footer={
        <>
          {review?.verdict === "rejected" && (
            <Alert tone="error">
              <p className="font-medium">This does not look like a real recipe.</p>
              <ReasonList reasons={review.reasons} />
            </Alert>
          )}
          {needsConfirm && review && review.verdict !== "rejected" && (
            <Alert tone="warn">
              <p className="font-medium">The AI is not fully confident about this one.</p>
              <ReasonList reasons={review.reasons} />
              <p className="mt-1.5">
                You can still save it — it goes to your recipes only and will not affect anyone
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
                <Check size={16} /> Save to my recipes anyway
              </>
            ) : review ? (
              <>
                <Check size={16} /> Save to my recipes
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
              <Camera size={16} />
              {scanning && !describing ? "Reading recipe…" : "Scan a recipe or dish"}
            </Button>
            {isNative && (
              <Button
                onClick={() => void scan("gallery")}
                disabled={scanning || busy}
                aria-label="Choose a photo"
              >
                <Wand2 size={16} />
              </Button>
            )}
          </div>

          <Button
            full
            className="mt-2"
            aria-expanded={describing}
            onClick={() => setDescribing((open) => !open)}
            disabled={scanning || busy}
          >
            <PencilLine size={16} /> {describing ? "Hide the description" : "Describe it instead"}
          </Button>

          {describing ? (
            <div className="animate-fade-in mt-2 rounded-xl border border-line bg-surface p-3">
              <textarea
                autoFocus
                rows={4}
                maxLength={MAX_DESCRIPTION}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Chicken curry with rice and a side salad. Serves 4."
                className={`${inputClass} resize-y leading-relaxed`}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                Amounts help but are not required. Cups, handfuls and &ldquo;a bit of&rdquo; all
                work, and so do takeaways and leftovers.
              </p>
              <Button
                variant="primary"
                full
                className="mt-2.5"
                onClick={() => void runEstimate()}
                disabled={scanning || busy || description.trim().length === 0}
              >
                <Sparkles size={16} /> {scanning ? "Working it out…" : "Work it out"}
              </Button>
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              Photograph a recipe page, a handwritten card, or the finished dish. One photo fills in
              the ingredients, method and per-serving nutrition.
            </p>
          )}
        </div>

        {grounded && grounded.total > 0 && (
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-ink-muted">
            <Database size={13} className="mt-0.5 shrink-0 text-ink-faint" />
            <span>
              <span className="font-medium text-ink">
                {grounded.matched} of {grounded.total}
              </span>{" "}
              ingredients were priced from foods already in the database. The rest are the
              AI&rsquo;s own estimate.
            </span>
          </p>
        )}

        {estimated.length > 0 && (
          <Alert tone="info">
            <span className="inline-flex items-start gap-2">
              <Info size={14} className="mt-0.5 shrink-0" />
              <span>
                Estimated rather than read from the photo:{" "}
                <span className="font-medium">
                  {estimated.map((field) => field.replace(/_per_serving_g$|_g$/, "")).join(", ")}
                </span>
                . Worth a quick check.
              </span>
            </span>
          </Alert>
        )}

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

          {lines.length > 0 ? (
            <>
              <p className="mb-2 mt-1 text-[11px] leading-relaxed text-ink-faint">
                Change an amount if it looks wrong and the nutrition below follows. Add anything
                missing, or remove what is not in it.
              </p>
              <IngredientLines lines={lines} onChange={editLines} />
            </>
          ) : (
            <>
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
                        setIngredients((current) =>
                          current.filter((_, position) => position !== index),
                        )
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
            </>
          )}
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
          <NumberField label="Calories (kcal) *" estimated={estimated.includes("calories_per_serving")} value={form.calories_per_serving} onChange={(v) => set("calories_per_serving", v)} />
          <NumberField label="Protein (g) *" estimated={estimated.includes("protein_per_serving_g")} value={form.protein_per_serving_g} onChange={(v) => set("protein_per_serving_g", v)} />
          <NumberField label="Carbohydrates (g) *" estimated={estimated.includes("carbs_per_serving_g")} value={form.carbs_per_serving_g} onChange={(v) => set("carbs_per_serving_g", v)} />
          <NumberField label="Fat (g) *" estimated={estimated.includes("fat_per_serving_g")} value={form.fat_per_serving_g} onChange={(v) => set("fat_per_serving_g", v)} />
          <NumberField label="Fibre (g)" estimated={estimated.includes("fibre_per_serving_g")} value={form.fibre_per_serving_g} onChange={(v) => set("fibre_per_serving_g", v)} />
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
  estimated,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  estimated?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1.5">
        <span className={labelClass}>{label}</span>
        {estimated && <Badge tone="warn">Est.</Badge>}
      </span>
      <input
        type="number"
        min="0"
        step="0.1"
        inputMode="decimal"
        aria-label={label}
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
      />
    </div>
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
