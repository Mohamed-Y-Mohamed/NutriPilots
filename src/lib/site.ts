/**
 * Where Supabase sends people after they click a link in an email.
 *
 * This must be an address Supabase is allowed to redirect to (Authentication →
 * URL Configuration). It is deliberately not derived from `window.location`:
 * inside the Capacitor shell that is a `https://localhost` app-scheme origin,
 * which is what put localhost into the confirmation emails.
 */
export const SITE_URL =
  import.meta.env.VITE_SITE_URL?.replace(/\/$/, "") ?? "https://nutripilots.netlify.app";

/** Landing page for the "confirm your email" link. */
export const EMAIL_CONFIRMATION_URL = `${SITE_URL}/verification.html`;

/** Landing page for the "reset your password" link. */
export const PASSWORD_RESET_URL = `${SITE_URL}/verification.html`;
