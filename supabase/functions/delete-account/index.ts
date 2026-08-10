/**
 * Permanently deletes the calling user's account and everything in it.
 *
 * Every per-user table has ON DELETE CASCADE from `auth.users`, but this does
 * not rely on that: each table is emptied explicitly first, then the storage
 * folder, then the auth user. If a cascade is ever dropped or a table is added
 * without one, the data still goes.
 */

import { json, preflight } from "../_shared/cors.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

/** Every table that holds anything belonging to a user. */
const USER_TABLES = [
  "diary_entries",
  "chat_messages",
  "meal_photo_analyses",
  "user_ingredients",
  "user_recipes",
  "user_profiles",
] as const;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authed = await requireUser(request);
  if (!authed) return json({ error: "Please sign in first." }, 401);

  let body: { confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // A destructive, irreversible action needs an explicit intent signal, not
  // just a reachable endpoint.
  if (body.confirm !== "DELETE") {
    return json({ error: "Confirmation phrase missing." }, 400);
  }

  const admin = adminClient();
  const userId = authed.user.id;
  const removed: Record<string, number | string> = {};

  // Rows first, so nothing is orphaned if the auth delete later fails.
  for (const table of USER_TABLES) {
    const { error, count } = await admin
      .from(table)
      .delete({ count: "exact" })
      .eq("user_id", userId);

    if (error) {
      console.error(`[delete-account] ${table}`, error.message);
      removed[table] = `failed: ${error.message}`;
    } else {
      removed[table] = count ?? 0;
    }
  }

  // Storage is not covered by the cascade, so it is swept explicitly.
  const { data: files } = await admin.storage.from("meal-photos").list(userId, { limit: 1000 });
  if (files && files.length > 0) {
    const paths = files.map((file) => `${userId}/${file.name}`);
    const { error } = await admin.storage.from("meal-photos").remove(paths);
    if (error) console.error("[delete-account] storage sweep", error.message);
    removed.photos = files.length;
  } else {
    removed.photos = 0;
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("[delete-account] auth delete failed", error.message);
    return json({
      error: "Your data was deleted but the account itself could not be removed. Please try again.",
      removed,
    }, 500);
  }

  console.log("[delete-account] removed", JSON.stringify(removed));
  return json({ deleted: true, removed });
});
