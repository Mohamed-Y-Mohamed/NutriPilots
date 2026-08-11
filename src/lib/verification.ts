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
  /** Supabase's own wording, when it gave one. */
  reason?: string;
}

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

  const error = readParam("error_description") ?? readParam("error");
  if (error) {
    // An explicit rejection is never dressed up as a success.
    return { outcome: "failed", reason: decodeURIComponent(error).replace(/\+/g, " ") };
  }

  const tokenHash = readParam("token_hash");
  if (tokenHash) {
    const type = readParam("type") ?? "email";
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ type, token_hash: tokenHash }),
      });
      const body = await response.json().catch(() => null);

      if (response.ok && body?.access_token) return { outcome: "verified" };
      return { outcome: "failed", reason: body?.msg ?? "" };
    } catch {
      return { outcome: "failed", reason: "Could not reach NutriPilot. Check your connection." };
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
