import { Check, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ScrollingText } from "./ScrollingText";
import { cx, inputClass } from "./ui";
import { lineFromIngredient } from "../lib/nutrition";
import { searchIngredients } from "../services/foodSearch";
import type { EstimateLine, Ingredient } from "../types";

/**
 * The ingredients behind an estimate, with their amounts open to correction.
 *
 * An estimate from a photo is a guess about a portion, and the person holding
 * the plate knows better than the model does. Every line carries its own
 * nutrition per 100g, so a corrected amount recalculates here and now — no
 * second AI call, nothing to wait for, and nothing written anywhere until the
 * user says so.
 *
 * Adding an ingredient searches the app's own food tables rather than asking a
 * model, which keeps it free and grounded in real numbers.
 */
export function IngredientLines({
  lines,
  onChange,
}: {
  lines: EstimateLine[];
  onChange: (lines: EstimateLine[]) => void;
}) {
  const [adding, setAdding] = useState(false);

  const setAmount = (index: number, raw: string) => {
    const amount = Number(raw);
    onChange(
      lines.map((line, at) =>
        at === index
          ? { ...line, amount: Number.isFinite(amount) && amount >= 0 ? amount : 0 }
          : line,
      ),
    );
  };

  return (
    // Every level down to the name needs to be allowed to shrink. A grid item
    // sizes to min-content by default, so without these the row keeps its
    // natural width, pushes the chat bubble wider than the screen and carries
    // the remove button off the edge of it.
    <div className="grid min-w-0 gap-1.5">
      {lines.map((line, index) => (
        <div key={`${line.name}-${index}`} className="flex min-w-0 items-center gap-2">
          <input
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            aria-label={`Amount of ${line.name}`}
            value={line.amount}
            onChange={(event) => setAmount(index, event.target.value)}
            className="min-h-9 w-14 shrink-0 rounded-lg border border-line bg-surface px-1.5 text-right text-[13px] font-semibold tabular-nums outline-none focus:border-brand"
          />
          <span className="shrink-0 text-[11px] text-ink-faint">{line.unit}</span>

          <ScrollingText className="flex-1 text-[13px]" title={line.name}>
            {line.name}
            {/* Only the guesses are marked. Labelling the rest "from the
                database" would be noise on almost every row. */}
            {line.source === "ai_estimate" && (
              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                estimate
              </span>
            )}
          </ScrollingText>

          <button
            type="button"
            onClick={() => onChange(lines.filter((_, at) => at !== index))}
            aria-label={`Remove ${line.name}`}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-muted hover:text-ink"
          >
            <X size={14} />
          </button>
        </div>
      ))}

      {adding ? (
        <IngredientSearch
          onCancel={() => setAdding(false)}
          onPick={(food) => {
            onChange([...lines, lineFromIngredient(food)]);
            setAdding(false);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-0.5 inline-flex items-center gap-1.5 self-start rounded-lg px-1 py-1 text-[12px] font-medium text-brand transition-colors hover:bg-brand-soft"
        >
          <Plus size={13} /> Add an ingredient
        </button>
      )}
    </div>
  );
}

/**
 * Searches the foods the app already knows. Deliberately not an AI call: the
 * user is correcting an estimate, and a second guess is no help — a stored food
 * has real numbers behind it.
 */
function IngredientSearch({
  onPick,
  onCancel,
}: {
  onPick: (food: Ingredient) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Ingredient[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }

    // A keystroke is not a search. Waiting for a pause keeps one query in
    // flight instead of one per letter.
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchIngredients(trimmed, 8)
        .then((found) => {
          if (live) setResults(found.slice(0, 8));
        })
        .catch(() => {
          if (live) setResults([]);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 250);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="mt-1 rounded-xl border border-line bg-surface p-2">
      <div className="flex items-center gap-2">
        <Search size={14} className="shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your foods…"
          aria-label="Search for an ingredient"
          className={cx(inputClass, "min-h-9 py-1 text-[13px]")}
        />
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel adding an ingredient"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-muted hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>

      {query.trim().length >= 2 && (
        <div className="mt-1.5 grid gap-0.5">
          {results.map((food) => (
            <button
              key={food.id}
              type="button"
              onClick={() => onPick(food)}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
            >
              <Check size={13} className="shrink-0 text-brand" />
              <span className="min-w-0 flex-1 truncate text-[12px]">{food.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                {Math.round(Number(food.calories_kcal) || 0)} kcal
                <span className="text-ink-faint">/{food.basis_quantity}{food.basis_unit}</span>
              </span>
            </button>
          ))}

          {!searching && results.length === 0 && (
            <p className="px-2 py-1.5 text-[12px] text-ink-faint">
              Nothing matched. Try a simpler word, like &ldquo;rice&rdquo;.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
