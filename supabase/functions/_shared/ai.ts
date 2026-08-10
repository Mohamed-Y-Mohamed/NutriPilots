/**
 * The single AI boundary for NutriPilot.
 *
 * Three providers, all reachable through an OpenAI-compatible endpoint:
 *
 *   chat / photos   Groq  →  OpenRouter free tier  →  Cloudflare Workers AI
 *   verification    OpenRouter free tier  →  Cloudflare  →  Groq
 *
 * Verification runs on the opposite provider so adding a food never eats the
 * quota the conversation depends on. Within a provider the chain steps down
 * through that provider's models first, so one model running out of free quota
 * costs a retry rather than the whole provider.
 *
 * Gemini was removed deliberately: `gemini-2.5-*` now returns 404 "no longer
 * available to new users", and the 3.x models reject the thinking config the
 * older ones required, so the whole fallback was silently dead.
 *
 * Nothing above this module knows which vendor answered.
 */

export type ProviderName = "groq" | "openrouter" | "cloudflare";

export interface ModelSpec {
  provider: ProviderName;
  model: string;
  /** Only vision models are considered when the request carries an image. */
  vision: boolean;
  /**
   * Reasoning models emit a <think> block and will happily spend the entire
   * output budget on it. They need to be told not to.
   */
  reasoning?: boolean;
}

export interface AiMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AiImage {
  mimeType: string;
  /** Base64 without the `data:` prefix. */
  base64: string;
  /** Signed URL, preferred so the bytes stay out of the request body. */
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
 * Groq answers first — it is by far the fastest. `qwen3.6-27b` is in the list
 * only because it is Groq's sole vision model; it is a reasoning model and
 * needs the flags below to produce an answer rather than a monologue.
 *
 * Every model below was called against its live API and returned a usable
 * reply. The notable absentees, and why:
 *   google/gemma-4-31b-it:free            errors on every call
 *   inclusionai/ling-3.0-tiny:free        returns an empty body
 *   @cf/openai/gpt-oss-20b                200 with no message content
 *   @cf/meta/llama-3.2-11b-vision-instruct  403 until a model agreement is
 *                                           accepted in the Cloudflare console
 */
export const CHAT_MODELS: ModelSpec[] = [
  { provider: "groq", model: "llama-3.3-70b-versatile", vision: false },
  { provider: "groq", model: "openai/gpt-oss-120b", vision: false },
  { provider: "groq", model: "qwen/qwen3.6-27b", vision: true, reasoning: true },
  { provider: "groq", model: "openai/gpt-oss-20b", vision: false },
  { provider: "groq", model: "llama-3.1-8b-instant", vision: false },
  { provider: "openrouter", model: "openai/gpt-oss-20b:free", vision: false },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", vision: false },
  { provider: "openrouter", model: "nvidia/nemotron-nano-9b-v2:free", vision: false },
  // Last-resort vision fallback. Slow and often unavailable, but a photo that
  // Groq cannot take is better served by a slow answer than by no answer.
  { provider: "openrouter", model: "nvidia/nemotron-nano-12b-v2-vl:free", vision: true },
  { provider: "cloudflare", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", vision: false },
  { provider: "cloudflare", model: "@cf/meta/llama-4-scout-17b-16e-instruct", vision: true },
  { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct-fp8", vision: false },
];

/** Verification is kept off the chat quota entirely. */
export const VERIFY_MODELS: ModelSpec[] = [
  { provider: "openrouter", model: "openai/gpt-oss-20b:free", vision: false },
  { provider: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free", vision: false },
  { provider: "openrouter", model: "nvidia/nemotron-nano-9b-v2:free", vision: false },
  { provider: "cloudflare", model: "@cf/meta/llama-3.1-8b-instruct-fp8", vision: false },
  { provider: "groq", model: "llama-3.1-8b-instant", vision: false },
];

const KEY_NAMES: Record<ProviderName, string> = {
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  cloudflare: "CLOUDFLARE_API_TOKEN",
};

/**
 * Cloudflare's URL carries the account id, so endpoints are resolved rather
 * than looked up. Its OpenAI-compatible route means one request shape serves
 * all three providers.
 */
function endpointFor(provider: ProviderName): string {
  switch (provider) {
    case "groq":
      return "https://api.groq.com/openai/v1/chat/completions";
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "cloudflare":
      return `https://api.cloudflare.com/client/v4/accounts/${
        Deno.env.get("CLOUDFLARE_ACCOUNT_ID")
      }/ai/v1/chat/completions`;
  }
}

/** Cloudflare needs an account id as well as a token; the others need only a key. */
function isConfigured(provider: ProviderName): boolean {
  if (!Deno.env.get(KEY_NAMES[provider])) return false;
  if (provider === "cloudflare") return Boolean(Deno.env.get("CLOUDFLARE_ACCOUNT_ID"));
  return true;
}

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
 * is decommissioned, or falls over. Those are worth retrying anywhere. A plain
 * 400 means this provider rejected the request itself, so its sibling models
 * will reject it identically — but a different vendor may well accept it.
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
    (spec) => (!needsVision || spec.vision) && isConfigured(spec.provider),
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
  const rejectedProviders = new Set<ProviderName>();
  let lastError: unknown;

  for (const spec of usable) {
    // A provider that rejected the request outright will reject it again on
    // every sibling model. Skip to the next vendor instead of hammering it.
    if (rejectedProviders.has(spec.provider)) continue;

    const apiKey = Deno.env.get(KEY_NAMES[spec.provider])!;
    try {
      const text = await callProvider(spec, request, apiKey);
      return { text, provider: spec.provider, model: spec.model, attempts };
    } catch (error) {
      lastError = error;
      const retryable = error instanceof AiError ? error.retryable : true;

      console.error(
        `[ai] ${spec.provider}/${spec.model} failed:`,
        error instanceof Error ? error.message.slice(0, 200) : "unknown",
        `retryable=${retryable}`,
      );

      if (!retryable) rejectedProviders.add(spec.provider);
      attempts.push(`${spec.provider}/${spec.model}`);
    }
  }

  // Every model was tried and every one failed. That is the only case the user
  // ever hears about — individual model switches are silent by design. The last
  // failure is carried through so the logs say why.
  const cause = lastError instanceof Error ? lastError.message.slice(0, 200) : "unknown";
  throw new AiError(
    `All ${attempts.length} models exhausted (${attempts.join(", ")}); last: ${cause}`,
    429,
    false,
  );
}

// ---------------------------------------------------------------------------

async function callProvider(
  spec: ModelSpec,
  request: AiRequest,
  apiKey: string,
): Promise<string> {
  // Prefer the signed URL so image bytes stay out of the request body. If the
  // provider cannot fetch it, retry once inline before giving up on this model.
  if (request.image?.url) {
    try {
      return await chatCompletion(spec, request, apiKey, request.image.url);
    } catch (error) {
      if (!(error instanceof AiError) || error.status !== 400) throw error;
      console.error(`[ai] ${spec.model} could not use the signed URL, retrying inline`);
    }
  }

  const inline = request.image
    ? `data:${request.image.mimeType};base64,${request.image.base64}`
    : undefined;
  return await chatCompletion(spec, request, apiKey, inline);
}

async function chatCompletion(
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

  const response = await fetchWithTimeout(endpointFor(spec.provider), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: spec.model,
      messages,
      temperature: request.temperature ?? 0.3,
      max_completion_tokens: request.maxTokens ?? 900,
      // A reasoning model left alone spends the whole output budget thinking
      // and returns a truncated <think> block instead of an answer. Both flags
      // are sent because providers differ in which one they honour.
      ...(spec.reasoning ? { reasoning_format: "hidden", reasoning_effort: "none" } : {}),
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
    throw new AiError(`${spec.provider}: ${message}`, 502, true);
  }

  const raw = completion?.choices?.[0]?.message?.content;
  const text = cleanModelText(typeof raw === "string" ? raw : "");

  if (!text) {
    // Usually a reasoning model that spent its whole budget thinking. The next
    // model gets a turn rather than the user getting a wall of monologue.
    const reason = completion?.choices?.[0]?.finish_reason ?? "unknown";
    throw new AiError(
      `${spec.model} returned no usable answer (finish_reason=${reason}).`,
      502,
      true,
    );
  }
  return text;
}

/**
 * Strips a model's internal monologue. Reasoning models are asked not to emit
 * one, but the flags are not honoured identically everywhere, so the output is
 * cleaned defensively — a user must never see the prompt scaffolding.
 */
export function cleanModelText(raw: string): string {
  let text = raw;

  // Complete blocks, in any of the tag spellings these models use.
  text = text.replace(/<(think|thinking|reasoning|scratchpad|analysis)>[\s\S]*?<\/\1>/gi, "");

  // A stray closer leaves the real answer after it.
  const closer = text.search(/<\/(think|thinking|reasoning|scratchpad|analysis)>/i);
  if (closer !== -1) {
    text = text.slice(text.indexOf(">", closer) + 1);
  }

  // An unclosed opener means the answer was truncated mid-thought: nothing
  // after it is usable.
  text = text.replace(/<(think|thinking|reasoning|scratchpad|analysis)>[\s\S]*$/i, "");

  return text.trim();
}

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
