import { describe, expect, it } from "vitest";
import {
  looksInternal,
  presentError,
  serverMessage,
  userError,
  UserFacingError,
  withRetryHint,
} from "./errors";

/**
 * The point of this module is what it refuses to say. Most of these assertions
 * are negative on purpose: they pin down that a message written for a developer
 * cannot reach a screen just because it happened to be attached to an
 * exception.
 */

describe("presentError", () => {
  it("shows a message that was written for the reader", () => {
    expect(presentError(userError("That photo is larger than 10 MB."), "Nope.")).toBe(
      "That photo is larger than 10 MB.",
    );
  });

  it("passes a subclass of UserFacingError through as well", () => {
    class ServerSaidSo extends UserFacingError {}

    expect(presentError(new ServerSaidSo("Come back tomorrow."), "Nope.")).toBe(
      "Come back tomorrow.",
    );
  });

  it("replaces a PostgREST message rather than printing the schema", () => {
    const raw = new Error(
      'new row for relation "diary_entries" violates check constraint "diary_entries_calories_check"',
    );

    const shown = presentError(raw, "Could not add that to your diary.");

    expect(shown).not.toContain("diary_entries");
    expect(shown).not.toContain("constraint");
    expect(shown).toMatch(/could not add that to your diary/i);
  });

  it("never names an Edge Function", () => {
    const raw = new Error('Could not reach the "ai-chat" service. It may not be deployed yet.');

    expect(presentError(raw, "The coach could not answer that.")).not.toMatch(/ai-chat/);
  });

  it("gives a plain fallback a way forward", () => {
    expect(presentError(new Error("kaboom"), "Could not save that food.")).toBe(
      "Could not save that food. Please try again in a moment.",
    );
  });

  it("does not talk over a fallback that already says what to do", () => {
    expect(presentError(new Error("kaboom"), "Please try again.")).toBe("Please try again.");
  });

  it("recognises a request that never completed", () => {
    expect(presentError(new TypeError("Failed to fetch"), "Could not save.")).toMatch(
      /could not reach the server/i,
    );
  });

  it("tells someone with an expired session to sign in rather than to retry", () => {
    expect(presentError(new Error("JWT expired"), "Could not save.")).toMatch(/sign in again/i);
  });

  it("reads a message off a plain object, as supabase-js sometimes throws", () => {
    expect(presentError({ message: "Failed to fetch" }, "Could not save.")).toMatch(
      /could not reach the server/i,
    );
  });

  it("falls back for anything it cannot make sense of", () => {
    expect(presentError(null, "Could not load your foods.")).toBe(
      "Could not load your foods. Please try again in a moment.",
    );
    expect(presentError("just a string", "Could not load your foods.")).toBe(
      "Could not load your foods. Please try again in a moment.",
    );
  });
});

/**
 * Our own API writes its errors for the reader, which is why a FunctionError is
 * trusted. "Our server always words things properly" is still an assumption
 * though, and it is the same assumption that put a Postgres message on a screen
 * to begin with — so the text is screened on the way in.
 */
describe("serverMessage", () => {
  it("keeps wording the server wrote for the reader", () => {
    const written =
      "You have used all 35 of today's coach messages. Your allowance resets tomorrow.";

    expect(serverMessage(written, "fallback")).toBe(written);
  });

  it("keeps the everyday refusals intact", () => {
    for (const written of [
      "That is a lot at once — give it 20 seconds and try again.",
      "That photo does not belong to you.",
      "Add a note saying what this is before sending the photo.",
      "The verification service is unavailable, so nothing was saved. Please try again shortly.",
      "That did not look like a real dish. Try naming the ingredients you used.",
    ]) {
      expect(serverMessage(written, "fallback")).toBe(written);
    }
  });

  it("withholds a leak that reached the error field on some unhandled path", () => {
    expect(
      serverMessage(
        'permission denied for relation "chat_messages" in function ai-chat (groq/llama-3.3-70b)',
        "fallback",
      ),
    ).toBe("fallback");
  });

  it("falls back on an empty body", () => {
    expect(serverMessage("   ", "fallback")).toBe("fallback");
  });

  /**
   * Deliberate, and easy to mistake for a gap: naming the AI providers in the
   * marker list would ship those names in the bundle, which is the thing all of
   * this exists to prevent. It costs nothing real, because a body that leaked a
   * provider name would be leaking the fault around it too — as the case below
   * shows — and the server never writes one into an error field in the first
   * place. Do not "fix" this by adding vendor names.
   */
  it("leaves provider names off the client's marker list on purpose", () => {
    expect(looksInternal("groq is out of quota")).toBe(false);

    // The realistic shape is still caught, because the rest of it gives it away.
    expect(
      looksInternal('permission denied for relation "chat_messages" (groq/llama-3.3-70b)'),
    ).toBe(true);
  });

  it("knows the shapes internal text comes in", () => {
    expect(looksInternal('null value in column "user_id" violates not-null constraint')).toBe(true);
    expect(looksInternal("new row violates row-level security policy")).toBe(true);
    expect(looksInternal("JWT expired")).toBe(true);
    expect(looksInternal("could not reach https://x.supabase.co/functions/v1/ai-chat")).toBe(true);
    expect(looksInternal("Please try again in a moment.")).toBe(false);
  });
});

describe("withRetryHint", () => {
  it("adds the missing full stop before the hint", () => {
    expect(withRetryHint("Could not save that food")).toBe(
      "Could not save that food. Please try again in a moment.",
    );
  });

  it("leaves wording that already points somewhere alone", () => {
    expect(withRetryHint("Check your connection and try again.")).toBe(
      "Check your connection and try again.",
    );
    expect(withRetryHint("Your allowance resets tomorrow.")).toBe(
      "Your allowance resets tomorrow.",
    );
  });
});
