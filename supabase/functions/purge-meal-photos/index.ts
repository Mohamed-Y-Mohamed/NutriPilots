/**
 * Retention sweep. Run on a schedule (pg_cron or an external scheduler).
 *
 * Two jobs:
 *   1. Delete meal photo analyses older than their 30-day retention window.
 *   2. Delete any storage object that outlived its analysis — normally none,
 *      because ai-chat deletes the photo inline, but a crashed request could
 *      leave one behind and a private bucket should never accumulate orphans.
 *
 * Protected by a shared secret because it runs without a user session.
 */

import { json, preflight } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";

const ORPHAN_AGE_MS = 60 * 60 * 1000; // 1 hour

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  const expected = Deno.env.get("PURGE_SECRET");
  const provided = request.headers.get("x-purge-secret");
  if (!expected || provided !== expected) {
    return json({ error: "Not authorised" }, 401);
  }

  const admin = adminClient();
  const now = new Date();

  const { data: expired, error: selectError } = await admin
    .from("meal_photo_analyses")
    .select("id")
    .lt("purge_after", now.toISOString())
    .limit(1000);

  if (selectError) {
    console.error("[purge] select failed", selectError.message);
    return json({ error: "Purge failed" }, 500);
  }

  let analysesDeleted = 0;
  if (expired && expired.length > 0) {
    const { error } = await admin
      .from("meal_photo_analyses")
      .delete()
      .in("id", expired.map((row) => row.id));
    if (error) {
      console.error("[purge] delete failed", error.message);
      return json({ error: "Purge failed" }, 500);
    }
    analysesDeleted = expired.length;
  }

  const orphansDeleted = await sweepOrphanedPhotos(admin, now);

  return json({ analysesDeleted, orphansDeleted, ranAt: now.toISOString() });
});

async function sweepOrphanedPhotos(
  admin: ReturnType<typeof adminClient>,
  now: Date,
): Promise<number> {
  const { data: folders, error } = await admin.storage
    .from("meal-photos")
    .list("", { limit: 1000 });

  if (error || !folders) {
    if (error) console.error("[purge] bucket list failed", error.message);
    return 0;
  }

  const cutoff = now.getTime() - ORPHAN_AGE_MS;
  let removed = 0;

  for (const folder of folders) {
    const { data: files } = await admin.storage
      .from("meal-photos")
      .list(folder.name, { limit: 1000 });
    if (!files || files.length === 0) continue;

    const stale = files
      .filter((file) => {
        const created = Date.parse(file.created_at ?? "");
        return Number.isFinite(created) && created < cutoff;
      })
      .map((file) => `${folder.name}/${file.name}`);

    if (stale.length === 0) continue;

    const { error: removeError } = await admin.storage
      .from("meal-photos")
      .remove(stale);
    if (removeError) {
      console.error("[purge] orphan removal failed", removeError.message);
      continue;
    }
    removed += stale.length;
  }

  return removed;
}
