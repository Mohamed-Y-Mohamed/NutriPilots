/**
 * Permanently deletes the calling user's account.
 *
 * Every per-user table cascades from `auth.users`, so removing the auth user
 * removes the rows. Storage objects are not covered by that cascade, so they
 * are swept explicitly first.
 */

import { json, preflight } from "../_shared/cors.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";

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

  const { data: files } = await admin.storage
    .from("meal-photos")
    .list(userId, { limit: 1000 });

  if (files && files.length > 0) {
    const paths = files.map((file) => `${userId}/${file.name}`);
    const { error } = await admin.storage.from("meal-photos").remove(paths);
    if (error) console.error("[delete-account] storage sweep failed", error.message);
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error("[delete-account] auth delete failed", error.message);
    return json({ error: "Could not delete the account. Please try again." }, 500);
  }

  return json({ deleted: true });
});
