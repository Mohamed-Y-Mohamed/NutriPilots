import { parseJsonArray, splitBlock } from "./blocks.ts";
import { ingredientList, round, text } from "./coerce.ts";

/**
 * Pulls the machine-readable meal block off the end of a reply. The user sees
 * prose; the app gets something it can write to the diary.
 *
 * The forgiving marker and JSON handling lives in blocks.ts, shared with the
 * plan block.
 */
export function splitSuggestions(raw: string): {
  reply: string;
  suggestions: Array<Record<string, unknown>>;
} {
  const { rest: reply, payload } = splitBlock(raw, "LOG");

  const parsed = payload === null ? null : parseJsonArray(payload);
  if (!parsed) return { reply, suggestions: [] };

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
