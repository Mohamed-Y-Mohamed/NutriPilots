import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Field, inputClass } from "../components/ui";
import { submitDeletionRequest } from "../lib/deletionRequest";
import { useAuth } from "../state/AuthContext";

/**
 * The public account deletion page Google Play requires.
 *
 * It renders for signed-out visitors: Play's reviewers open it without an
 * account, and so does anyone who has already uninstalled the app.
 *
 * The form is for people who can no longer sign in. Anyone who still can is
 * told, above it, that deleting from Settings is instant — a request form means
 * waiting on a person, and they don't need to.
 */
export function DeleteAccountPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [email, setEmail] = useState(user?.email ?? "");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("sending");

    try {
      await submitDeletionRequest({ email: email.trim(), reason: reason.trim() });
      setStatus("sent");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Something went wrong.");
      setStatus("idle");
    }
  }

  return (
    <main className="min-h-svh bg-canvas px-5 py-10 text-ink">
      <div className="mx-auto grid w-full max-w-lg gap-5">
        <header className="text-center">
          <img
            src="/logo.png"
            alt=""
            className="mx-auto h-14 w-14 rounded-2xl ring-1 ring-line dark:ring-ink-faint"
            width={56}
            height={56}
          />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Delete your NutriPilot account
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
            This removes your account and everything stored under it: your goals, diary, saved
            foods, recipes and coach history.
          </p>
        </header>

        {/* Said plainly, not sold: deleting in the app is instant, so anyone who
            can still sign in has no reason to wait on a reply. */}
        <p className="-mb-1 px-1 text-[13px] leading-relaxed text-ink-muted">
          You don't have to wait for us — if you can still sign in, deleting from{" "}
          <span className="font-medium text-ink">Settings → Delete account permanently</span> takes
          effect immediately. Otherwise, send a request below.
        </p>

        <Card className="p-5">
          <h2 className="text-base font-semibold">Request account deletion</h2>

          {status === "sent" ? (
            <div className="mt-3 grid gap-4">
              <Alert tone="success">
                Request received. We'll email <span className="font-medium">{email}</span> to
                confirm it's you, then delete the account.
              </Alert>
              <Button variant="secondary" onClick={() => navigate("/auth")}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Send the email address you sign in with. We'll verify it belongs to you before
                deleting anything — otherwise anyone could close your account.
              </p>

              <form className="mt-4 grid gap-4" onSubmit={handleSubmit}>
                <Field label="Account email" hint="Used only to find and verify your account.">
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

                <Field label="Reason for leaving (optional)">
                  <textarea
                    className={`${inputClass} min-h-24 resize-y`}
                    name="reason"
                    maxLength={1000}
                    placeholder="Anything you'd like us to know"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>

                {error && <Alert tone="error">{error}</Alert>}

                <Button variant="danger" size="lg" full type="submit" disabled={status === "sending"}>
                  {status === "sending" ? "Sending…" : "Request account deletion"}
                </Button>
              </form>
            </>
          )}
        </Card>

        <p className="px-1 text-center text-xs leading-relaxed text-ink-faint">
          NutriPilot's shared ingredient and recipe reference data isn't personal account data and
          isn't affected. Meal photos are analysed and deleted, never kept as account history.
        </p>
      </div>
    </main>
  );
}
