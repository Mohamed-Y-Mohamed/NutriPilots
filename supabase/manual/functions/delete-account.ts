// ============================================================================
// NutriPilot Edge Function: delete-account
//
// GENERATED FILE — do not edit. Edit supabase/functions/delete-account/index.ts (and
// supabase/functions/_shared/*) then run: npm run bundle:functions
//
// This is a single-file copy for pasting into the Supabase dashboard when the
// CLI is not available. The shared modules are inlined below.
// ============================================================================


import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function preflight(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
/**
 * A client that acts as the calling user. Every query it runs is subject to
 * row level security, so a function can never read another user's rows by
 * accident.
 */
export function userClient(authorization: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
}

/** Bypasses RLS. Only for deletes/cleanup that RLS cannot express. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface AuthedUser {
  id: string;
  email: string | null;
}

/**
 * Resolves the bearer token to a real user. Returns null when the token is
 * missing, expired or invalid — callers must treat that as 401.
 */
export async function requireUser(
  request: Request,
): Promise<{ user: AuthedUser; authorization: string } | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const client = userClient(authorization);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  return {
    user: { id: data.user.id, email: data.user.email ?? null },
    authorization,
  };
}
/**
 * Permanently deletes the calling user's account.
 *
 * Every per-user table cascades from `auth.users`, so removing the auth user
 * removes the rows. Storage objects are not covered by that cascade, so they
 * are swept explicitly first.
 */


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
