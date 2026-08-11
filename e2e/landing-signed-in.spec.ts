import { expect, test, type Page } from "@playwright/test";

/**
 * The landing page as a signed-in visitor sees it: the "Log in" button is
 * replaced by a menu into the app, ending in sign out.
 *
 * A session is seeded directly rather than typed in, so the test covers the
 * header rather than the login form, and needs no live Supabase.
 */

const USER = {
  id: "e2e-user",
  email: "person@example.com",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};

const SESSION = {
  access_token: "e2e.access.token",
  token_type: "bearer",
  expires_in: 3600,
  refresh_token: "e2e.refresh.token",
  user: USER,
};

async function signIn(page: Page) {
  await page.route("**/auth/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION) }),
  );
  await page.route("**/rest/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.addInitScript((session) => {
    localStorage.setItem(
      "sb-yhgkrbnmhgspgckvvfhe-auth-token",
      JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    );
  }, SESSION);
}

test.describe("landing page, signed in", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 8000 });
  });

  test("swaps the log in button for a menu", async ({ page }) => {
    const header = page.getByRole("banner");
    await expect(header.getByRole("link", { name: /^log in$/i })).toHaveCount(0);
    await expect(header.getByRole("button", { name: /menu/i })).toBeVisible();

    // The footer follows the session too, rather than inviting a signed-in
    // person to log in again.
    await expect(page.getByRole("contentinfo").getByRole("link", { name: /^log in$/i })).toHaveCount(0);
  });

  test("the menu reaches every signed-in page, with sign out last", async ({ page }) => {
    const trigger = page.getByRole("button", { name: /menu/i });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    const items = page.getByRole("menuitem");
    const labels = (await items.allInnerTexts()).map((text) => text.trim().toLowerCase());

    for (const destination of ["today", "recipes", "coach", "goals", "settings"]) {
      expect(labels.some((label) => label.includes(destination))).toBe(true);
    }
    // Sign out is destructive, so it sits at the end where it cannot be hit by
    // someone aiming for the item above it.
    expect(labels.at(-1)).toMatch(/sign out/);
  });

  test("closes on Escape and hands focus back to the trigger", async ({ page }) => {
    const trigger = page.getByRole("button", { name: /menu/i });
    await trigger.click();
    await expect(page.getByRole("menu")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("navigates into the app", async ({ page }) => {
    await page.getByRole("button", { name: /menu/i }).click();
    await page.getByRole("menuitem", { name: /today/i }).click();
    await expect(page).toHaveURL(/\/today$/);
  });

  test("the hero points at the app rather than at sign up", async ({ page }) => {
    await expect(page.getByRole("main").getByRole("link", { name: /today|dashboard/i }).first()).toBeVisible();
  });
});
