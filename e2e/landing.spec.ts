import { expect, test } from "@playwright/test";

/**
 * The public landing page at "/".
 *
 * Written against the page's contract rather than its markup, so a redesign
 * does not break it: landmarks, headings, the sign-in route, the theme control
 * and the footer must all survive whatever the layout becomes.
 *
 * Signed-in behaviour (the hamburger menu) needs a session and is covered by
 * the component tests instead.
 */

test.describe("landing page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("greets a visitor without making them wait on the splash", async ({ page }) => {
    // Deliberately no splash here: a first-time visitor who waits is a visitor
    // who leaves. The heading must be up almost immediately.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 4000 });
    await expect(page.getByRole("status", { name: "Loading NutriPilot" })).toHaveCount(0);
  });

  test("exposes proper landmarks and a single h1", async ({ page }) => {
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("offers a way in for someone with no account", async ({ page }) => {
    const signIn = page.getByRole("link", { name: /log in|sign in|get started/i }).first();
    await expect(signIn).toBeVisible();
    await signIn.click();
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("switches theme from the header and remembers the choice", async ({ page }) => {
    const html = page.locator("html");
    const before = await html.getAttribute("data-theme");

    await page.getByRole("button", { name: /dark mode|light mode|theme/i }).first().click();
    await expect(html).not.toHaveAttribute("data-theme", before ?? "light");

    const after = await html.getAttribute("data-theme");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", after ?? "dark");
  });

  test("never scrolls sideways, at any phone width", async ({ page }) => {
    for (const width of [320, 360, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);

      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test("carries a footer with the store badge and the deletion route Play requires", async ({
    page,
  }) => {
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByText(new RegExp(String(new Date().getFullYear())))).toBeVisible();
    await expect(footer.getByText(/google play|play store/i).first()).toBeVisible();
    await expect(footer.getByRole("link", { name: /delete account/i })).toBeVisible();
  });

  test("reads correctly in dark mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(12, 15, 12)");
  });
});
