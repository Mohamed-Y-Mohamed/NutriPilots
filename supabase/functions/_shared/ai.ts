/**
 * The single AI boundary for NutriPilot.
 *
 * Requests walk a chain of models. Within a provider the chain steps down
 * through that provider's models first, so a single model running out of free
 * quota costs a retry, not the whole provider. Only when every model on a
 * provider is exhausted does it move to the next vendor.
 *
 *   chat        Groq  →  Gemini          (keeps the user's conversation alive)
 *   verify      OpenRouter → Groq        (kept off the chat quotas entirely)
 *
 * Nothing above this module knows which vendor answered.
 */

export type ProviderName = "groq" | "gemini" | "openrouter";

export interface ModelSpec {
  provider: ProviderName;
  model: string;
  /** Only vision models are considered when the request carries an image. */
  vision: boolean;
}

export interface AiMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AiImage {
  mimeType: string;
  /** Base64 without the `data:` prefix. Required — Gemini cannot fetch URLs. */
  base64: string;
  /** Signed URL, preferred by OpenAI-compatible providers. */
  url?: string;
}

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  image?: AiImage;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}

export interface AiResult {
  text: string;
  provider: ProviderName;
  model: string;
  /** Models tried and exhausted before this one answered. */
  attempts: string[];
}

/**
 * Chat: fastest and most capable first, then progressively cheaper models that
 * usually still have free quota left.
 */
export const CHAT_MODELS: ModelSpec[] = [
  { provider: "groq", model: "qwen/qwen3.6-27b", vision: true },
  { provider: "groq", model: "llama-3.3-70b-versatile", vision: false },
  { provider: "groq", model: "openai/gpt-oss-120b", vision: false },
  { provider: "groq", model: "openai/gpt-oss-20b", vision: false },
  { provider: "groq", model: "llama-3.1-8b-instant", vision: false },
  { provider: "gemini", model: "gemini-2.5-flash", vision: true },
  { provider: "gemini", model: "gemini-2.5-flash-lite", vision: true },
  { provider: "gemini", model: "gemini-3.6-flash", vision: true },
];

/**
 * Verification runs on OpenRouter's free tier so that adding foods never eats
 * into the quota the chat depends on. Groq is only a last resort.
 */
export const VERIFY_MODELS: ModelSpec[] = [
  { provider: "openrouter", model: "openai/gpt-oss-20b:free", vision: false },
  { provider: "openrouter", model: "google/gemma-4-31b-it:free", vision: true },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", vision: false },
  { provider: "openrouter", model: "inclusionai/ling-3.0-tiny:free", vision: false },
  { provider: "groq", model: "llama-3.1-8b-instant", vision: false },
];

const ENDPOINTS = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
} as const;

const KEY_NAMES: Record<ProviderName, string> = {
  groq: "GROQ_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/**
 * A model is exhausted (not broken) when it rate limits, runs out of credit,
 * is decommissioned, or falls over. Those are worth retrying elsewhere. A plain
 * 400 means the request itself is wrong, so trying again would only fail again.
 */
function isRetryable(status: number, body: string): boolean {
  if (status === 429 || status === 402 || status === 408 || status === 404) return true;
  if (status >= 500) return true;
  if (status === 403 && /quota|billing|permission/i.test(body)) return true;
  return /rate.?limit|quota|insufficient|over.?capacity|overloaded|exhausted|decommission|not.?found|unavailable/i
    .test(body);
}

export async function callAi(
  request: AiRequest,
  chain: ModelSpec[] = CHAT_MODELS,
): Promise<AiResult> {
  const needsVision = Boolean(request.image);

  const usable = chain.filter(
    (spec) => (!needsVision || spec.vision) && Boolean(Deno.env.get(KEY_NAMES[spec.provider])),
  );

  if (usable.length === 0) {
    throw new AiError(
      needsVision
        ? "No vision-capable AI model is configured on the server."
        : "No AI provider is configured on the server.",
      503,
      false,
    );
  }

  const attempts: string[] = [];
  let lastError: unknown;

  for (const spec of usable) {
    const apiKey = Deno.env.get(KEY_NAMES[spec.provider])!;
    try {
      const text = spec.provider === "gemini"
        ? await callGemini(spec, request, apiKey)
        : await callOpenAiCompatible(spec, request, apiKey);

      return { text, provider: spec.provider, model: spec.model, attempts };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof AiError ? error.retryable : true;
      console.error(
        `[ai] ${spec.provider}/${spec.model} failed:`,
        error instanceof Error ? error.message.slice(0, 200) : "unknown",
        `retryable=${retryable}`,
      );
      if (!retryable) throw error;
      attempts.push(`${spec.provider}/${spec.model}`);
    }
  }

  // Every model was tried and every one was exhausted or unreachable. That is
  // the only case the user ever hears about — individual model switches are
  // silent by design. The last failure is carried through so the logs say why.
  const cause = lastError instanceof Error ? lastError.message.slice(0, 200) : "unknown";
  throw new AiError(
    `All ${attempts.length} models exhausted (${attempts.join(", ")}); last: ${cause}`,
    429,
    false,
  );
}

// ---------------------------------------------------------------------------
// Groq and OpenRouter (both OpenAI-compatible)
// ---------------------------------------------------------------------------

async function callOpenAiCompatible(
  spec: ModelSpec,
  request: AiRequest,
  apiKey: string,
): Promise<string> {
  // Prefer the signed URL so image bytes stay out of the request body. If the
  // provider cannot fetch it, retry once inline before giving up on this model.
  if (request.image?.url) {
    try {
      return await openAiRequest(spec, request, apiKey, request.image.url);
    } catch (error) {
      if (!(error instanceof AiError) || error.status !== 400) throw error;
      console.error(`[ai] ${spec.model} could not fetch the signed URL, retrying inline`);
    }
  }

  const inline = request.image
    ? `data:${request.image.mimeType};base64,${request.image.base64}`
    : undefined;
  return await openAiRequest(spec, request, apiKey, inline);
}

async function openAiRequest(
  spec: ModelSpec,
  request: AiRequest,
  apiKey: string,
  imageUrl?: string,
): Promise<string> {
  const messages: unknown[] = [{ role: "system", content: request.system }];

  request.messages.forEach((message, index) => {
    const isLast = index === request.messages.length - 1;
    if (isLast && message.role === "user" && imageUrl) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: message.text },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      });
    } else {
      messages.push({ role: message.role, content: message.text });
    }
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (spec.provider === "openrouter") {
    // OpenRouter asks callers to identify themselves for free-tier accounting.
    headers["HTTP-Referer"] = "https://nutripilot.app";
    headers["X-Title"] = "NutriPilot";
  }

  const response = await fetchWithTimeout(ENDPOINTS[spec.provider as "groq" | "openrouter"], {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: spec.model,
      messages,
      temperature: request.temperature ?? 0.3,
      max_completion_tokens: request.maxTokens ?? 900,
      ...(request.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AiError(
      `${spec.provider} ${response.status}: ${body.slice(0, 300)}`,
      response.status,
      isRetryable(response.status, body),
    );
  }

  const completion = await response.json();

  // OpenRouter returns 200 with an error body when an upstream model fails.
  if (completion?.error) {
    const message = String(completion.error.message ?? "upstream error");
    throw new AiError(`${spec.provider}: ${message}`, 502, isRetryable(502, message));
  }

  const text = completion?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new AiError(`${spec.model} returned an empty response.`, 502, true);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

async function callGemini(
  spec: ModelSpec,
  request: AiRequest,
  apiKey: string,
): Promise<string> {
  const contents = request.messages.map((message, index) => {
    const isLast = index === request.messages.length - 1;
    const parts: unknown[] = [{ text: message.text }];
    if (isLast && message.role === "user" && request.image) {
      parts.push({
        inlineData: { mimeType: request.image.mimeType, data: request.image.base64 },
      });
    }
    return { role: message.role === "assistant" ? "model" : "user", parts };
  });

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${spec.model}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: request.system }] },
        generationConfig: {
          temperature: request.temperature ?? 0.3,
          maxOutputTokens: request.maxTokens ?? 900,
          // Thinking burns output tokens we do not need for short answers.
          thinkingConfig: { thinkingBudget: 0 },
          ...(request.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new AiError(
      `gemini ${response.status}: ${body.slice(0, 300)}`,
      response.status,
      isRetryable(response.status, body),
    );
  }

  const completion = await response.json();
  const parts = completion?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((part: { text?: string }) => part?.text ?? "").join("")
    : "";

  if (!text.trim()) {
    const reason = completion?.candidates?.[0]?.finishReason ?? "unknown";
    throw new AiError(`${spec.model} returned no text (${reason}).`, 502, true);
  }
  return text;
}

// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 45_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new AiError(
      `Network failure: ${error instanceof Error ? error.message : "unknown"}`,
      504,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Models sometimes wrap JSON in prose or a fenced block. Recover it. */
export function parseJsonLoose<T>(raw: string): T | null {
  const candidates = [raw];

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);

  const braced = raw.match(/\{[\s\S]*\}/);
  if (braced) candidates.push(braced[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim()) as T;
    } catch {
      continue;
    }
  }
  return null;
}
