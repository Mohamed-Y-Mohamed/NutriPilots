/**
 * Reads the outcome of an email confirmation link.
 *
 * The parameters are snapshotted at module load. supabase-js strips auth
 * parameters from the URL once it has processed them, so a component reading
 * `window.location` later can find an empty query and wrongly conclude the link
 * carried nothing.
 */

const snapshot =
  typeof window === "undefined"
    ? { search: "", hash: "" }
    : { search: window.location.search, hash: window.location.hash };

export type VerificationOutcome = "verified" | "failed";

export interface VerificationResult {
  outcome: VerificationOutcome;
  /**
   * Our own wording, chosen from a fixed table. Never text taken from the URL.
   */
  reason?: string;
}

/**
 * Anyone can put anything in a query string and send the link to someone else.
 * Rendering that text would let a stranger publish their own words on our
 * domain — "call this number to restore your account" reads as official when it
 * sits under our logo. React escapes markup, so this is not script injection,
 * but it is still someone else writing our page.
 *
 * So the URL only ever selects a message; it never supplies one.
 */
const FAILURE_MESSAGES: Record<string, string> = {
  otp_expired: "This link has expired. Request a new confirmation email and use the newest one.",
  access_denied: "This link is no longer valid. It may have already been used.",
  unauthorized_client: "This link is no longer valid. It may have already been used.",
  validation_failed: "This link is incomplete. Open the most recent email and tap the link again.",
};

const GENERIC_FAILURE = "This link is invalid, expired, or has already been used.";

/**
 * Turns whatever a link claims into one of our own sentences. Supabase puts the
 * specific cause in `error_code` and the broad one in `error`, so both are
 * consulted, most specific first.
 */
function messageFor(...codes: Array<string | null>): string {
  for (const code of codes) {
    if (code && FAILURE_MESSAGES[code]) return FAILURE_MESSAGES[code];
  }
  return GENERIC_FAILURE;
}

/**
 * Supabase rejects an unknown type, but sending one on unchecked would make the
 * link's author a participant in the request we make. Only the types this app
 * actually issues are passed through.
 */
const ALLOWED_TYPES = ["signup", "email", "email_change", "recovery", "invite", "magiclink"];

/** The address the page was opened with, captured before it can be rewritten. */
export const verificationHref = `${snapshot.search}${snapshot.hash}`;

function reader(href: string) {
  const [search, hash = ""] = href.split("#");
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const fragment = new URLSearchParams(hash);
  // Supabase answers in the query string or the fragment depending on the
  // template and flow that sent the user here, so both are read.
  return (name: string) => query.get(name) ?? fragment.get(name);
}

/**
 * Decides whether an email address was confirmed.
 *
 * A `token_hash` is checked against Supabase directly — the strongest evidence
 * available, and what `verifyOtp` does. Everything else is read from the
 * redirect Supabase has already performed.
 */
export async function resolveVerification(
  supabaseUrl: string,
  anonKey: string,
  href: string = verificationHref,
): Promise<VerificationResult> {
  const readParam = reader(href);

  // An explicit rejection is never dressed up as a success. `error_description`
  // is read only to detect that one is present — its text is discarded.
  if (readParam("error") ?? readParam("error_description")) {
    return { outcome: "failed", reason: messageFor(readParam("error_code"), readParam("error")) };
  }

  const tokenHash = readParam("token_hash");
  if (tokenHash) {
    const requested = readParam("type") ?? "email";
    const type = ALLOWED_TYPES.includes(requested) ? requested : "email";

    try {
      // The host is our own constant, never the link's — a crafted `href`
      // cannot redirect this call or the token to anywhere else.
      const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ type, token_hash: tokenHash }),
      });
      const body = await response.json().catch(() => null);

      if (response.ok && body?.access_token) return { outcome: "verified" };
      return { outcome: "failed", reason: messageFor(body?.error_code ?? null) };
    } catch {
      return {
        outcome: "failed",
        reason: "We could not reach NutriPilot. Check your connection and open the link again.",
      };
    }
  }

  // The stock Supabase template routes through /auth/v1/verify, which checks
  // the token server-side and only then redirects here. A rejected link never
  // arrives with a code — it arrives as ?error=access_denied, caught above. So
  // a code with no error means Supabase accepted the link.
  //
  // The code is never exchanged here: PKCE needs the verifier held by the
  // client that began the flow, and no exchange is needed to report an outcome
  // already decided upstream.
  if (readParam("code")) return { outcome: "verified" };

  // Implicit flow: Supabase verified before redirecting.
  if (readParam("access_token")) return { outcome: "verified" };

  // A bare ?verified=true proves nothing.
  return { outcome: "failed", reason: "This link carried no verification token." };
}
