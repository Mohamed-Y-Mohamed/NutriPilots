import { requireSupabase } from "../lib/supabase";
import type { AiProvider, ChatMessage, MealEstimate } from "../types";

export interface AiChatResponse {
  reply: string;
  provider: AiProvider;
  model: string;
  /** Models tried and exhausted before one answered. */
  attempts: string[];
  estimate?: MealEstimate | null;
  analysisId?: string | null;
  messageId?: string | null;
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

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

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
    throw new Error(message);
  }

  return payload as T;
}

export async function sendChatMessage(
  message: string,
  imagePath?: string,
): Promise<AiChatResponse> {
  return invokeFunction<AiChatResponse>("ai-chat", { message, imagePath });
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

export async function loadChatHistory(limit = 60): Promise<ChatMessage[]> {
  const { data, error } = await requireSupabase()
    .from("chat_messages")
    .select("id,role,content,estimate,provider,model,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .reverse()
    .map((row) => ({
      id: row.id as string,
      role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
      text: (row.content as string) ?? "",
      estimate: (row.estimate as MealEstimate | null) ?? null,
      provider: (row.provider as AiProvider | null) ?? null,
      createdAt: row.created_at as string,
    }));
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
