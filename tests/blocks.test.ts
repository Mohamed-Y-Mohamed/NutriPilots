/**
 * The coach writes prose for the user and, when there is something the app can
 * act on, a machine-readable block after it. The user must only ever see the
 * prose — a block that survives into the reply is raw JSON in a chat bubble.
 */

import { describe, expect, it } from "vitest";

const { splitBlock, parseJsonArray, parseJsonObject } = await import(
  "../supabase/functions/_shared/blocks.ts"
);

describe("splitBlock", () => {
  it("takes the block out and leaves the prose", () => {
    const { rest, payload } = splitBlock('Here you go.\n\n<<<LOG\n[{"a":1}]\nLOG>>>', "LOG");

    expect(rest).toBe("Here you go.");
    expect(payload?.trim()).toBe('[{"a":1}]');
  });

  it("leaves a reply with no block completely alone", () => {
    const { rest, payload } = splitBlock("Just eat more protein.", "LOG");

    expect(rest).toBe("Just eat more protein.");
    expect(payload).toBeNull();
  });

  it("scrubs a marker from a block that was never closed", () => {
    const { rest } = splitBlock("Try this.\n\n<<<LOG\nnot json", "LOG");
    expect(rest).toBe("Try this.");
  });

  /**
   * Models are inconsistent enough to open a second block, and the payload of
   * the one that is not parsed still has to be scrubbed. Stripping the markers
   * globally while removing only the first block's span left the second one's
   * JSON sitting in the reply.
   */
  it("removes every block, not only the first", () => {
    const raw =
      'First.\n\n<<<LOG\n[{"a":1}]\nLOG>>>\n\nSecond.\n\n<<<LOG\n[{"b":2}]\nLOG>>>';
    const { rest, payload } = splitBlock(raw, "LOG");

    expect(payload?.trim()).toBe('[{"a":1}]');
    expect(rest).not.toMatch(/\{|\}|\[|\]/);
    expect(rest).toBe("First.\n\nSecond.");
  });

  it("keeps one block's markers from eating another's name", () => {
    const raw = 'Text.\n\n<<<PLAN\n{"calories":2000}\nPLAN>>>\n\n<<<LOG\n[{"a":1}]\nLOG>>>';

    // Splitting on PLAN must not disturb the LOG block, and the reverse.
    expect(splitBlock(raw, "PLAN").payload?.trim()).toBe('{"calories":2000}');
    expect(splitBlock(raw, "LOG").payload?.trim()).toBe('[{"a":1}]');
  });
});

describe("parsing the payload", () => {
  it("reads an array through a code fence", () => {
    expect(parseJsonArray('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
  });

  it("reads an object out of surrounding chatter", () => {
    expect(parseJsonObject('Sure thing: {"calories":2000} hope that helps')).toEqual({
      calories: 2000,
    });
  });

  it("will not hand back an object when a list was asked for", () => {
    expect(parseJsonArray('{"calories":2000}')).toBeNull();
  });

  it("will not hand back the first item when a list was asked for as an object", () => {
    // The reason these are two functions rather than one with a shape argument.
    expect(parseJsonObject('[{"a":1},{"b":2}]')).toBeNull();
  });

  it("returns null for anything unparseable", () => {
    expect(parseJsonArray("not json at all")).toBeNull();
    expect(parseJsonObject("not json at all")).toBeNull();
  });
});
