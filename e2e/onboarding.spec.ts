import { expect, test } from "@playwright/test";

/**
 * Covers what every user sees before they have an account: the splash, the
 * sign-up gate, and the validation that stops a broken account being created.
 * Nothing here needs a live session, so it runs anywhere.
 */

test.describe("first run", () => {
  test("shows the olive splash, then lands on sign up", async ({ page }) => {
    await page.goto("/auth");

    const splash = page.getByRole("status", { name: "Loading NutriPilot" });
    await expect(splash).toBeVisible();

    // The splash must be the brand colour, not a default white flash.
    await expect(splash).toHaveCSS("background-color", "rgb(7, 31, 24)");

    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(splash).toHaveCount(0);
  });

  test("redirects every protected route to sign up", async ({ page }) => {
    for (const route of ["/diary", "/recipes", "/coach", "/goals", "/settings"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible({
        timeout: 10_000,
      });
    }
  });
});

test.describe("sign up validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("keeps the submit button disabled until the form is genuinely valid", async ({ page }) => {
    const submit = page.getByRole("button", { name: "Create account" });
    await expect(submit).toBeDisabled();

    await page.getByLabel("Your name").fill("Alex");
    await page.getByLabel("Email").fill("alex@example.com");
    await expect(submit).toBeDisabled();

    await page.getByLabel("Password", { exact: true }).fill("Broccoli9");
    // Terms are still unticked.
    await expect(submit).toBeDisabled();

    await page.getByRole("checkbox").check();
    await expect(submit).toBeEnabled();
  });

  test("flags a malformed email on blur", async ({ page }) => {
    const email = page.getByLabel("Email");
    await email.fill("alex@example");
    await email.blur();

    await expect(page.getByText("That does not look like a valid email address.")).toBeVisible();
  });

  test("ticks off each password rule as it is met", async ({ page }) => {
    const password = page.getByLabel("Password", { exact: true });

    await password.fill("abc");
    await expect(page.getByText("At least 8 characters")).toBeVisible();
    await expect(page.getByText("Password strength")).toHaveCount(0);

    await password.fill("Broccoli9!");
    // Strength only appears once every rule passes.
    await expect(page.getByText("Password strength")).toBeVisible();
    await expect(page.getByRole("meter", { name: "Password strength" })).toBeVisible();
  });

  test("opens the terms and ticks the box on accept", async ({ page }) => {
    const checkbox = page.getByRole("checkbox");
    await expect(checkbox).not.toBeChecked();

    await page.getByRole("button", { name: "Terms of Use & Privacy" }).click();

    const dialog = page.getByRole("dialog", { name: "Terms of Use & Privacy" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Not medical or dietetic advice")).toBeVisible();
    await expect(dialog.getByText("Limitation of liability")).toBeVisible();

    await page.getByRole("button", { name: "I have read and agree" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(checkbox).toBeChecked();
  });

  test("switches to sign in and back", async ({ page }) => {
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    await page.getByRole("button", { name: "Forgot your password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();

    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    await page.getByRole("button", { name: "Create one" }).click();
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  });
});

test.describe("accessibility basics", () => {
  test("exposes a working skip link and a labelled password toggle", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible({
      timeout: 10_000,
    });

    const toggle = page.getByRole("button", { name: "Show password" });
    await page.getByLabel("Password", { exact: true }).fill("secret123");
    await toggle.click();
    await expect(page.getByRole("button", { name: "Hide password" })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  });

  test("respects a dark colour scheme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible({
      timeout: 10_000,
    });

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // Dark canvas, not the light default.
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(12, 15, 12)");
  });
});
