import { ingredientList, round, text } from "./coerce.ts";

/**
 * Pulls the machine-readable meal block off the end of a reply. The user sees
 * prose; the app gets something it can write to the diary.
 *
 * Models are inconsistent about the markers: they add spaces, change case, wrap
 * the JSON in a code fence, or open the block and never close it. Each of those
 * meant no card appeared and the prose stood alone — which reads as though the
 * coach logged the food itself. So parsing is forgiving, and marker text is
 * scrubbed from the reply whether or not the block was salvageable.
 */
const LOG_BLOCK = /<{2,}\s*LOG\b([\s\S]*?)(?:\bLOG\s*>{2,}|$)/i;

/** Catches a stray marker left behind by a block that never parsed. */
const LOOSE_MARKER = /<{2,}\s*LOG\b|\bLOG\s*>{2,}/gi;

function parseBlock(payload: string): unknown {
  // A code fence around the JSON is the single most common deviation.
  const fenced = payload.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [payload, fenced?.[1], payload.match(/\[[\s\S]*\]/)?.[0]];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate.trim());
    } catch {
      continue;
    }
  }
  return null;
}

export function splitSuggestions(raw: string): {
  reply: string;
  suggestions: Array<Record<string, unknown>>;
} {
  const match = raw.match(LOG_BLOCK);
  const reply = (match ? raw.replace(match[0], "") : raw).replace(LOOSE_MARKER, "").trim();

  const parsed = match ? parseBlock(match[1]) : null;
  if (!Array.isArray(parsed)) return { reply, suggestions: [] };

  const suggestions = parsed
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .slice(0, 4)
    .map((item) => ({
      name: text(item.name, "Meal", 120),
      ingredients: ingredientList(item.ingredients),
      calories: round(item.calories, 0),
      protein_g: round(item.protein_g, 1),
      carbs_g: round(item.carbs_g, 1),
      fat_g: round(item.fat_g, 1),
      fibre_g: round(item.fibre_g, 1),
      servings: round(item.servings ?? 1, 2) || 1,
    }))
    // A "meal" with no energy at all is not worth offering.
    .filter((item) => item.calories > 0);

  return { reply, suggestions };
}
