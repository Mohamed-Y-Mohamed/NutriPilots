/**
 * The one decision that separates the website from the app.
 *
 * Pulled out of the component so it can be tested without a browser, a session
 * or a Capacitor runtime. The rules it encodes are easy to break by accident
 * and expensive to notice: shipping the marketing page inside the Android
 * shell, or letting it swallow a password reset.
 */

export interface LandingContext {
  /** True inside the Capacitor shell. */
  isNative: boolean;
  pathname: string;
  /** A password reset is in progress and the session is in the URL. */
  isRecovering: boolean;
  /** The "account created" confirmation is on screen. */
  justSignedUp: boolean;
}

export function shouldShowLanding({
  isNative,
  pathname,
  isRecovering,
  justSignedUp,
}: LandingContext): boolean {
  // There is no such thing as arriving at a website inside the app shell. The
  // installed app opens on the diary, never on a page inviting you to install
  // the app you are already using.
  if (isNative) return false;

  if (pathname !== "/") return false;

  // Password reset links land on "/" carrying a short-lived session. Only the
  // running app can trade that for a new password, so the landing page must
  // stand aside — otherwise the reset silently does nothing.
  if (isRecovering) return false;

  // The "account created" confirmation owns the screen until it is dismissed.
  if (justSignedUp) return false;

  return true;
}
