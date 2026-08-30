import { localDateKey } from "../lib/dates";
import { serverMessage, userError, UserFacingError } from "../lib/errors";
import { requireSupabase } from "../lib/supabase";
import type {
  ChatMessage,
  CoachPlan,
  MealEstimate,
  MealSuggestion,
  UsageCallType,
  UsageState,
} from "../types";

/**
 * A server call that answered with an error body.
 *
 * It extends UserFacingError because the server writes these for the reader: an
 * error field coming back from our own API is already a sentence someone is
 * meant to see, unlike the raw database and network failures around it. That
 * trust is earned rather than assumed — invokeFunction screens the text with
 * serverMessage() before constructing one, so a function that leaks on some
 * unhandled path cannot leak all the way to the screen.
 *
 * It carries the parsed payload as well as the message so a caller that needs
 * more than the text — the daily allowance, say — can read it without a second
 * request.
 */
export class FunctionError extends UserFacingError {
  constructor(message: string, readonly payload: unknown) {
    super(message);
    this.name = "FunctionError";
  }
}

/**
 * What a failing call says when the server did not word it itself — a gateway
 * that answered before the function ran, or a body that was not JSON. Status
 * codes mean nothing to a reader, so none of them are shown.
 */
function statusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Your session has expired. Please sign in again.";
  }
  if (status === 429) {
    return "That was a lot at once. Please wait a minute and try again.";
  }
  if (status >= 500) {
    return "NutriPilot is having trouble right now. Please try again in a moment.";
  }
  return "That did not go through. Please try again in a moment.";
}

export interface AiChatResponse {
  reply: string;
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
  if (!token) throw userError("Please sign in first.");

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
  } catch (reason) {
    // Anything from a dropped connection to a service that is not answering
    // arrives here identically, as "Failed to fetch". Which of those it is
    // makes no difference to the reader and the name of the service they could
    // not reach is ours to know, not theirs — so it is logged, not shown.
    if (import.meta.env.DEV) console.error(`[nutripilot] ${name} unreachable:`, reason);
    throw userError(
      navigator.onLine === false
        ? "You appear to be offline. Check your connection and try again."
        : "NutriPilot could not reach the server. Please try again in a moment.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    // This is the one place server text becomes something the app will show, so
    // it is the one place it gets checked. Past here a FunctionError is trusted
    // verbatim, and it should only have to be trusted once.
    const written =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "";
    throw new FunctionError(
      serverMessage(written, statusMessage(response.status)),
      payload,
    );
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
  return invokeFunction<AiChatResponse>("ai-chat", {
    message,
    imagePath,
    today: localDateKey(),
  });
}

/** Uploads to the private bucket under the user's own folder. */
export async function uploadMealPhoto(userId: string, blob: Blob): Promise<string> {
  const client = requireSupabase();
  const path = `${userId}/${crypto.randomUUID()}.jpg`;

  const { error } = await client.storage
    .from("meal-photos")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });

  if (error) {
    if (import.meta.env.DEV) console.error("[nutripilot] photo upload failed:", error);
    throw userError("That photo could not be uploaded. Please try again in a moment.");
  }
  return path;
}

/** PostgREST's code for "you asked for a column this table does not have". */
const UNDEFINED_COLUMN = "42703";

// Which provider and model answered is recorded on the row for support and
// cost work, and is deliberately not read back here: the app has never shown
// it, and a column the client does not ask for is a detail about our
// infrastructure that cannot end up in a browser.
const CHAT_FIELDS = "id,role,content,estimate,created_at,logged_at";
/** The same list for a database that predates the logged_at migration. */
const CHAT_FIELDS_WITHOUT_LOGGED = "id,role,content,estimate,created_at";

export async function loadChatHistory(limit = 60): Promise<ChatMessage[]> {
  const client = requireSupabase();
  const read = (fields: string) =>
    client
      .from("chat_messages")
      .select(fields)
      // Newest first, then reversed below, so the limit keeps the most recent
      // messages rather than the oldest.
      .order("created_at", { ascending: false })
      // A question and its answer used to be written by a single INSERT, and
      // Postgres stamps every row in one statement with the same transaction
      // clock. Those rows are still in people's history with timestamps that
      // tie, and a tie with no second key sorts arbitrarily — which is how a
      // reply ended up above the message that prompted it after a reload.
      //
      // Within one exchange the user always speaks first, so role settles it:
      // ascending here puts "assistant" above "user", which becomes user above
      // assistant once the page is reversed.
      .order("role", { ascending: true })
      .limit(limit);

  let { data, error } = await read(CHAT_FIELDS);

  // Losing the record of what was already logged is a card that offers twice;
  // failing outright is a coach with no conversation in it at all.
  if (error?.code === UNDEFINED_COLUMN) {
    // Names a table and a migration, so it stays out of a shipped console.
    if (import.meta.env.DEV) {
      console.warn(
        "[coach] chat_messages.logged_at is missing — run the chat_message_logged_at " +
          "migration, or an estimate already added to the diary will be offered again.",
      );
    }
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

  if (error && import.meta.env.DEV) {
    console.warn("[coach] could not mark the estimate as logged:", error.message);
  }
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
