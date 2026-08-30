import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { userError } from "./errors";

/**
 * Both values are public by design — the publishable key is meant to ship in
 * client code and is protected by row level security, not by secrecy. They are
 * defaulted rather than required so a deploy with no environment configured
 * still produces a working app instead of a blank screen.
 */
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || "https://yhgkrbnmhgspgckvvfhe.supabase.co";
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_nN_8jw_J1FTuGtVIJ7KuQA_V5bY8yn6";

/** Exported so the email-confirmation page can call the auth API directly. */
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseKey;

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
    // The reader can do nothing about a missing environment variable, and
    // naming the ones we wanted describes our deployment to them. The console
    // note is for whoever built it; the thrown message is for whoever is
    // looking at the screen.
    if (import.meta.env.DEV) {
      console.error(
        "[nutripilot] no Supabase client: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.",
      );
    }
    throw userError("NutriPilot is not connected to its server yet. Please try again later.");
  }
  return supabase;
}
