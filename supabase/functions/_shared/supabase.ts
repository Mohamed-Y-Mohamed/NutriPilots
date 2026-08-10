import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

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
