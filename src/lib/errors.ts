/**
 * The one place that decides what a failure is allowed to say out loud.
 *
 * Almost nothing that goes wrong in this app produces text fit to read. A
 * PostgREST rejection names the table, the column and the policy it tripped
 * over. A failed function call names the function. A Supabase client with no
 * configuration names the environment variables it wanted. Every one of those
 * describes the inside of a system the person holding the phone is not supposed
 * to be able to see, and none of them tells them what to do next.
 *
 * So the rule is inverted: no message reaches the screen because it happened to
 * be attached to an exception. It reaches the screen because somebody wrote it
 * for a reader — which is what UserFacingError marks. Everything else falls
 * back to whatever the calling screen would say about its own job, and the real
 * detail goes to the console for whoever is debugging.
 *
 * Screens call presentError. They do not read `.message` themselves.
 */

/**
 * An error whose message was written to be shown to a person.
 *
 * Anything thrown with this is trusted verbatim: hand-written client messages,
 * and the bodies of Edge Function replies, which are authored for the reader on
 * the server side for exactly this reason.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** Shorthand for the common case. */
export function userError(message: string): UserFacingError {
  return new UserFacingError(message);
}

/**
 * Markers of text that was written for us rather than for the reader.
 *
 * Our own API answers with sentences meant to be shown, which is why a
 * FunctionError is trusted — but "our server always words things properly" is
 * an assumption, and it is the same assumption that put a Postgres message on
 * a screen in the first place. An unhandled path, a bad deploy or a new
 * function that forgets the rule would all arrive looking trustworthy.
 *
 * So server text is screened before it is believed. Deliberately a short,
 * specific list rather than anything clever: it has to be obvious what it
 * catches, and it must never swallow a legitimate message like "You have used
 * all 35 of today's coach messages."
 */
/*
 * Note what is deliberately absent: the names of the AI providers. Listing them
 * here would put them in the shipped bundle, which is the very thing the rest of
 * this work was about — and it would buy nothing, because the server never puts
 * them in an error field. Every model failure inside the functions is caught and
 * answered with a fixed sentence, and a body that did somehow carry a provider
 * name would be carrying the surrounding fault with it, which these markers do
 * catch. That screening belongs on the server, where those names already live.
 */
const INTERNAL_MARKERS = [
  /\brelation\b/i,
  /\bcolumn\b[\s\S]*\bdoes not exist\b/i,
  /\bconstraint\b/i,
  /row-level security/i,
  /permission denied/i,
  /\bpg_|\bPGRST\d/i,
  /\bJWT\b/i,
  /\b(supabase|postgres|postgrest)\b/i,
  /functions?\/v1\//i,
  /\b(ai-chat|submit-food|promote-food|delete-account|purge-meal-photos)\b/i,
];

/** True when a message describes the inside of the system. */
export function looksInternal(message: string): boolean {
  return INTERNAL_MARKERS.some((marker) => marker.test(message));
}

/**
 * The server's own wording, if it is fit to show, and `fallback` if it is not.
 * Use at the point where a response body becomes an error — once past that, the
 * text is trusted, and it should only be trusted once.
 */
export function serverMessage(written: string, fallback: string): string {
  const trimmed = written.trim();
  if (!trimmed) return fallback;

  if (looksInternal(trimmed)) {
    if (import.meta.env.DEV) {
      console.error("[nutripilot] server returned an internal message, withheld:", trimmed);
    }
    return fallback;
  }
  return trimmed;
}

/**
 * Conditions worth naming, because knowing which one it is changes what the
 * user should do. Each carries its own way out, so they are never given the
 * generic hint on top.
 *
 * Matching on the underlying text is fine — the text is being *read* here, not
 * shown. What comes out is written below, in full, every time.
 */
const OFFLINE =
  "You appear to be offline. Check your connection and try again.";
const UNREACHABLE =
  "NutriPilot could not reach the server. Please try again in a moment.";
const SESSION_EXPIRED =
  "Your session has expired. Please sign in again.";
const TOO_FAST =
  "That was a lot at once. Please wait a minute and try again.";

/**
 * Appended to a screen's own fallback so no failure is ever a dead end. Skipped
 * when the text already says what to do — "Please try again. Please try again
 * in a moment." reads like a bug in itself.
 */
const ALREADY_SUGGESTS_SOMETHING =
  /try again|sign in|check (your|and)|choose|tomorrow|shortly|in a moment|in a minute|come back/i;

export function withRetryHint(message: string): string {
  const trimmed = message.trim();
  if (ALREADY_SUGGESTS_SOMETHING.test(trimmed)) return trimmed;
  const stop = /[.!?]$/.test(trimmed) ? "" : ".";
  return `${trimmed}${stop} Please try again in a moment.`;
}

/**
 * What to show the user for a failure, given what the calling screen would say
 * about its own job if it learns nothing more specific.
 *
 * `fallback` should describe the action that failed in the user's terms — "Could
 * not save that food." — not the mechanism.
 */
export function presentError(reason: unknown, fallback: string): string {
  logDetail(reason);

  if (reason instanceof UserFacingError) return reason.message;

  const specific = classify(reason);
  if (specific) return specific;

  return withRetryHint(fallback);
}

/**
 * The handful of failures where the cause genuinely changes the advice. Order
 * matters: being offline explains a fetch failure better than the fetch failure
 * does, so it is checked first.
 */
function classify(reason: unknown): string | null {
  // A browser that knows it has no connection is more reliable than any string
  // match, and it is the single most common reason any of this fails.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return OFFLINE;

  const text = rawText(reason).toLowerCase();
  if (!text) return null;

  // The shape every browser uses for "the request never completed" — DNS,
  // CORS, a dropped connection, a service that is not answering.
  if (
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("network request failed") ||
    text.includes("load failed") ||
    text.includes("fetch failed")
  ) {
    return UNREACHABLE;
  }

  if (
    text.includes("jwt expired") ||
    text.includes("token is expired") ||
    text.includes("invalid claim") ||
    text.includes("refresh token") ||
    text.includes("session_not_found") ||
    text.includes("not authenticated")
  ) {
    return SESSION_EXPIRED;
  }

  if (text.includes("rate limit") || text.includes("too many requests")) {
    return TOO_FAST;
  }

  return null;
}

function rawText(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === "string") return reason;
  // supabase-js hands back plain objects with a message on them in some paths.
  if (reason && typeof reason === "object" && "message" in reason) {
    return String((reason as { message: unknown }).message ?? "");
  }
  return "";
}

/**
 * Where the real detail goes. Development only: a production console is a place
 * users and their browser extensions can read, and the whole point of this
 * module is that the schema does not get printed there.
 */
function logDetail(reason: unknown): void {
  if (!import.meta.env.DEV) return;
  console.error("[nutripilot] handled failure:", reason);
}
