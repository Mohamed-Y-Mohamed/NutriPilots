import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Whether a photo estimate has already been added to the diary used to live in
 * React state, so it survived exactly as long as the screen did. Reopening the
 * app brought the card back offering the same meal, and taking it logged the
 * meal twice — a duplicate the user can only find by noticing a day they logged
 * correctly now adds up wrong.
 */

const limit = vi.fn();
// The query orders twice before it limits, so the fake has to be chainable the
// same way the client is.
const order: ReturnType<typeof vi.fn> = vi.fn(() => ({ order, limit }));
const select = vi.fn(() => ({ order }));
const eq = vi.fn();
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select, update }));

vi.mock("../lib/supabase", () => ({ requireSupabase: () => ({ from }) }));

const { loadChatHistory, markEstimateLogged } = await import("./aiClient");

const ASSISTANT = {
  id: "m1",
  role: "assistant",
  content: "Around 733 kcal.",
  estimate: { dish_name: "Lamb", calories: 733 },
  provider: "groq",
  model: "test",
  created_at: "2026-08-20T12:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  eq.mockResolvedValue({ error: null });
});

describe("loadChatHistory", () => {
  it("carries through that an estimate was already logged", async () => {
    limit.mockResolvedValueOnce({
      data: [{ ...ASSISTANT, logged_at: "2026-08-20T12:05:00Z" }],
      error: null,
    });

    const [message] = await loadChatHistory();
    expect(message.loggedAt).toBe("2026-08-20T12:05:00Z");
  });

  it("leaves it unset when the estimate was never taken", async () => {
    limit.mockResolvedValueOnce({ data: [{ ...ASSISTANT, logged_at: null }], error: null });

    const [message] = await loadChatHistory();
    expect(message.loggedAt).toBeUndefined();
  });

  it("still loads the conversation from a database without the column", async () => {
    limit
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42703", message: "column chat_messages.logged_at does not exist" },
      })
      .mockResolvedValueOnce({ data: [ASSISTANT], error: null });

    const messages = await loadChatHistory();

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Around 733 kcal.");
    expect(select).toHaveBeenNthCalledWith(2, expect.not.stringContaining("logged_at"));
  });

  it("reports a genuine failure rather than retrying into it", async () => {
    limit.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "permission denied" },
    });

    await expect(loadChatHistory()).rejects.toThrow("permission denied");
    expect(select).toHaveBeenCalledTimes(1);
  });

  /**
   * A question and its answer used to be written by one INSERT, which stamps
   * both rows with the same transaction clock. Sorting on that alone left the
   * pair in whatever order the planner fancied, and reopening the coach could
   * show the reply above the message that prompted it.
   */
  it("breaks a tied timestamp on role so a reply cannot outrank its question", async () => {
    limit.mockResolvedValueOnce({ data: [], error: null });

    await loadChatHistory();

    expect(order).toHaveBeenNthCalledWith(1, "created_at", { ascending: false });
    expect(order).toHaveBeenNthCalledWith(2, "role", { ascending: true });
  });

  it("puts the question above the answer when both share a timestamp", async () => {
    const at = "2026-08-20T12:00:00Z";
    // Newest-first, as the query asks for it: within the tie the secondary sort
    // yields assistant then user, which reverses into the order it happened.
    limit.mockResolvedValueOnce({
      data: [
        { id: "a", role: "assistant", content: "Around 733 kcal.", created_at: at },
        { id: "q", role: "user", content: "What is in this?", created_at: at },
      ],
      error: null,
    });

    const messages = await loadChatHistory();

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[0].text).toBe("What is in this?");
  });

  it("does not read which AI provider or model answered", async () => {
    limit.mockResolvedValueOnce({ data: [], error: null });

    await loadChatHistory();

    expect(select).toHaveBeenCalledWith(expect.not.stringContaining("provider"));
    expect(select).toHaveBeenCalledWith(expect.not.stringContaining("model"));
  });
});

describe("markEstimateLogged", () => {
  it("stamps the message so the card does not offer it again", async () => {
    await markEstimateLogged("m1");

    expect(update).toHaveBeenCalledWith({ logged_at: expect.any(String) });
    expect(eq).toHaveBeenCalledWith("id", "m1");
  });

  it("never throws — the food is already in the diary by this point", async () => {
    eq.mockResolvedValueOnce({ error: { message: "network gone" } });
    await expect(markEstimateLogged("m1")).resolves.toBeUndefined();
  });
});
