import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabase";
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

  const verified = result?.outcome === "verified";

  return (
    <main className="grid min-h-svh place-items-center bg-canvas px-6 py-10 text-ink">
      <div className="w-full max-w-sm text-center">
        <img
          src="/logo-512.png"
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
          </>
        )}
      </div>
    </main>
  );
}
