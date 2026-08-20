import { localDateKey } from "../lib/dates";
import { requireSupabase } from "../lib/supabase";
import type {
  AiProvider,
  ChatMessage,
  CoachPlan,
  MealEstimate,
  MealSuggestion,
  UsageCallType,
  UsageState,
} from "../types";

/** Remembered so Settings can show which function build actually answered. */
export let lastFunctionBuild: string | null = null;

/**
 * An Edge Function that answered with an error body.
 *
 * It carries the parsed payload as well as the message so a caller that needs
 * more than the text — the daily allowance, say — can read it without a second
 * request. Existing callers are unaffected: `reason.message` still works.
 */
export class FunctionError extends Error {
  constructor(message: string, readonly payload: unknown) {
    super(message);
    this.name = "FunctionError";
  }
}

export interface AiChatResponse {
  /** Version marker from the deployed Edge Function. */
  build?: string;
  reply: string;
  provider: AiProvider;
  model: string;
  /** Models tried and exhausted before one answered. */
  attempts: string[];
  estimate?: MealEstimate | null;
  /** Meals named in the reply, ready to be reviewed and logged. */
  suggestions?: MealSuggestion[];
  /** New daily targets the coach proposed. Applied only if the user accepts. */
  plan?: CoachPlan | null;
  analysisId?: string | null;
  messageId?: string | null;
  /** What is left of today's allowance for whichever bucket this call used. */
  usage?: UsageState;
}

/**
 * Every Edge Function call goes through here so error handling is identical.
 * `functions.invoke` swallows the response body on non-2xx, so it is unwrapped
 * manually — otherwise the user sees "Edge Function returned a non-2xx status"
 * instead of the real reason.
 */
export async function invokeFunction<T>(name: string, body: unknown): Promise<T> {
  const client = requireSupabase();

  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Please sign in first.");

  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    // A browser reports an undeployed function as "Failed to fetch": Supabase's
    // router answers the CORS preflight for an unknown function without
    // allowing `content-type`, so the request is blocked before the 404 is ever
    // readable. Say something the reader can act on instead.
    throw new Error(
      `Could not reach the "${name}" service. It may not be deployed yet, or you may be offline.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status}).`;
    throw new FunctionError(message, payload);
  }

  return payload as T;
}

/**
 * How much of today's allowance is left, before the user has sent anything.
 * Read straight from the database rather than through a function: it is a
 * plain lookup and needs no AI, so it should not cost a function invocation.
 */
export async function getAiUsage(callType: UsageCallType): Promise<UsageState> {
  const { data, error } = await requireSupabase()
    .rpc("get_ai_usage", { p_call_type: callType })
    .single();

  if (error) throw new Error(error.message);

  const row = data as { used: number; daily_limit: number; resets_at: string };
  return {
    callType,
    used: row.used,
    dailyLimit: row.daily_limit,
    resetsAt: row.resets_at,
  };
}

export async function sendChatMessage(
  message: string,
  imagePath?: string,
): Promise<AiChatResponse> {
  // The diary is written with the user's local calendar day, so the coach has
  // to ask about the same one. A server deriving "today" from its own UTC clock
  // tells anyone west of UTC they have eaten nothing, every evening, from the
  // moment UTC rolls over until their own midnight.
  const response = await invokeFunction<AiChatResponse>("ai-chat", {
    message,
    imagePath,
    today: localDateKey(),
  });
  if (response.build) {
    lastFunctionBuild = response.build;
    try {
      localStorage.setItem("nutripilot.functionBuild", response.build);
    } catch {
      // Reporting the build is a convenience, never a requirement.
    }
  }
  return response;
}

/** Uploads to the private bucket under the user's own folder. */
export async function uploadMealPhoto(userId: string, blob: Blob): Promise<string> {
  const client = requireSupabase();
  const path = `${userId}/${crypto.randomUUID()}.jpg`;

  const { error } = await client.storage
    .from("meal-photos")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });

  if (error) throw new Error(`Could not upload the photo: ${error.message}`);
  return path;
}

/** PostgREST's code for "you asked for a column this table does not have". */
const UNDEFINED_COLUMN = "42703";

const CHAT_FIELDS = "id,role,content,estimate,provider,model,created_at,logged_at";
/** The same list for a database that predates the logged_at migration. */
const CHAT_FIELDS_WITHOUT_LOGGED = "id,role,content,estimate,provider,model,created_at";

export async function loadChatHistory(limit = 60): Promise<ChatMessage[]> {
  const client = requireSupabase();
  const read = (fields: string) =>
    client
      .from("chat_messages")
      .select(fields)
      .order("created_at", { ascending: false })
      .limit(limit);

  let { data, error } = await read(CHAT_FIELDS);

  // Losing the record of what was already logged is a card that offers twice;
  // failing outright is a coach with no conversation in it at all.
  if (error?.code === UNDEFINED_COLUMN) {
    console.warn(
      "[coach] chat_messages.logged_at is missing — run the chat_message_logged_at " +
        "migration, or an estimate already added to the diary will be offered again.",
    );
    ({ data, error } = await read(CHAT_FIELDS_WITHOUT_LOGGED));
  }

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as Array<Record<string, unknown>>)
    .reverse()
    .map((row) => ({
      id: row.id as string,
      role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
      text: (row.content as string) ?? "",
      estimate: (row.estimate as MealEstimate | null) ?? null,
      provider: (row.provider as AiProvider | null) ?? null,
      createdAt: row.created_at as string,
      // Without this the card comes back after a reload offering a meal that
      // is already in the diary, and accepting it logs the meal twice.
      loggedAt: (row.logged_at as string | null) ?? undefined,
    }));
}

/**
 * Records that the user accepted this message's estimate.
 *
 * Best effort on purpose: the food is already in the diary by the time this
 * runs, and failing here must not make it look as though it is not. The worst
 * case is the card offering again after a reload, which is where it started.
 */
export async function markEstimateLogged(messageId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("chat_messages")
    .update({ logged_at: new Date().toISOString() })
    .eq("id", messageId);

  if (error) console.warn("[coach] could not mark the estimate as logged:", error.message);
}

export async function clearChatHistory(userId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("chat_messages")
    .delete()
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function clearMealPhotoRecords(userId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from("meal_photo_analyses")
    .delete()
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function deleteAccount(): Promise<void> {
  await invokeFunction<{ deleted: boolean }>("delete-account", { confirm: "DELETE" });
}
