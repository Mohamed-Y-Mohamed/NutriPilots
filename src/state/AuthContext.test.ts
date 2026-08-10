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

  it("names a disallowed redirect as a configuration problem", () => {
    expect(friendlyAuthError("requested path is invalid")).toMatch(/allowed redirect list/i);
  });

  it("recognises the everyday cases", () => {
    expect(friendlyAuthError("Invalid login credentials")).toMatch(/do not match/i);
    expect(friendlyAuthError("Email not confirmed")).toMatch(/confirm your email/i);
    expect(friendlyAuthError("User already registered")).toMatch(/already exists/i);
    expect(friendlyAuthError("Signups not allowed for this instance")).toMatch(/disabled/i);
  });

  it("passes an unrecognised message through unchanged", () => {
    expect(friendlyAuthError("Something exotic went wrong")).toBe("Something exotic went wrong");
  });
});
