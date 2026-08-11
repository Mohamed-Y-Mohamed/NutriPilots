import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Field, inputClass } from "../components/ui";
import { EMAIL_CONFIRMATION_URL } from "../lib/site";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabase";
import { resolveVerification, type VerificationResult } from "../lib/verification";

/**
 * Where someone lands after clicking "confirm your email".
 *
 * Part of the app rather than a static page, so the same build serves it on the
 * web and inside the Android shell, and it inherits the app's design.
 *
 * It renders for signed-out visitors: whoever opens the link may be on a
 * different device from the one that signed up.
 */
export function VerifyPage() {
  const navigate = useNavigate();
  const [result, setResult] = useState<VerificationResult | null>(null);

  useEffect(() => {
    let active = true;

    void resolveVerification(SUPABASE_URL, SUPABASE_ANON_KEY).then((outcome) => {
      if (active) setResult(outcome);
    });

    return () => {
      active = false;
    };
  }, []);

  /**
   * Confirming an email must not sign anyone in.
   *
   * The client is configured with detectSessionInUrl, so on the browser that
   * signed up it quietly trades the `?code=` in this URL for a real session.
   * The page then said "verified" while the user was already logged in, and
   * "Continue to sign in" dropped them straight into the app — no password ever
   * entered, and the account left signed in on whatever device opened the link.
   *
   * The exchange is asynchronous and cannot be waited on from here, so this
   * watches for a session appearing rather than clearing once and hoping.
   * Local scope clears this browser's stored session without calling the
   * server, so sessions on the user's other devices are untouched.
   */
  useEffect(() => {
    const client = supabase;
    if (!client) return;

    void client.auth.signOut({ scope: "local" });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (session) void client.auth.signOut({ scope: "local" });
    });

    return () => data.subscription.unsubscribe();
  }, []);

  const verified = result?.outcome === "verified";

  return (
    <main className="grid min-h-svh place-items-center bg-canvas px-6 py-10 text-ink">
      <div className="w-full max-w-sm text-center">
        <img
          src="/logo.png"
          alt=""
          className="mx-auto h-20 w-20 rounded-3xl ring-1 ring-line dark:ring-ink-faint"
          width={80}
          height={80}
        />

        <p
          role="status"
          aria-live="polite"
          className={[
            "mt-6 inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-semibold",
            !result
              ? "bg-muted text-ink-muted"
              : verified
                ? "bg-ok-soft text-ok"
                : "bg-danger-soft text-danger",
          ].join(" ")}
        >
          {!result && (
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-brand motion-reduce:animate-none"
            />
          )}
          {!result ? "Checking your link" : verified ? "Email verified" : "Not verified"}
        </p>

        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          {!result
            ? "Verifying your email"
            : verified
              ? "You're all set"
              : "We couldn't verify your email"}
        </h1>

        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          {!result
            ? "One moment while we check your verification link."
            : verified
              ? "Your email address is confirmed. Sign in with the password you chose and NutriPilot is ready."
              : "This link may be invalid, expired, or already used. Request a new verification email and try again."}
        </p>

        {result && (
          <>
            <Button
              variant={verified ? "primary" : "secondary"}
              size="lg"
              full
              className="mt-7"
              onClick={() => navigate("/auth", { replace: true })}
            >
              {verified ? "Continue to sign in" : "Back to sign in"}
            </Button>

            {!verified && result.reason && (
              <p className="mt-5 text-xs text-ink-faint">{result.reason}</p>
            )}

            {/* An expired link is the common failure, and the only useful reply
                to it is another link. Asking the user to find the app, sign in
                and hunt for a resend button is how accounts get abandoned. */}
            {!verified && <ResendForm />}
          </>
        )}
      </div>
    </main>
  );
}

/**
 * Sends a fresh confirmation link.
 *
 * The address is asked for rather than assumed: whoever opens a dead link has
 * no session, and may be on a different device from the one that signed up.
 *
 * Supabase answers the same way whether or not the address has an account, and
 * so does this — otherwise the form would report who is registered to anyone
 * who typed an address in.
 */
function ResendForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setError("");
    setState("sending");

    const { error: sendError } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: EMAIL_CONFIRMATION_URL },
    });

    // A rate limit is the one failure worth naming: the fix is to wait, and
    // without saying so the user just presses the button again.
    if (sendError && /rate|limit|seconds|too many/i.test(sendError.message)) {
      setError("Too many requests just now. Wait a minute, then try again.");
      setState("idle");
      return;
    }

    setState("sent");
  }

  if (state === "sent") {
    return (
      <Alert tone="success" className="mt-6 text-left">
        If <span className="font-medium">{email.trim()}</span> needs confirming, a new link is on
        its way. It replaces any earlier link, so use the newest email.
      </Alert>
    );
  }

  return (
    <form onSubmit={send} className="mt-8 border-t border-line pt-6 text-left">
      <Field label="Send a new link" hint="The email address you signed up with.">
        <input
          className={inputClass}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          maxLength={254}
          placeholder="you@example.com"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </Field>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      <Button variant="secondary" full className="mt-3" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Email me a new link"}
      </Button>
    </form>
  );
}
