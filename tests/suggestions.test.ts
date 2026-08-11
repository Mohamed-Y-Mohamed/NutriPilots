/**
 * The suggestion block is how a named meal becomes a button the user can press.
 * When extraction fails there is no button, only the coach's prose — which
 * reads as though it logged the food itself. Models deviate from the format
 * constantly, so every deviation seen in practice is pinned here.
 */

import { describe, expect, it } from "vitest";

const { splitSuggestions } = await import("../supabase/functions/_shared/suggestions.ts");

const MEAL = `[{"name":"Shakshouka","ingredients":["2 eggs","200g tomatoes"],"calories":320,"protein_g":18,"carbs_g":14,"fat_g":21,"fibre_g":4,"servings":1}]`;

describe("splitSuggestions", () => {
  it("reads the documented format", () => {
    const { reply, suggestions } = splitSuggestions(`Here you go.\n\n<<<LOG\n${MEAL}\nLOG>>>`);

    expect(reply).toBe("Here you go.");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].name).toBe("Shakshouka");
    expect(suggestions[0].calories).toBe(320);
  });

  it("tolerates spaces and lowercase in the markers", () => {
    const { suggestions } = splitSuggestions(`Sure.\n<<< log\n${MEAL}\nlog >>>`);
    expect(suggestions).toHaveLength(1);
  });

  it("tolerates extra angle brackets", () => {
    const { suggestions } = splitSuggestions(`Sure.\n<<<<LOG\n${MEAL}\nLOG>>>>`);
    expect(suggestions).toHaveLength(1);
  });

  it("unwraps a code fence around the JSON", () => {
    const { reply, suggestions } = splitSuggestions(
      `Sure.\n\n<<<LOG\n\`\`\`json\n${MEAL}\n\`\`\`\nLOG>>>`,
    );
    expect(suggestions).toHaveLength(1);
    expect(reply).toBe("Sure.");
  });

  it("recovers a block that was opened and never closed", () => {
    // Truncation at the token limit ends the reply mid-block.
    const { reply, suggestions } = splitSuggestions(`Sure.\n\n<<<LOG\n${MEAL}`);
    expect(suggestions).toHaveLength(1);
    expect(reply).toBe("Sure.");
  });

  it("finds the array when the model adds prose inside the block", () => {
    const { suggestions } = splitSuggestions(`Sure.\n<<<LOG\nHere is the data:\n${MEAL}\nLOG>>>`);
    expect(suggestions).toHaveLength(1);
  });

  it("never leaves a marker in what the user reads", () => {
    // A block whose JSON is unsalvageable must not print brackets into the chat.
    const { reply, suggestions } = splitSuggestions("Sure.\n<<<LOG\nnot json at all\nLOG>>>");

    expect(suggestions).toEqual([]);
    expect(reply).toBe("Sure.");
    expect(reply).not.toMatch(/LOG/);
  });

  it("scrubs a stray closing marker with no block", () => {
    const { reply } = splitSuggestions("Sure. LOG>>>");
    expect(reply).not.toMatch(/LOG/);
  });

  it("returns the reply untouched when there is no block", () => {
    const { reply, suggestions } = splitSuggestions("Eat more protein.");
    expect(reply).toBe("Eat more protein.");
    expect(suggestions).toEqual([]);
  });

  it("drops a meal with no energy rather than offering an empty entry", () => {
    const { suggestions } = splitSuggestions(`Hm.\n<<<LOG\n[{"name":"Water","calories":0}]\nLOG>>>`);
    expect(suggestions).toEqual([]);
  });

  it("caps the list so one reply cannot flood the chat", () => {
    const many = JSON.stringify(
      Array.from({ length: 9 }, (_, i) => ({ name: `Meal ${i}`, calories: 200 })),
    );
    const { suggestions } = splitSuggestions(`Options.\n<<<LOG\n${many}\nLOG>>>`);
    expect(suggestions).toHaveLength(4);
  });

  it("ignores a block that is not an array", () => {
    const { reply, suggestions } = splitSuggestions(`Sure.\n<<<LOG\n{"name":"Toast"}\nLOG>>>`);
    expect(suggestions).toEqual([]);
    expect(reply).toBe("Sure.");
  });
});
