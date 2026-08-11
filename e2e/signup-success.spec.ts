import { expect, test, type Page } from "@playwright/test";

/**
 * Covers the screen shown after an account is created, with email confirmation
 * switched off. Supabase is stubbed so the flow can be exercised without
 * creating real accounts.
 */

async function stubSignUp(page: Page) {
  await page.route("**/auth/v1/signup**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        // A session means confirmation is off and the account is live.
        access_token: "stub-access-token",
        refresh_token: "stub-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user: { id: "stub-user", email: "alex@example.com" },
      }),
    });
  });
}

async function completeSignUpForm(page: Page) {
  await page.getByLabel("Your name").fill("Alex");
  await page.getByLabel("Email").fill("alex@example.com");
  await page.getByLabel("Password", { exact: true }).fill("Broccoli9!");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
}

test.beforeEach(async ({ page }) => {
  await stubSignUp(page);
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible({
    timeout: 10_000,
  });
});

test("confirms the account was created instead of asking for an email", async ({ page }) => {
  await completeSignUpForm(page);

  await expect(page.getByRole("heading", { name: "Sign-up complete" })).toBeVisible();
  // The confirmation-email step must not appear when confirmation is disabled.
  await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);
  await expect(page.getByText(/taking you to sign in in \d+s/i)).toBeVisible();
});

test("moves to sign in on its own", async ({ page }) => {
  await completeSignUpForm(page);
  await expect(page.getByRole("heading", { name: "Sign-up complete" })).toBeVisible();

  // Nobody should be stranded here; the countdown finishes the job.
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible({
    timeout: 9_000,
  });
});

test("skips the wait when asked", async ({ page }) => {
  await completeSignUpForm(page);
  await page.getByRole("button", { name: "Continue to sign in" }).click();

  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  // The email is kept, so signing in is one password away.
  await expect(page.getByLabel("Email")).toHaveValue("alex@example.com");
});

test("goes back to sign up", async ({ page }) => {
  await completeSignUpForm(page);
  await page.getByRole("button", { name: "Back to sign up" }).click();

  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByLabel("Your name")).toBeVisible();
});

/**
 * The same form, with email confirmation switched back on. Supabase then
 * returns a user and no session, and the app must ask the user to check their
 * inbox rather than telling them the account is ready to use.
 */
test.describe("with email confirmation enabled", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/auth/v1/signup**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        // No session: GoTrue withholds it until the link is clicked.
        body: JSON.stringify({
          id: "stub-user",
          email: "alex@example.com",
          confirmation_sent_at: new Date().toISOString(),
        }),
      });
    });
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("asks the user to check their inbox", async ({ page }) => {
    await completeSignUpForm(page);

    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("alex@example.com")).toBeVisible();
    await expect(page.getByText(/return to the app and sign in/i)).toBeVisible();

    // The "account is ready" screen belongs to the other configuration.
    await expect(page.getByRole("heading", { name: "Sign-up complete" })).toHaveCount(0);
  });

  test("offers a way onward and a way back", async ({ page }) => {
    await completeSignUpForm(page);

    await page.getByRole("button", { name: /use a different email/i }).click();
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();

    await completeSignUpForm(page);
    await page.getByRole("button", { name: /i have confirmed/i }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  });
});
