import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Capacitor serves the app from a custom scheme, where parsing the URL
        // for a session fragment finds nothing and only costs a tick.
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;

/**
 * Repositories call this instead of null-checking on every query. A missing
 * client is a deployment mistake, not a runtime state to design around.
 */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "NutriPilot is not connected to Supabase. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  return supabase;
}
