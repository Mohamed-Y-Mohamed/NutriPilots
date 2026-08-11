import { describe, expect, it } from "vitest";
import { shouldShowLanding, type LandingContext } from "./routing";

const web: LandingContext = {
  isNative: false,
  pathname: "/",
  isRecovering: false,
  justSignedUp: false,
};

describe("shouldShowLanding", () => {
  it("shows the landing page at the root of the website", () => {
    expect(shouldShowLanding(web)).toBe(true);
  });

  it("never shows it inside the Android app", () => {
    // The installed app must not open on a page selling the app.
    expect(shouldShowLanding({ ...web, isNative: true })).toBe(false);
  });

  it("stays out of the way of a password reset", () => {
    // Reset links land on "/" with the session in the URL. If the landing page
    // renders, the reset is swallowed and the user can never set a password.
    expect(shouldShowLanding({ ...web, isRecovering: true })).toBe(false);
  });

  it("stays out of the way of the account-created confirmation", () => {
    expect(shouldShowLanding({ ...web, justSignedUp: true })).toBe(false);
  });

  it("leaves every other route alone", () => {
    for (const pathname of ["/auth", "/today", "/diary", "/settings", "/verification.html"]) {
      expect(shouldShowLanding({ ...web, pathname })).toBe(false);
    }
  });

  it("is not fooled by a trailing segment on the root", () => {
    expect(shouldShowLanding({ ...web, pathname: "//" })).toBe(false);
    expect(shouldShowLanding({ ...web, pathname: "/home" })).toBe(false);
  });

  it("keeps native out even on a path the web would show", () => {
    // Belt and braces: native wins over every other condition.
    expect(
      shouldShowLanding({ isNative: true, pathname: "/", isRecovering: false, justSignedUp: false }),
    ).toBe(false);
  });
});
