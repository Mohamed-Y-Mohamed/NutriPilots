/**
 * Tests the AI model chain — the most intricate new logic in the app and the
 * part a user never sees working or failing.
 *
 * `_shared/ai.ts` targets Deno but depends on nothing beyond `Deno.env.get` and
 * `fetch`, so both are stubbed here and the real module is exercised.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = new Map<string, string>();

// Must exist before the module under test is imported.
(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: (key: string) => env.get(key) },
};

const { callAi, CHAT_MODELS, VERIFY_MODELS, parseJsonLoose, cleanModelText, AiError } =
  await import("../supabase/functions/_shared/ai.ts");

interface Call {
  url: string;
  body: Record<string, unknown>;
}

let calls: Call[] = [];

/** Queue one outcome per call, in order. */
function mockFetchSequence(outcomes: Array<{ status: number; body: unknown }>) {
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      const outcome = outcomes[Math.min(index, outcomes.length - 1)];
      index += 1;
      return {
        ok: outcome.status >= 200 && outcome.status < 300,
        status: outcome.status,
        text: async () => JSON.stringify(outcome.body),
        json: async () => outcome.body,
      } as unknown as Response;
    }),
  );
}

const openAiReply = (text: string) => ({ choices: [{ message: { content: text } }] });
const geminiReply = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const rateLimited = { error: { message: "Rate limit reached for model" } };

const request = {
  system: "You are a nutrition coach.",
  messages: [{ role: "user" as const, text: "How much protein?" }],
};

beforeEach(() => {
  calls = [];
  env.clear();
  env.set("GROQ_API_KEY", "groq-key");
  env.set("GEMINI_API_KEY", "gemini-key");
  env.set("OPENROUTER_API_KEY", "openrouter-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("model chain ordering", () => {
  it("uses the first model and stops there when it answers", async () => {
    mockFetchSequence([{ status: 200, body: openAiReply("Aim for 1.6g per kg.") }]);

    const result = await callAi(request);

    expect(result.provider).toBe("groq");
    expect(result.model).toBe(CHAT_MODELS[0].model);
    expect(result.attempts).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("steps down through Groq's models before touching Gemini", async () => {
    mockFetchSequence([
      { status: 429, body: rateLimited },
      { status: 429, body: rateLimited },
      { status: 200, body: openAiReply("Third model answered.") },
    ]);

    const result = await callAi(request);

    expect(result.provider).toBe("groq");
    expect(result.model).toBe(CHAT_MODELS[2].model);
    expect(result.attempts).toEqual([
      `groq/${CHAT_MODELS[0].model}`,
      `groq/${CHAT_MODELS[1].model}`,
    ]);
    // Never left Groq.
    expect(calls.every((call) => call.url.includes("groq.com"))).toBe(true);
  });

  it("crosses to Gemini only once every Groq model is exhausted", async () => {
    const groqModelCount = CHAT_MODELS.filter((model) => model.provider === "groq").length;

    mockFetchSequence([
      ...Array.from({ length: groqModelCount }, () => ({ status: 429, body: rateLimited })),
      { status: 200, body: geminiReply("Gemini picked it up.") },
    ]);

    const result = await callAi(request);

    expect(result.provider).toBe("gemini");
    expect(result.attempts).toHaveLength(groqModelCount);
    expect(calls).toHaveLength(groqModelCount + 1);
    expect(calls.at(-1)!.url).toContain("generativelanguage.googleapis.com");
  });

  it("reports a 429 once every model on every provider is exhausted", async () => {
    mockFetchSequence([{ status: 429, body: rateLimited }]);

    await expect(callAi(request)).rejects.toMatchObject({
      name: "AiError",
      status: 429,
    });
    // Every configured chat model was genuinely attempted.
    expect(calls).toHaveLength(CHAT_MODELS.length);
  });
});

describe("failure classification", () => {
  it("aborts the whole chain on a 400 rather than replaying a bad request", async () => {
    mockFetchSequence([{ status: 400, body: { error: { message: "invalid payload" } } }]);

    await expect(callAi(request)).rejects.toBeInstanceOf(AiError);
    expect(calls).toHaveLength(1);
  });

  it("treats a 500 as worth retrying elsewhere", async () => {
    mockFetchSequence([
      { status: 500, body: { error: "upstream boom" } },
      { status: 200, body: openAiReply("Recovered.") },
    ]);

    const result = await callAi(request);
    expect(result.text).toBe("Recovered.");
    expect(result.attempts).toHaveLength(1);
  });

  it("treats an empty completion as a failure worth retrying", async () => {
    mockFetchSequence([
      { status: 200, body: openAiReply("   ") },
      { status: 200, body: openAiReply("Real answer.") },
    ]);

    const result = await callAi(request);
    expect(result.text).toBe("Real answer.");
  });

  it("catches OpenRouter's 200-with-error-body responses", async () => {
    mockFetchSequence([
      { status: 200, body: { error: { message: "rate limit exceeded" } } },
      { status: 200, body: openAiReply("Next model answered.") },
    ]);

    const result = await callAi(request, VERIFY_MODELS);
    expect(result.text).toBe("Next model answered.");
    expect(result.attempts).toHaveLength(1);
  });
});

describe("provider selection", () => {
  it("skips providers with no configured key", async () => {
    env.delete("GROQ_API_KEY");
    mockFetchSequence([{ status: 200, body: geminiReply("Gemini only.") }]);

    const result = await callAi(request);

    expect(result.provider).toBe("gemini");
    expect(calls).toHaveLength(1);
  });

  it("refuses rather than guessing when nothing is configured", async () => {
    env.clear();
    mockFetchSequence([{ status: 200, body: openAiReply("unreachable") }]);

    await expect(callAi(request)).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(0);
  });

  it("sends verification to OpenRouter first, keeping chat quota intact", async () => {
    mockFetchSequence([{ status: 200, body: openAiReply('{"verdict":"approved"}') }]);

    const result = await callAi(request, VERIFY_MODELS);

    expect(result.provider).toBe("openrouter");
    expect(calls[0].url).toContain("openrouter.ai");
  });
});

describe("images", () => {
  const image = { mimeType: "image/jpeg", base64: "AAAA", url: "https://signed.example/photo.jpg" };

  it("only considers vision-capable models", async () => {
    mockFetchSequence([{ status: 200, body: openAiReply('{"calories":420}') }]);

    const result = await callAi({ ...request, image });

    const spec = CHAT_MODELS.find((model) => model.model === result.model);
    expect(spec?.vision).toBe(true);
  });

  it("skips every text-only model when a photo is attached", async () => {
    const visionCount = CHAT_MODELS.filter((model) => model.vision).length;
    mockFetchSequence([{ status: 429, body: rateLimited }]);

    await expect(callAi({ ...request, image })).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(visionCount);
  });

  it("sends the signed URL to Groq rather than re-uploading the bytes", async () => {
    mockFetchSequence([{ status: 200, body: openAiReply("{}") }]);

    await callAi({ ...request, image });

    const content = (calls[0].body.messages as Array<{ content: unknown }>).at(-1)!.content;
    expect(JSON.stringify(content)).toContain("https://signed.example/photo.jpg");
    expect(JSON.stringify(content)).not.toContain("base64,AAAA");
  });

  it("falls back to inline bytes when the provider cannot fetch the URL", async () => {
    mockFetchSequence([
      { status: 400, body: { error: { message: "could not fetch image_url" } } },
      { status: 200, body: openAiReply("{}") },
    ]);

    const result = await callAi({ ...request, image });

    expect(result.provider).toBe("groq");
    // Same model, retried inline rather than dropped.
    expect(result.model).toBe(calls[0].body.model);
    expect(JSON.stringify(calls[1].body)).toContain("data:image/jpeg;base64,AAAA");
  });

  it("inlines the image for Gemini, which cannot fetch URLs", async () => {
    env.delete("GROQ_API_KEY");
    mockFetchSequence([{ status: 200, body: geminiReply("{}") }]);

    await callAi({ ...request, image });

    expect(JSON.stringify(calls[0].body)).toContain('"inlineData"');
    expect(JSON.stringify(calls[0].body)).not.toContain("signed.example");
  });
});

describe("request shaping", () => {
  it("puts the system prompt first for OpenAI-compatible providers", async () => {
    mockFetchSequence([{ status: 200, body: openAiReply("ok") }]);
    await callAi(request);

    const messages = calls[0].body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: request.system });
  });

  it("moves the system prompt to systemInstruction for Gemini", async () => {
    env.delete("GROQ_API_KEY");
    mockFetchSequence([{ status: 200, body: geminiReply("ok") }]);
    await callAi(request);

    expect(calls[0].body.systemInstruction).toEqual({ parts: [{ text: request.system }] });
    // Gemini names the assistant role "model".
    expect(calls[0].body.contents).toEqual([
      { role: "user", parts: [{ text: "How much protein?" }] },
    ]);
  });

  it("disables Gemini thinking so output tokens go to the answer", async () => {
    env.delete("GROQ_API_KEY");
    mockFetchSequence([{ status: 200, body: geminiReply("ok") }]);
    await callAi(request);

    const config = calls[0].body.generationConfig as { thinkingConfig: { thinkingBudget: number } };
    expect(config.thinkingConfig.thinkingBudget).toBe(0);
  });

  it("asks for JSON mode on both provider shapes when requested", async () => {
    mockFetchSequence([{ status: 200, body: openAiReply("{}") }]);
    await callAi({ ...request, json: true });
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });

    env.delete("GROQ_API_KEY");
    calls = [];
    mockFetchSequence([{ status: 200, body: geminiReply("{}") }]);
    await callAi({ ...request, json: true });
    const config = calls[0].body.generationConfig as { responseMimeType: string };
    expect(config.responseMimeType).toBe("application/json");
  });
});

describe("parseJsonLoose", () => {
  it("parses clean JSON", () => {
    expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers JSON from a fenced code block", () => {
    expect(parseJsonLoose('```json\n{"calories":420}\n```')).toEqual({ calories: 420 });
  });

  it("recovers JSON wrapped in prose", () => {
    expect(parseJsonLoose('Sure! {"verdict":"approved"} Hope that helps.')).toEqual({
      verdict: "approved",
    });
  });

  it("returns null rather than throwing on unparseable output", () => {
    expect(parseJsonLoose("I cannot answer that.")).toBeNull();
  });
});

describe("reasoning models", () => {
  it("asks a reasoning model not to think, and leaves other models alone", async () => {
    mockFetchSequence([
      { status: 429, body: rateLimited },
      { status: 429, body: rateLimited },
      { status: 200, body: openAiReply("Answer from the reasoning model.") },
    ]);

    await callAi(request);

    // First two are plain instruct models.
    expect(calls[0].body.reasoning_effort).toBeUndefined();
    expect(calls[1].body.reasoning_effort).toBeUndefined();
    // The third is qwen, which needs the flags.
    expect(calls[2].body.reasoning_effort).toBe("none");
    expect(calls[2].body.reasoning_format).toBe("hidden");
  });

  it("never shows the user a leaked <think> block", async () => {
    mockFetchSequence([
      { status: 200, body: openAiReply("<think>Let me plan this out.</think>Eat 1.6g/kg.") },
    ]);

    const result = await callAi(request);
    expect(result.text).toBe("Eat 1.6g/kg.");
  });

  it("moves on when a model spends its whole budget thinking", async () => {
    // A truncated, unclosed think block leaves nothing usable behind.
    mockFetchSequence([
      { status: 200, body: openAiReply("<think>Step 1. Consider the user's goal") },
      { status: 200, body: openAiReply("Aim for 1.6g of protein per kg.") },
    ]);

    const result = await callAi(request);
    expect(result.text).toBe("Aim for 1.6g of protein per kg.");
    expect(result.attempts).toHaveLength(1);
  });

  it("drops Gemini parts flagged as thoughts", async () => {
    env.delete("GROQ_API_KEY");
    mockFetchSequence([
      {
        status: 200,
        body: {
          candidates: [
            {
              content: {
                parts: [
                  { text: "Internal planning.", thought: true },
                  { text: "Roughly 120g of protein a day." },
                ],
              },
            },
          ],
        },
      },
    ]);

    const result = await callAi(request);
    expect(result.text).toBe("Roughly 120g of protein a day.");
  });
});

describe("cleanModelText", () => {
  it("leaves an ordinary answer untouched", () => {
    expect(cleanModelText("Eat more protein.")).toBe("Eat more protein.");
  });

  it("removes every tag spelling these models use", () => {
    expect(cleanModelText("<thinking>plan</thinking>Answer")).toBe("Answer");
    expect(cleanModelText("<reasoning>plan</reasoning>Answer")).toBe("Answer");
    expect(cleanModelText("<scratchpad>plan</scratchpad>Answer")).toBe("Answer");
  });

  it("keeps the answer that follows a stray closing tag", () => {
    expect(cleanModelText("plan text</think>The real answer.")).toBe("The real answer.");
  });

  it("returns nothing when the output is only a truncated thought", () => {
    expect(cleanModelText("<think>I should start by")).toBe("");
  });
});
