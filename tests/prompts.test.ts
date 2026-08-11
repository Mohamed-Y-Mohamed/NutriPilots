/**
 * The coach has no way to write to the diary — only the user can, by confirming
 * the card the app renders. A model that says "added to your diary" is
 * therefore lying, and the user stops checking whether it really happened.
 *
 * This is a prompt, not code, so nothing else catches a regression here.
 */

import { describe, expect, it } from "vitest";

const { chatSystemPrompt, PHOTO_SYSTEM_PROMPT } = await import(
  "../supabase/functions/_shared/prompts.ts"
);

const chat = chatSystemPrompt("Context here.");

describe("chat system prompt", () => {
  it("tells the model it cannot write to the diary", () => {
    expect(chat).toMatch(/YOU CANNOT WRITE TO THE DIARY/);
    expect(chat).toMatch(/no ability to save, add, log or record/i);
  });

  it("forbids claiming a food was logged", () => {
    expect(chat).toMatch(/Never say you have added, logged,\s*saved or recorded/i);
  });

  it("says what to do instead when asked to log something", () => {
    expect(chat).toMatch(/add it from the card below/i);
  });

  it("makes clear the machine-readable block saves nothing on its own", () => {
    expect(chat).toMatch(/an offer, not an action/i);
  });

  it("still carries the scope and safety rules", () => {
    // The new section sits inside SCOPE; a bad edit could displace them.
    expect(chat).toMatch(/YOU ONLY DISCUSS/);
    expect(chat).toMatch(/1200 kcal/);
    expect(chat).toContain("Context here.");
  });

  it("applies the same rule to the photo prompt, which shares SCOPE", () => {
    expect(PHOTO_SYSTEM_PROMPT).toMatch(/YOU CANNOT WRITE TO THE DIARY/);
  });
});
