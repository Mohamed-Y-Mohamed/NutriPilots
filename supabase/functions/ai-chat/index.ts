import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { AiError, callAi, parseJsonLoose } from "../_shared/ai.ts";
import { chatSystemPrompt, PHOTO_SYSTEM_PROMPT } from "../_shared/prompts.ts";
import { dishIngredientLines, round, text } from "../_shared/coerce.ts";
import { labelFor, priceIngredients, totalsFor } from "../_shared/ingredients.ts";
import {
  historyStartDate,
  type IntakeEntry,
  needsIntakeHistory,
  summariseIntake,
} from "../_shared/intake.ts";
import { splitPlan } from "../_shared/plan.ts";
import { splitSuggestions } from "../_shared/suggestions.ts";
import { json, preflight } from "../_shared/cors.ts";
import { FUNCTION_BUILD } from "../_shared/version.ts";
import { requireUser, userClient } from "../_shared/supabase.ts";
import {
  releaseUsage,
  tryConsumeUsage,
  UsageLimitError,
  usageLimitResponse,
  type UsageState,
} from "../_shared/usage.ts";

// Written once when the isolate starts, so "is the new version actually
// deployed?" is answerable from the function logs. It used to travel back in
// every reply and be shown in Settings, which told every user which build of
// our backend they were talking to — a detail that is ours, not theirs.
console.log(`[ai-chat] build ${FUNCTION_BUILD}`);

const HISTORY_LIMIT = 12;
/**
 * The lowest daily figure a proposed plan may carry, whatever the model says.
 *
 * Lower than the 1200/1500 the prompt states, on purpose: the coach is allowed
 * below those when it has read someone's history and explains itself, which is
 * the point of asking it. It is not allowed to prescribe starvation, and this
 * is the line. Mirrored in src/lib/targetRanges.ts and by a CHECK constraint.
 */
const ABSOLUTE_FLOOR_CALORIES = 1000;
/**
 * The longest message the coach will read. Mirrored in the composer as a
 * `maxLength`, so the limit is visible while typing rather than discovered
 * afterwards — this end still truncates, because a client is not a guarantee.
 */
const MAX_MESSAGE_CHARS = 1000;
const SIGNED_URL_SECONDS = 300;

interface PhotoEstimate {
  dish_name?: unknown;
  description?: unknown;
  ingredients?: unknown;
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

  let body: { message?: unknown; imagePath?: unknown; today?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const imagePath = typeof body.imagePath === "string" ? body.imagePath : null;

  // The client sends its own calendar day because only it knows the timezone.
  // Falling back to UTC keeps an older build working, at the cost this exists
  // to avoid.
  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today)
    ? body.today
    : new Date().toISOString().slice(0, 10);
  const message = typeof body.message === "string"
    ? body.message.trim().slice(0, MAX_MESSAGE_CHARS)
    : "";

  // A photo on its own is not a message. Saying what it is costs the user a
  // second and gives the model the one piece of context a picture cannot carry
  // — "leftovers, about half of it" changes the answer more than the image does.
  if (!message) {
    return json({
      error: imagePath
        ? "Add a note saying what this is before sending the photo."
        : "Type a message first.",
    }, 400);
  }

  // A user may only ever reference a photo inside their own folder. Storage RLS
  // enforces this too; checking here turns a confusing 400 into a clear 403.
  if (imagePath && !imagePath.startsWith(`${user.id}/`)) {
    return json({ error: "That photo does not belong to you." }, 403);
  }

  // Claimed before anything expensive happens — a user who is out of calls for
  // today never reaches a model, and never reaches storage either.
  const callType = imagePath ? "vision" : "chat";
  let usage: UsageState;
  try {
    usage = await tryConsumeUsage(client, callType);
  } catch (error) {
    if (error instanceof UsageLimitError) {
      return usageLimitResponse(
        error,
        callType === "vision" ? "photo estimates" : "coach messages",
      );
    }
    console.error(
      "[ai-chat] usage check failed",
      error instanceof Error ? error.message : "unknown",
    );
    return json({ error: "Could not check your daily allowance. Please try again." }, 503);
  }

  try {
    return imagePath
      ? await handlePhoto({ client, userId: user.id, message, imagePath, usage })
      : await handleChat({ client, userId: user.id, message, today, usage });
  } catch (error) {
    if (error instanceof AiError) {
      console.error("[ai-chat] model chain failed", error.message);

      // The chain only throws once every model has been tried and none has
      // answered, so the user got nothing and nothing was spent on their
      // behalf. Their call goes back.
      await releaseUsage(user.id, callType);

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
  { client, userId, message, today, usage }: {
    client: ReturnType<typeof userClient>;
    userId: string;
    message: string;
    today: string;
    usage: UsageState;
  },
) {
  const [context, history] = await Promise.all([
    buildContext(client, userId, message, today),
    loadHistory(client, userId),
  ]);

  const result = await callAi({
    system: chatSystemPrompt(context),
    messages: [...history, { role: "user", text: message }],
    maxTokens: 700,
    temperature: 0.4,
  });

  // The two blocks are independent: a reply can name a meal to log, propose new
  // targets, both, or neither.
  const withoutPlan = splitPlan(result.text, ABSOLUTE_FLOOR_CALORIES);
  const { reply, suggestions } = splitSuggestions(withoutPlan.reply);
  const plan = withoutPlan.plan;

  const { asked, answered } = exchangeTimes();

  const { data: inserted } = await client
    .from("chat_messages")
    .insert([
      { user_id: userId, role: "user", content: message, created_at: asked },
      {
        user_id: userId,
        role: "assistant",
        content: reply,
        provider: result.provider,
        model: result.model,
        created_at: answered,
      },
    ])
    .select("id, role");

  // Which provider answered, which model, and how many were tried first are
  // recorded on the row and in the logs. They are not sent back: the app never
  // showed them, and a reply that names our AI vendor tells anyone with the
  // network tab open how the coach is built.
  return json({
    reply,
    suggestions,
    plan,
    messageId: assistantIdOf(inserted),
    usage,
  });
}


// ---------------------------------------------------------------------------
// Meal photo analysis
// ---------------------------------------------------------------------------

async function handlePhoto(
  { client, userId, message, imagePath, usage }: {
    client: ReturnType<typeof userClient>;
    userId: string;
    message: string;
    imagePath: string;
    usage: UsageState;
  },
) {
  const download = await client.storage.from("meal-photos").download(imagePath);
  if (download.error || !download.data) {
    // No model was reached, so the claimed call goes back.
    await releaseUsage(userId, "vision");
    return json({ error: "That photo could not be read. Please retake it." }, 404);
  }

  const bytes = new Uint8Array(await download.data.arrayBuffer());
  const mimeType = download.data.type || "image/jpeg";
  const base64 = encodeBase64(bytes);

  const signed = await client.storage
    .from("meal-photos")
    .createSignedUrl(imagePath, SIGNED_URL_SECONDS);

  const note = `The user said: "${message}"`;

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
      // Fifteen ingredients each carrying an amount and five per-100 figures,
      // written by a model that reasons first and is charged for the thinking
      // out of the same budget. 800 truncates it mid-object.
      maxTokens: 3000,
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

  // The model judges what is on the plate and how much of it; the nutrition is
  // worked out here from the app's own food tables, falling back to the model
  // only for ingredients it does not have. The per-100 figures go back with the
  // amounts so the user can correct a portion in the chat and watch the totals
  // follow — no second model call, and nothing is written to the diary until
  // they say so.
  const priced = isFood
    ? await priceIngredients(client, dishIngredientLines(parsed.ingredients))
    : [];

  // Food with nothing itemised would total zero, and a zero-calorie card is
  // worse than no card: it looks like an answer and logs a meal that never
  // happened. Say the photo could not be read instead.
  if (isFood && priced.length === 0) {
    // Length and provider, not the text: the body describes what somebody ate,
    // and log retention is not the place for it.
    console.error(
      `[ai-chat] photo returned no usable ingredients from ${result.provider}/${result.model}, ` +
        `${result.text.length} chars`,
    );
    return json({
      error: "The AI could not make out what was on the plate. Please try a clearer photo.",
    }, 502);
  }

  const totals = totalsFor(priced);

  const estimate = {
    dish_name: text(parsed.dish_name, "Meal", 120),
    description: text(parsed.description, "", 300),
    ingredients: priced.map(labelFor),
    lines: priced,
    calories: round(totals.calories, 0),
    protein_g: round(totals.protein, 1),
    carbs_g: round(totals.carbs, 1),
    fat_g: round(totals.fat, 1),
    fibre_g: round(totals.fibre, 1),
    confidence: confidence(parsed.confidence),
    summary: text(parsed.summary, "Visual estimate; portion size may vary.", 500),
    is_food: isFood,
  };

  const reply = isFood
    ? `${estimate.dish_name} — around ${estimate.calories} kcal. ${estimate.summary}`
    : `That photo does not look like food. ${estimate.summary}`;

  const { asked, answered } = exchangeTimes();

  const { data: messages } = await client
    .from("chat_messages")
    .insert([
      {
        user_id: userId,
        role: "user",
        content: message,
        image_path: null,
        created_at: asked,
      },
      {
        user_id: userId,
        role: "assistant",
        content: reply,
        provider: result.provider,
        model: result.model,
        estimate: isFood ? estimate : null,
        created_at: answered,
      },
    ])
    .select("id, role");

  const assistantId = assistantIdOf(messages);

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
    estimate: isFood ? estimate : null,
    analysisId: analysis?.id ?? null,
    messageId: assistantId,
    usage,
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
// Writing an exchange down
// ---------------------------------------------------------------------------

/**
 * The two timestamps a question and its answer are stored with.
 *
 * They are set here rather than left to the column default because `now()` in
 * Postgres is the *transaction* clock, not the wall clock: two rows written by
 * one INSERT get byte-identical values. Ordering by created_at then has nothing
 * to break the tie, so the transcript is free to come back with the reply above
 * the question it answers — which is exactly what it did.
 *
 * A millisecond apart is enough to make the order a fact rather than a
 * coincidence, and it is far below anything a reader could notice.
 */
function exchangeTimes(): { asked: string; answered: string } {
  const now = Date.now();
  return {
    asked: new Date(now).toISOString(),
    answered: new Date(now + 1).toISOString(),
  };
}

function assistantIdOf(rows: Array<{ id: string; role: string }> | null): string | null {
  return rows?.find((row) => row.role === "assistant")?.id ?? null;
}

// ---------------------------------------------------------------------------
// Context and history
// ---------------------------------------------------------------------------

/**
 * What the model is told about the person asking.
 *
 * The profile and today's running total are always included — they are small,
 * and almost every answer is better for knowing whether it is talking to
 * someone cutting or bulking, and what they have already eaten today.
 *
 * Two months of eating history is a different matter. It is only fetched when
 * the question genuinely needs it, so an ordinary "how much protein should I
 * eat?" never causes it to be read out of the database at all, let alone sent
 * to a third-party model.
 */
/** `back` days before `dateKey`, as another YYYY-MM-DD key. */
function shiftDate(dateKey: string, back: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

async function buildContext(
  client: ReturnType<typeof userClient>,
  userId: string,
  message: string,
  today: string,
): Promise<string> {
  const wantsHistory = needsIntakeHistory(message);

  const [profileResult, diaryResult, intakeHistory, weightResult] = await Promise.all([
    client
      .from("user_profiles")
      // One literal, not a concatenation: supabase-js reads the column list at
      // the type level and a `+` leaves it nothing to read.
      .select(
        "age, calculation_sex, height_cm, weight_kg, target_weight_kg, activity_level, goal_mode, onboarded, target_calories, target_protein_g, target_carbs_g, target_fat_g, target_fibre_g, targets_source, steps_per_day, resistance_sessions, cardio_sessions, body_fat_percent, waist_cm, training_experience, on_medication",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("diary_entries")
      .select("calories, protein, carbs, fat")
      .eq("user_id", userId)
      .eq("date", today),
    wantsHistory
      ? loadIntakeHistory(client, userId, today)
      : Promise.resolve<IntakeEntry[]>([]),
    // Weigh-ins come along regardless of the history gate: "am I losing weight"
    // is the one question that cannot be answered without them, and two
    // averages is a handful of rows rather than a month of someone's eating.
    client
      .from("weight_logs")
      .select("date, weight_kg")
      .eq("user_id", userId)
      .gte("date", shiftDate(today, 27))
      .order("date", { ascending: false }),
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

    // Steps are the one input that stops an activity level being talked up, so
    // their absence is worth stating rather than passing over in silence.
    if (profile.steps_per_day) {
      lines.push(`- Averages ${Math.round(Number(profile.steps_per_day))} steps a day`);
    } else {
      lines.push(
        "- No step count given, so the activity estimate rests on their own description and " +
          "may well be generous. Say so if the answer turns on it.",
      );
    }

    const resistance = Number(profile.resistance_sessions ?? 0);
    const cardio = Number(profile.cardio_sessions ?? 0);
    if (resistance || cardio) {
      lines.push(`- Trains ${resistance} weights and ${cardio} cardio sessions a week`);
    }
    if (profile.training_experience) {
      lines.push(`- Training experience: ${profile.training_experience}`);
    }
    if (profile.body_fat_percent) {
      lines.push(`- Body fat around ${profile.body_fat_percent}% (their own estimate, not measured)`);
    }
    if (profile.waist_cm) lines.push(`- Waist ${profile.waist_cm} cm`);

    if (profile.on_medication) {
      lines.push(
        "- ON MEDICATION that may affect appetite, weight or energy use. The app's figures do " +
          "not model that. Where it is relevant to the answer, say so plainly once and point " +
          "them at their prescriber. Never suggest changing or stopping anything.",
      );
    }

    if (profile.target_calories) {
      lines.push(
        `- Current daily targets: ${Math.round(Number(profile.target_calories))} kcal, ` +
          `${Math.round(Number(profile.target_protein_g ?? 0))}g protein, ` +
          `${Math.round(Number(profile.target_carbs_g ?? 0))}g carbs, ` +
          `${Math.round(Number(profile.target_fat_g ?? 0))}g fat, ` +
          `${Math.round(Number(profile.target_fibre_g ?? 0))}g fibre ` +
          `(set ${profile.targets_source === "coach" ? "by you, and accepted" : "by the user"}).`,
      );
    } else if (profile.onboarded) {
      lines.push(
        "- Current daily targets: worked out from the stats above by the app's own formula; " +
          "the user has not overridden them.",
      );
    } else {
      lines.push(
        "- No targets yet: the user has signed up but not filled in their goals, so there are " +
          "no body stats to work them out from. Do not quote a target, and do not guess one. " +
          "Suggest setting goals if it would help the answer.",
      );
    }
  } else {
    lines.push("- No profile saved yet. Suggest setting goals if it would help.");
  }

  /**
   * Two seven-day averages, which is the only honest way to read a scale.
   *
   * Deliberately given as averages rather than as a list of weigh-ins: handing
   * a model the raw numbers invites it to compare the newest against the oldest
   * and call a salty dinner a result.
   */
  const weighIns = new Map<string, number>(
    (weightResult.data ?? []).map((row) => [String(row.date), Number(row.weight_kg)]),
  );
  const average = (offset: number): number | null => {
    const values: number[] = [];
    for (let back = offset; back < offset + 7; back += 1) {
      const weight = weighIns.get(shiftDate(today, back));
      if (weight !== undefined) values.push(weight);
    }
    if (values.length < 3) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const thisWeek = average(0);
  const lastWeek = average(7);

  if (thisWeek !== null && lastWeek !== null) {
    const change = thisWeek - lastWeek;
    const percent = (change / lastWeek) * 100;
    lines.push(
      `- Weight trend: 7-day average ${thisWeek.toFixed(1)} kg, against ` +
        `${lastWeek.toFixed(1)} kg the week before — ${change >= 0 ? "up" : "down"} ` +
        `${Math.abs(change).toFixed(2)} kg (${Math.abs(percent).toFixed(2)}% of body weight). ` +
        "Reason from this rather than from any single weigh-in.",
    );
  } else if (weighIns.size > 0) {
    lines.push(
      `- Only ${weighIns.size} weigh-in(s) in the last four weeks — not enough for a trend. ` +
        "Encourage daily morning weigh-ins if the question depends on one.",
    );
  } else {
    lines.push(
      "- No weigh-ins recorded, so there is no trend to reason from and no way to check the " +
        "app's own estimate against reality. Suggest logging weight if the question needs it.",
    );
  }

  lines.push(
    `- Logged so far today: ${Math.round(totals.calories)} kcal, ` +
      `${Math.round(totals.protein)}g protein, ${Math.round(totals.carbs)}g carbs, ` +
      `${Math.round(totals.fat)}g fat across ${entries.length} item(s).`,
  );

  if (wantsHistory) {
    const summary = summariseIntake(intakeHistory, today);
    if (summary) lines.push("", summary);
  }

  return lines.join("\n");
}

/**
 * Two months of daily figures. Only ever called when the question needs them,
 * so an ordinary nutrition question leaves no trace of the user's diary here.
 */
async function loadIntakeHistory(
  client: ReturnType<typeof userClient>,
  userId: string,
  today: string,
): Promise<IntakeEntry[]> {
  const { data, error } = await client
    .from("diary_entries")
    .select("date, calories, protein, carbs, fat")
    .eq("user_id", userId)
    .gte("date", historyStartDate(today))
    .lte("date", today);

  if (error) {
    // A coach answering from the profile alone beats one that fails outright.
    console.error("[ai-chat] intake history unavailable", error.message);
    return [];
  }
  return (data ?? []) as IntakeEntry[];
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
    // Rows written before exchangeTimes() existed still share a timestamp, and
    // a model shown its own reply above the question it answered starts the
    // next turn confused. Ascending role puts "assistant" first here, which is
    // "user" first once the page is reversed below — the order it happened in.
    .order("role", { ascending: true })
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

function confidence(value: unknown): "low" | "medium" | "high" {
  return value === "high" || value === "medium" ? value : "low";
}
