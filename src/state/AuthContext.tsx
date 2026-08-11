import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { EMAIL_CONFIRMATION_URL, PASSWORD_RESET_URL } from "../lib/site";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

export interface SignUpOutcome {
  /** True when Supabase requires the user to confirm their email first. */
  needsEmailConfirmation: boolean;
}

interface AuthContextValue {
  user: User | null;
  /**
   * True between creating an account and the user acknowledging it. Held here
   * rather than in the page because signing up briefly produces a session, and
   * the resulting re-render would unmount the page and lose the flag with it.
   */
  justSignedUp: boolean;
  acknowledgeSignUp: () => void;
  /** True while the user is here from a password-reset link. */
  isRecovering: boolean;
  /** Sets a new password for the signed-in or recovering user. */
  updatePassword: (password: string) => Promise<void>;
  session: Session | null;
  isLoading: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<SignUpOutcome>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Clears the session without calling the server. Needed after the account has
   * been deleted, when a normal sign-out would fail because the user the token
   * refers to no longer exists.
   */
  signOutLocal: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);
  const [justSignedUp, setJustSignedUp] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let isMounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session);
      setIsLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);

      // Arriving from a reset link produces a real session, so without this the
      // app would simply let them in and never ask for a new password.
      if (event === "PASSWORD_RECOVERY") setIsRecovering(true);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      justSignedUp,
      isRecovering,

      updatePassword: async (password) => {
        const client = requireClient();
        const { error } = await client.auth.updateUser({ password });
        if (error) throw new Error(friendlyAuthError(error.message));
        setIsRecovering(false);
      },

      acknowledgeSignUp: () => {
        setJustSignedUp(false);
        // Sign-up always ends signed out. Clearing here too closes the window
        // where dismissing the confirmation faster than the local sign-out
        // settles would drop the user straight into the app.
        setSession(null);
      },
      session,
      isLoading,
      isConfigured: isSupabaseConfigured,

      signIn: async (email, password) => {
        const client = requireClient();
        const { error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw new Error(friendlyAuthError(error.message));
      },

      signUp: async (email, password, name) => {
        const client = requireClient();
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: name.trim() },
            // Without this Supabase falls back to the Site URL, and inside the
            // Capacitor shell that resolved to localhost — a link the user
            // could never open on their phone.
            emailRedirectTo: EMAIL_CONFIRMATION_URL,
          },
        });
        if (error) throw new Error(friendlyAuthError(error.message));

        // With email confirmation switched off Supabase signs the new account
        // in straight away. The session is dropped here on purpose: the app
        // shows a confirmation screen and asks for one explicit sign-in, which
        // would be impossible if the shell had already taken over the screen.
        // Cleared locally, so there is no network round trip and no chance of
        // the just-created account being invalidated server-side.
        if (data.session) {
          // Set before the sign-out so the shell never gets a frame in which
          // to take over the screen.
          setJustSignedUp(true);
          await client.auth.signOut({ scope: "local" }).catch(() => undefined);
          setSession(null);
        }

        return { needsEmailConfirmation: !data.session };
      },

      resetPassword: async (email) => {
        const client = requireClient();
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: PASSWORD_RESET_URL,
        });
        if (error) throw new Error(friendlyAuthError(error.message));
      },

      signOut: async () => {
        if (!supabase) return;
        const { error } = await supabase.auth.signOut();
        if (error) throw new Error(error.message);
      },

      signOutLocal: async () => {
        if (!supabase) return;
        // `scope: "local"` skips the network round trip entirely.
        await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
        setSession(null);
      },
    }),
    [session, isLoading, justSignedUp, isRecovering],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

function requireClient() {
  if (!supabase) {
    throw new Error("NutriPilot is not connected to its server yet. Please try again later.");
  }
  return supabase;
}

/** Supabase messages are accurate but terse; these are the ones users hit. */
export function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials")) {
    return "That email and password do not match. Please check and try again.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email first — check your inbox for the link we sent.";
  }
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "An account with that email already exists. Try signing in instead.";
  }
  if (lower.includes("password should be at least")) {
    return "Please choose a password with at least 6 characters.";
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (lower.includes("unable to validate email") || lower.includes("invalid email")) {
    return "That email address does not look right.";
  }
  if (lower.includes("error sending") || lower.includes("smtp")) {
    return "We could not send the confirmation email. The mail service may be misconfigured — please try again shortly.";
  }
  if (lower.includes("redirect") || lower.includes("requested path is invalid")) {
    return "Sign-up is misconfigured: this app's return address is not on Supabase's allowed redirect list.";
  }
  if (lower.includes("signups not allowed") || lower.includes("signup is disabled")) {
    return "New sign-ups are currently disabled for this app.";
  }
  if (lower.includes("same as the old") || lower.includes("should be different")) {
    return "That is already your password. Please choose a different one.";
  }
  if (lower.includes("session") && lower.includes("missing")) {
    return "That reset link has expired. Please request a new one.";
  }
  return message;
}
