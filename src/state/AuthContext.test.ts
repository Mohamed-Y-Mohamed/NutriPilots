import { describe, expect, it } from "vitest";
import { friendlyAuthError } from "./AuthContext";
import { EMAIL_CONFIRMATION_URL, PASSWORD_RESET_URL, SITE_URL } from "../lib/site";

describe("email redirect targets", () => {
  it("points at the deployed site, never localhost", () => {
    // The Capacitor shell serves the app from an https://localhost app scheme.
    // Deriving the redirect from window.location put that unreachable address
    // into real confirmation emails.
    expect(SITE_URL).toMatch(/^https:\/\//);
    expect(SITE_URL).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it("sends confirmations to the verification page", () => {
    expect(EMAIL_CONFIRMATION_URL).toBe(`${SITE_URL}/verification.html`);
  });

  it("carries no query string of its own", () => {
    // Supabase appends its own callback data; anything added here is either
    // overwritten or makes the URL fail the allow-list match.
    expect(EMAIL_CONFIRMATION_URL).not.toContain("?");
    expect(PASSWORD_RESET_URL).not.toContain("?");
  });

  it("has no trailing slash before the path", () => {
    expect(EMAIL_CONFIRMATION_URL).not.toContain("//verification");
  });
});

describe("friendlyAuthError", () => {
  it("explains an SMTP failure rather than leaking the raw error", () => {
    expect(friendlyAuthError("Error sending confirmation email")).toMatch(
      /could not send the confirmation email/i,
    );
  });

  /**
   * A misconfigured redirect allow-list is ours to fix. Telling the person
   * signing up which list is wrong describes our deployment to them and leaves
   * them with nothing to do about it either way.
   */
  it("treats a disallowed redirect as our problem, without describing it", () => {
    const message = friendlyAuthError("requested path is invalid");

    expect(message).toMatch(/temporarily unavailable/i);
    expect(message).not.toMatch(/redirect|supabase|allow.?list/i);
  });

  it("recognises the everyday cases", () => {
    expect(friendlyAuthError("Invalid login credentials")).toMatch(/do not match/i);
    expect(friendlyAuthError("Email not confirmed")).toMatch(/confirm your email/i);
    expect(friendlyAuthError("User already registered")).toMatch(/already exists/i);
    expect(friendlyAuthError("Signups not allowed for this instance")).toMatch(/disabled/i);
  });

  /**
   * The unmapped cases are the dangerous ones: they are written for a developer
   * and can name an internal table or the exact database fault. Passing them
   * through put all of that on the sign-in screen.
   */
  it("replaces an unrecognised message rather than passing it through", () => {
    const raw = 'Database error saving new user: relation "profiles" does not exist';

    const message = friendlyAuthError(raw);

    expect(message).not.toContain("relation");
    expect(message).not.toContain("profiles");
    expect(message).toMatch(/try again/i);
  });
});
