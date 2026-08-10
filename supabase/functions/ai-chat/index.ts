import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { AiError, callAi, parseJsonLoose } from "../_shared/ai.ts";
import { chatSystemPrompt, PHOTO_SYSTEM_PROMPT } from "../_shared/prompts.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, userClient } from "../_shared/supabase.ts";

const HISTORY_LIMIT = 12;
const MAX_MESSAGE_CHARS = 2000;
const SIGNED_URL_SECONDS = 300;

interface PhotoEstimate {
  dish_name?: unknown;
  description?: unknown;
  ingredients?: unknown;
  calories?: unknown;
  protein_g?: unknown;
  carbs_g?: unknown;
  fat_g?: unknown;
  fibre_g?: unknown;
  confidence?: unknown;
  summary?: unknown;
  is_food?: unknown;
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authed = await requireUser(request);
  if (!authed) return json({ error: "Please sign in to use the AI coach." }, 401);

  const { user, authorization } = authed;
  const client = userClient(authorization);

  let body: { message?: unknown; imagePath?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const imagePath = typeof body.imagePath === "string" ? body.imagePath : null;
  const message = typeof body.message === "string"
    ? body.message.trim().slice(0, MAX_MESSAGE_CHARS)
    : "";

  if (!message && !imagePath) {
    return json({ error: "Send a message or a photo." }, 400);
  }

  // A user may only ever reference a photo inside their own folder. Storage RLS
  // enforces this too; checking here turns a confusing 400 into a clear 403.
  if (imagePath && !imagePath.startsWith(`${user.id}/`)) {
    return json({ error: "That photo does not belong to you." }, 403);
  }

  try {
    return imagePath
      ? await handlePhoto({ client, userId: user.id, message, imagePath })
      : await handleChat({ client, userId: user.id, message });
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[ai-chat] model chain failed", error.message);

      // 429 means every model on every provider is out of quota. Anything else
      // is a transient fault the user should simply retry.
      if (error.status === 429) {
        return json({
          error:
            "You have reached today's AI limit. The coach will be back tomorrow — everything else in the app still works.",
          code: "daily_limit",
        }, 429);
      }

      return json({
        error: "The AI coach could not answer that. Please try again.",
      }, 502);
    }
    console.error(
      "[ai-chat] unexpected",
      error instanceof Error ? error.message : "unknown",
    );
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
});

// ---------------------------------------------------------------------------
// Text conversation
// ---------------------------------------------------------------------------

async function handleChat(
  { client, userId, message }: {
    client: ReturnType<typeof userClient>;
    userId: string;
    message: string;
  },
) {
  const [context, history] = await Promise.all([
    buildContext(client, userId),
    loadHistory(client, userId),
  ]);

  const result = await callAi({
    system: chatSystemPrompt(context),
    messages: [...history, { role: "user", text: message }],
    maxTokens: 700,
    temperature: 0.4,
  });

  const { reply, suggestions } = splitSuggestions(result.text);

  const { data: inserted } = await client
    .from("chat_messages")
    .insert([
      { user_id: userId, role: "user", content: message },
      {
        user_id: userId,
        role: "assistant",
        content: reply,
        provider: result.provider,
        model: result.model,
      },
    ])
    .select("id, role, created_at");

  return json({
    reply,
    suggestions,
    provider: result.provider,
    model: result.model,
    attempts: result.attempts,
    messageIds: (inserted ?? []).map((row) => row.id),
  });
}

/**
 * Pulls the machine-readable meal block off the end of a reply. The user sees
 * prose; the app gets something it can write to the diary. A malformed block is
 * dropped rather than shown, because a stray bracket in the chat would be worse
 * than a missing button.
 */
export function splitSuggestions(raw: string): {
  reply: string;
  suggestions: Array<Record<string, unknown>>;
} {
  const match = raw.match(/<<<LOG([\s\S]*?)LOG>>>/);
  if (!match) return { reply: raw.trim(), suggestions: [] };

  const reply = raw.replace(match[0], "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    return { reply, suggestions: [] };
  }

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

// ---------------------------------------------------------------------------
// Meal photo analysis
// ---------------------------------------------------------------------------

async function handlePhoto(
  { client, userId, message, imagePath }: {
    client: ReturnType<typeof userClient>;
    userId: string;
    message: string;
    imagePath: string;
  },
) {
  const download = await client.storage.from("meal-photos").download(imagePath);
  if (download.error || !download.data) {
    return json({ error: "That photo could not be read. Please retake it." }, 404);
  }

  const bytes = new Uint8Array(await download.data.arrayBuffer());
  const mimeType = download.data.type || "image/jpeg";
  const base64 = encodeBase64(bytes);

  const signed = await client.storage
    .from("meal-photos")
    .createSignedUrl(imagePath, SIGNED_URL_SECONDS);

  const note = message
    ? `The user added this note: "${message}"`
    : "The user added no note.";

  let result;
  try {
    result = await callAi({
      system: PHOTO_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        text: `Estimate the nutrition of this meal. ${note}`,
      }],
      image: { mimeType, base64, url: signed.data?.signedUrl },
      json: true,
      maxTokens: 800,
      temperature: 0.2,
    });
  } finally {
    // The photo has served its purpose the moment the request completes —
    // including when it fails. It must not linger in storage either way.
    await deletePhoto(client, imagePath);
  }

  const parsed = parseJsonLoose<PhotoEstimate>(result.text);
  if (!parsed) {
    return json({ error: "The AI could not read that photo. Please try a clearer one." }, 502);
  }

  const isFood = parsed.is_food !== false;
  const estimate = {
    dish_name: text(parsed.dish_name, "Meal", 120),
    description: text(parsed.description, "", 300),
    ingredients: ingredientList(parsed.ingredients),
    calories: round(parsed.calories, 0),
    protein_g: round(parsed.protein_g, 1),
    carbs_g: round(parsed.carbs_g, 1),
    fat_g: round(parsed.fat_g, 1),
    fibre_g: round(parsed.fibre_g, 1),
    confidence: confidence(parsed.confidence),
    summary: text(parsed.summary, "Visual estimate; portion size may vary.", 500),
    is_food: isFood,
  };

  const reply = isFood
    ? `${estimate.dish_name} — around ${estimate.calories} kcal. ${estimate.summary}`
    : `That photo does not look like food. ${estimate.summary}`;

  const { data: messages } = await client
    .from("chat_messages")
    .insert([
      {
        user_id: userId,
        role: "user",
        content: message || "Estimate the nutrition in this meal.",
        image_path: null,
      },
      {
        user_id: userId,
        role: "assistant",
        content: reply,
        provider: result.provider,
        model: result.model,
        estimate: isFood ? estimate : null,
      },
    ])
    .select("id, role");

  const assistantId =
    (messages ?? []).find((row) => row.role === "assistant")?.id ?? null;

  // Keep a text record of what the photo contained for 30 days. The image
  // itself is already gone.
  const { data: analysis } = await client
    .from("meal_photo_analyses")
    .insert({
      user_id: userId,
      chat_message_id: assistantId,
      storage_path: imagePath,
      description: estimate.description || estimate.dish_name,
      analysis: estimate,
      provider: result.provider,
      model: result.model,
      image_deleted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  return json({
    reply,
    provider: result.provider,
    model: result.model,
    attempts: result.attempts,
    estimate: isFood ? estimate : null,
    analysisId: analysis?.id ?? null,
    messageId: assistantId,
  });
}

async function deletePhoto(
  client: ReturnType<typeof userClient>,
  imagePath: string,
) {
  const { error } = await client.storage.from("meal-photos").remove([imagePath]);
  if (error) console.error("[ai-chat] failed to delete photo", error.message);
}

// ---------------------------------------------------------------------------
// Context and history
// ---------------------------------------------------------------------------

async function buildContext(
  client: ReturnType<typeof userClient>,
  userId: string,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);

  const [profileResult, diaryResult] = await Promise.all([
    client
      .from("user_profiles")
      .select("age, calculation_sex, height_cm, weight_kg, target_weight_kg, activity_level, goal_mode")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("diary_entries")
      .select("calories, protein, carbs, fat")
      .eq("user_id", userId)
      .eq("date", today),
  ]);

  const profile = profileResult.data;
  const entries = diaryResult.data ?? [];

  const totals = entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + Number(entry.calories ?? 0),
      protein: sum.protein + Number(entry.protein ?? 0),
      carbs: sum.carbs + Number(entry.carbs ?? 0),
      fat: sum.fat + Number(entry.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const lines = ["ABOUT THIS USER (use it, do not recite it back):"];

  if (profile) {
    if (profile.age) lines.push(`- Age ${profile.age}`);
    if (profile.calculation_sex) lines.push(`- Sex used for calculations: ${profile.calculation_sex}`);
    if (profile.height_cm) lines.push(`- Height ${profile.height_cm} cm`);
    if (profile.weight_kg) lines.push(`- Current weight ${profile.weight_kg} kg`);
    if (profile.target_weight_kg) lines.push(`- Target weight ${profile.target_weight_kg} kg`);
    if (profile.activity_level) lines.push(`- Activity level: ${profile.activity_level}`);
    if (profile.goal_mode) lines.push(`- Goal: ${profile.goal_mode}`);
  } else {
    lines.push("- No profile saved yet. Suggest setting goals if it would help.");
  }

  lines.push(
    `- Logged so far today: ${Math.round(totals.calories)} kcal, ` +
      `${Math.round(totals.protein)}g protein, ${Math.round(totals.carbs)}g carbs, ` +
      `${Math.round(totals.fat)}g fat across ${entries.length} item(s).`,
  );

  return lines.join("\n");
}

async function loadHistory(
  client: ReturnType<typeof userClient>,
  userId: string,
): Promise<Array<{ role: "user" | "assistant"; text: string }>> {
  const { data } = await client
    .from("chat_messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  return (data ?? [])
    .reverse()
    .filter((row) => typeof row.content === "string" && row.content.trim())
    .map((row) => ({
      role: row.role === "assistant" ? "assistant" as const : "user" as const,
      text: row.content as string,
    }));
}

// ---------------------------------------------------------------------------

function round(value: unknown, decimals: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function text(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
}

/** What the calorie figure is based on, so the user can check the assumptions. */
function ingredientList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 120))
    .slice(0, 20);
}

function confidence(value: unknown): "low" | "medium" | "high" {
  return value === "high" || value === "medium" ? value : "low";
}
