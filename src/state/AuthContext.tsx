import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

export interface SignUpOutcome {
  /** True when Supabase requires the user to confirm their email first. */
  needsEmailConfirmation: boolean;
}

interface AuthContextValue {
  user: User | null;
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

  useEffect(() => {
    if (!supabase) return;
    let isMounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session);
      setIsLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
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
          options: { data: { display_name: name.trim() } },
        });
        if (error) throw new Error(friendlyAuthError(error.message));

        // This project has email confirmation enabled, so a successful sign-up
        // returns a user with no session until the link is clicked.
        return { needsEmailConfirmation: !data.session };
      },

      resetPassword: async (email) => {
        const client = requireClient();
        const { error } = await client.auth.resetPasswordForEmail(email.trim());
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
    [session, isLoading],
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
  return message;
}
