import {
  ArrowLeft,
  Camera,
  Check,
  Eye,
  EyeOff,
  MailCheck,
  Salad,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { LegalSheet } from "../components/LegalSheet";
import { Brand } from "../components/Logo";
import { Alert, Button, cx, inputClass, labelClass } from "../components/ui";
import { assessPassword, isValidEmail, type PasswordStrength } from "../lib/validation";
import { useAuth } from "../state/AuthContext";

type Mode = "signup" | "signin" | "reset";

const STRENGTH_LABEL: Record<PasswordStrength, string> = {
  weak: "Weak",
  fair: "Fair",
  good: "Good",
  strong: "Strong",
};

const STRENGTH_COLOUR: Record<PasswordStrength, string> = {
  weak: "var(--color-danger)",
  fair: "#e0a03f",
  good: "var(--color-brand)",
  strong: "var(--color-brand)",
};

export function AuthPage() {
  // Signing up is the default: a first-time user is the common case, and
  // someone returning knows to look for "Sign in".
  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  const { signIn, signUp, resetPassword } = useAuth();

  const assessment = useMemo(() => assessPassword(password), [password]);
  const emailValid = isValidEmail(email);
  const emailError = emailTouched && email.length > 0 && !emailValid;

  const canSubmit =
    mode === "reset"
      ? emailValid
      : mode === "signin"
        ? emailValid && password.length >= 6
        : emailValid && assessment.allRulesMet && name.trim().length >= 2 && acceptedTerms;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canSubmit) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === "signup") {
        const { needsEmailConfirmation } = await signUp(email, password, name);
        if (needsEmailConfirmation) setAwaitingConfirmation(true);
      } else if (mode === "signin") {
        await signIn(email, password);
      } else {
        await resetPassword(email);
        setNotice("If that email has an account, a reset link is on its way.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  return (
    <div className="grid min-h-svh lg:grid-cols-[0.85fr_1.15fr]">
      <BrandPanel />

      <div className="pt-safe pb-safe flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          {awaitingConfirmation ? (
            <ConfirmationNotice
              email={email}
              onSignIn={() => {
                setAwaitingConfirmation(false);
                switchMode("signin");
                setPassword("");
              }}
              onChangeEmail={() => setAwaitingConfirmation(false)}
            />
          ) : (
            <>
              <div className="mb-8 flex justify-center lg:hidden">
                <Brand size={32} to={null} />
              </div>

              {mode === "reset" && (
                <button
                  onClick={() => switchMode("signin")}
                  className="mb-5 inline-flex min-h-9 items-center gap-2 text-[13px] text-ink-muted hover:text-ink"
                >
                  <ArrowLeft size={16} /> Back to sign in
                </button>
              )}

              <h1 className="text-2xl font-semibold tracking-tight">
                {mode === "signup"
                  ? "Create your account"
                  : mode === "signin"
                    ? "Welcome back"
                    : "Reset password"}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                {mode === "signup"
                  ? "Track what you eat and ask the coach anything about food."
                  : mode === "signin"
                    ? "Pick up where you left off."
                    : "We will email you a link to set a new password."}
              </p>

              <form className="mt-7 grid gap-4" onSubmit={submit} noValidate>
                {mode === "signup" && (
                  <label className="grid gap-1.5">
                    <span className={labelClass}>Your name</span>
                    <input
                      type="text"
                      className={inputClass}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Alex"
                      autoComplete="name"
                      required
                    />
                  </label>
                )}

                <label className="grid gap-1.5">
                  <span className={labelClass}>Email</span>
                  <span className="relative block">
                    <input
                      type="email"
                      className={cx(
                        inputClass,
                        "pr-10",
                        emailError && "border-danger focus:border-danger",
                      )}
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      onBlur={() => setEmailTouched(true)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      inputMode="email"
                      autoCapitalize="none"
                      aria-invalid={emailError}
                      required
                    />
                    {email.length > 0 && (
                      <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center">
                        {emailValid ? (
                          <Check size={16} className="text-ok" aria-hidden="true" />
                        ) : (
                          emailTouched && <X size={16} className="text-danger" aria-hidden="true" />
                        )}
                      </span>
                    )}
                  </span>
                  {emailError && (
                    <span className="text-[11px] text-danger">
                      That does not look like a valid email address.
                    </span>
                  )}
                </label>

                {mode !== "reset" && (
                  <label className="grid gap-1.5">
                    <span className={labelClass}>Password</span>
                    <span className="relative block">
                      <input
                        type={showPassword ? "text" : "password"}
                        className={cx(inputClass, "pr-12")}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                        autoComplete={mode === "signup" ? "new-password" : "current-password"}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-ink-faint hover:text-ink"
                      >
                        {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                    </span>
                  </label>
                )}

                {mode === "signup" && password.length > 0 && (
                  <div className="grid gap-2">
                    <div className="grid gap-1">
                      {assessment.rules.map((rule) => (
                        <span
                          key={rule.id}
                          className={cx(
                            "flex items-center gap-1.5 text-[12px]",
                            rule.met ? "text-ok" : "text-ink-faint",
                          )}
                        >
                          {rule.met ? <Check size={13} /> : <X size={13} />}
                          {rule.label}
                        </span>
                      ))}
                    </div>

                    {assessment.allRulesMet && (
                      <div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className={labelClass}>Password strength</span>
                          <span
                            className="font-medium"
                            style={{ color: STRENGTH_COLOUR[assessment.strength] }}
                          >
                            {STRENGTH_LABEL[assessment.strength]}
                          </span>
                        </div>
                        <div
                          className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
                          role="meter"
                          aria-valuenow={assessment.score}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Password strength"
                        >
                          <span
                            className="block h-full rounded-full transition-[width,background-color] duration-300"
                            style={{
                              width: `${assessment.score}%`,
                              backgroundColor: STRENGTH_COLOUR[assessment.strength],
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {mode === "signup" && (
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface p-3">
                    <input
                      type="checkbox"
                      checked={acceptedTerms}
                      onChange={(event) => setAcceptedTerms(event.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-brand"
                    />
                    <span className="text-[12px] leading-relaxed text-ink-muted">
                      I have read and agree to the{" "}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          setShowTerms(true);
                        }}
                        className="font-medium text-brand underline underline-offset-2"
                      >
                        Terms of Use &amp; Privacy
                      </button>
                      , and I understand NutriPilot gives estimates, not medical advice.
                    </span>
                  </label>
                )}

                {error && <Alert tone="error">{error}</Alert>}
                {notice && <Alert tone="success">{notice}</Alert>}

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  full
                  disabled={busy || !canSubmit}
                  className="mt-1"
                >
                  {busy
                    ? "Please wait…"
                    : mode === "signup"
                      ? "Create account"
                      : mode === "signin"
                        ? "Sign in"
                        : "Send reset link"}
                </Button>
              </form>

              <div className="mt-6 grid gap-1 text-center text-[13px] text-ink-muted">
                {mode !== "reset" && (
                  <p>
                    {mode === "signup" ? "Already have an account?" : "New to NutriPilot?"}{" "}
                    <button
                      className="min-h-9 font-medium text-brand"
                      onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
                    >
                      {mode === "signup" ? "Sign in" : "Create one"}
                    </button>
                  </p>
                )}
                {mode === "signin" && (
                  <button
                    className="min-h-9 font-medium text-brand"
                    onClick={() => switchMode("reset")}
                  >
                    Forgot your password?
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showTerms && (
        <LegalSheet
          onClose={() => setShowTerms(false)}
          onAccept={() => {
            setAcceptedTerms(true);
            setShowTerms(false);
          }}
        />
      )}
    </div>
  );
}

function ConfirmationNotice({
  email,
  onSignIn,
  onChangeEmail,
}: {
  email: string;
  onSignIn: () => void;
  onChangeEmail: () => void;
}) {
  return (
    <div className="grid justify-items-center gap-4 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand">
        <MailCheck size={26} />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
      <p className="text-sm leading-relaxed text-ink-muted">
        We sent a confirmation link to <span className="font-medium text-ink">{email}</span>. Open
        it to activate your account, then come back and sign in.
      </p>
      <Button variant="primary" size="lg" full onClick={onSignIn}>
        I have confirmed — sign in
      </Button>
      <button className="min-h-9 text-[13px] text-ink-muted hover:text-ink" onClick={onChangeEmail}>
        Use a different email
      </button>
    </div>
  );
}

function BrandPanel() {
  return (
    <aside className="hidden flex-col justify-between bg-olive px-12 py-10 lg:flex">
      <Brand size={32} to={null} onDark />

      <div className="max-w-md">
        <h2 className="text-4xl font-semibold leading-[1.05] tracking-tight text-white">
          Eat well.
          <br />
          Track simply.
        </h2>
        <p className="mt-5 text-[15px] leading-relaxed text-white/60">
          Nutrition for 2,400+ foods and 790+ recipes, a diary that takes seconds, and a coach that
          actually understands food.
        </p>
        <ul className="mt-8 grid gap-3.5 text-sm text-white/75">
          <Promise icon={<Salad size={17} />}>Search real foods and log what you ate</Promise>
          <Promise icon={<Camera size={17} />}>Photograph a meal for an instant estimate</Promise>
          <Promise icon={<Sparkles size={17} />}>Ask about weight loss, muscle or plateaus</Promise>
        </ul>
      </div>

      <small className="text-xs text-white/35">
        Estimates are for general guidance, not medical advice.
      </small>
    </aside>
  );
}

function Promise({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="text-lime">{icon}</span>
      {children}
    </li>
  );
}
