import { expect, test, type Page } from "@playwright/test";

/**
 * Layout checks for the signed-in screens, across the widths people actually
 * hold.
 *
 * There is no live account here. A session is planted in storage and every
 * Supabase call is answered with a fixture, so the real components render real
 * data without the suite needing credentials or leaving anything behind. What
 * is being tested is layout, and layout does not care where the rows came from.
 *
 * The assertion that matters is horizontal overflow. A phone that scrolls
 * sideways is the single most common way a mobile layout breaks, and it is
 * invisible on a desktop browser — which is where this kind of bug is
 * introduced in the first place.
 */

const PROJECT_REF = "yhgkrbnmhgspgckvvfhe";
const USER_ID = "00000000-0000-4000-8000-000000000001";

/** The widths that matter: smallest phone still supported, up to a tablet. */
const WIDTHS = [
  { name: "iPhone SE", width: 320, height: 568 },
  { name: "iPhone 12/13", width: 390, height: 844 },
  { name: "Pixel 7", width: 412, height: 915 },
  { name: "iPhone Pro Max", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
];

const PROFILE = {
  display_name: "Sam",
  age: 34,
  calculation_sex: "male",
  height_cm: 180,
  weight_kg: 84.2,
  target_weight_kg: 78,
  activity_level: "moderate",
  goal_mode: "lose",
  theme: "light",
  onboarded: true,
  target_calories: null,
  target_protein_g: null,
  target_carbs_g: null,
  target_fat_g: null,
  target_fibre_g: null,
  targets_source: null,
  targets_set_at: null,
};

/** Deliberately long names — the case that used to push controls off screen. */
const DIARY = [
  {
    id: "d1",
    name: "Slow-roasted lamb shoulder with garlic, rosemary and new potatoes",
    amount: 1,
    unit: "meal",
    meal: "Lunch",
    calories: 733.1,
    protein: 44.5,
    carbs: 52.2,
    fat: 38.9,
    fibre: 6.1,
    date: today(),
    source: "ai_photo",
    servings: null,
    notes: null,
    ingredient_id: null,
    recipe_id: null,
    user_ingredient_id: null,
    user_recipe_id: null,
    created_at: new Date().toISOString(),
  },
  {
    id: "d2",
    name: "Porridge",
    amount: 60,
    unit: "g",
    meal: "Breakfast",
    calories: 226,
    protein: 8,
    carbs: 40,
    fat: 4,
    fibre: 6,
    date: today(),
    source: "ingredient",
    servings: null,
    notes: null,
    ingredient_id: null,
    recipe_id: null,
    user_ingredient_id: null,
    user_recipe_id: null,
    created_at: new Date().toISOString(),
  },
];

const RECENT_FOODS = [
  {
    name: "Greek yoghurt, 0% fat, with honey and toasted flaked almonds",
    source: "ingredient",
    unit: "g",
    amount: 170,
    calories: 168,
    protein: 17,
    carbs: 14,
    fat: 4,
    last_logged: new Date().toISOString(),
    times_logged: 12,
    ingredient_id: null,
    recipe_id: null,
    user_ingredient_id: null,
    user_recipe_id: null,
  },
  {
    name: "Chicken breast",
    source: "ingredient",
    unit: "g",
    amount: 200,
    calories: 330,
    protein: 62,
    carbs: 0,
    fat: 7,
    last_logged: new Date().toISOString(),
    times_logged: 7,
    ingredient_id: null,
    recipe_id: null,
    user_ingredient_id: null,
    user_recipe_id: null,
  },
  {
    name: "Overnight oats",
    source: "user_recipe",
    unit: "serving",
    amount: 1,
    calories: 310,
    protein: 14,
    carbs: 45,
    fat: 8,
    last_logged: new Date().toISOString(),
    times_logged: 4,
    ingredient_id: null,
    recipe_id: null,
    user_ingredient_id: null,
    user_recipe_id: null,
  },
  {
    name: "Wholemeal seeded sandwich loaf",
    source: "ingredient",
    unit: "g",
    amount: 80,
    calories: 196,
    protein: 8,
    carbs: 32,
    fat: 3,
    last_logged: new Date().toISOString(),
    times_logged: 3,
    ingredient_id: null,
    recipe_id: null,
    user_ingredient_id: null,
    user_recipe_id: null,
  },
];

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** A year of daily totals, so the Year view has twelve populated bars. */
function dailyTotals() {
  const rows = [];
  for (let back = 0; back < 365; back += 1) {
    // Roughly two days in three logged, so gaps are represented too.
    if (back % 3 === 2) continue;
    const day = new Date();
    day.setDate(day.getDate() - back);
    rows.push({
      day: day.toISOString().slice(0, 10),
      calories: 1800 + ((back * 37) % 900),
      protein: 110 + (back % 40),
      carbs: 180 + (back % 60),
      fat: 60 + (back % 25),
      fibre: 20 + (back % 12),
      items: 3 + (back % 4),
    });
  }
  return rows;
}

async function signIn(page: Page) {
  await page.addInitScript(
    ({ ref, userId }) => {
      const hour = Math.floor(Date.now() / 1000) + 3600;
      window.localStorage.setItem(
        `sb-${ref}-auth-token`,
        JSON.stringify({
          access_token: "test-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: hour,
          refresh_token: "test-refresh",
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "sam@example.com",
            email_confirmed_at: new Date().toISOString(),
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        }),
      );
      window.localStorage.setItem("nutripilot.theme", "light");
    },
    { ref: PROJECT_REF, userId: USER_ID },
  );
}

const FRESH_PROFILE = {
  display_name: null,
  age: null,
  calculation_sex: null,
  height_cm: null,
  weight_kg: null,
  target_weight_kg: null,
  activity_level: null,
  goal_mode: null,
  theme: "light",
  onboarded: false,
  target_calories: null,
  target_protein_g: null,
  target_carbs_g: null,
  target_fat_g: null,
  target_fibre_g: null,
  targets_source: null,
  targets_set_at: null,
};

async function stubSupabase(page: Page, { fresh = false } = {}) {
  await page.route(`https://${PROJECT_REF}.supabase.co/**`, async (route) => {
    const url = route.request().url();
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });

    if (route.request().method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    }

    if (url.includes("/auth/v1/user")) {
      return json({
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "sam@example.com",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      });
    }
    if (url.includes("/auth/v1/token")) {
      return json({
        access_token: "test-token",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "test-refresh",
        user: { id: USER_ID, aud: "authenticated", role: "authenticated" },
      });
    }
    if (url.includes("/rpc/daily_totals")) return json(dailyTotals());
    if (url.includes("/rpc/recent_foods")) return json(RECENT_FOODS);
    if (url.includes("/user_profiles")) return json(fresh ? FRESH_PROFILE : PROFILE);
    if (url.includes("/diary_entries")) return json(fresh ? [] : DIARY);
    if (url.includes("/chat_messages")) return json([]);
    if (url.includes("/functions/v1/")) return json({ used: 2, dailyLimit: 20 });

    return json([]);
  });
}

/**
 * Nothing may make the page scroll sideways. A couple of pixels of slack
 * absorbs sub-pixel rounding, which is not a layout bug.
 */
async function expectNoSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow, `${where} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(2);
}

/** Every element has to sit inside the viewport, not merely the body. */
async function expectNothingClipped(page: Page, where: string) {
  const strays = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const element of Array.from(document.querySelectorAll("body *"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      // Only flag what is genuinely painted outside the frame.
      if (box.right > width + 2 || box.left < -2) {
        const tag = element.tagName.toLowerCase();
        const cls = (element.getAttribute("class") ?? "").slice(0, 60);
        out.push(`${tag}.${cls} → left ${Math.round(box.left)}, right ${Math.round(box.right)}`);
      }
    }
    return out.slice(0, 8);
  });
  expect(strays, `${where} paints outside the viewport`).toEqual([]);
}

test.describe("signed-in layout", () => {
  // The viewport is set per test, so the device projects would only duplicate.
  test.skip(({ browserName }) => browserName !== "chromium", "layout only");

  for (const size of WIDTHS) {
    test(`Today holds together at ${size.name} (${size.width}px)`, async ({ page }) => {
      await signIn(page);
      await stubSupabase(page);
      await page.setViewportSize({ width: size.width, height: size.height });

      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: /Hello, Sam|Your day/ })).toBeVisible({
        timeout: 15_000,
      });

      // Quick add and the trends card both have to be there and behave.
      await expect(page.getByRole("heading", { name: "Quick add" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Your intake" })).toBeVisible();

      await expectNoSidewaysScroll(page, `Today at ${size.width}px`);
      await expectNothingClipped(page, `Today at ${size.width}px`);
    });

    test(`the trend ranges all fit at ${size.name} (${size.width}px)`, async ({ page }) => {
      await signIn(page);
      await stubSupabase(page);
      await page.setViewportSize({ width: size.width, height: size.height });

      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: "Your intake" })).toBeVisible({
        timeout: 15_000,
      });

      for (const range of ["Week", "Month", "Year"]) {
        await page.getByRole("tablist", { name: "Range" }).getByRole("tab", { name: range }).click();
        // A month is thirty bars on a 320px screen: the tightest case there is.
        await expect(page.getByRole("figure")).toBeVisible();
        await expectNoSidewaysScroll(page, `${range} trends at ${size.width}px`);
        await expectNothingClipped(page, `${range} trends at ${size.width}px`);
      }
    });

    test(`Settings targets editor fits at ${size.name} (${size.width}px)`, async ({ page }) => {
      await signIn(page);
      await stubSupabase(page);
      await page.setViewportSize({ width: size.width, height: size.height });

      await page.goto("/settings");
      await page.getByRole("button", { name: /Daily targets/ }).click();

      await expect(page.getByRole("button", { name: "Edit targets" })).toBeVisible({
        timeout: 15_000,
      });
      await expectNoSidewaysScroll(page, `Settings at ${size.width}px`);

      await page.getByRole("button", { name: "Edit targets" }).click();
      await expect(page.getByLabel(/Calories/)).toBeVisible();

      await expectNoSidewaysScroll(page, `targets editor at ${size.width}px`);
      await expectNothingClipped(page, `targets editor at ${size.width}px`);
    });
  }

  test("the coach hint only appears once a limit is passed", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/settings");
    await page.getByRole("button", { name: /Daily targets/ }).click();
    await page.getByRole("button", { name: "Edit targets" }).click();

    const hint = page.getByText(/it can set a figure beyond this limit/);
    await expect(hint).toHaveCount(0);

    // 900 kcal is under the 1500 floor for this profile.
    const calories = page.getByLabel(/Calories/);
    await calories.fill("900");
    await expect(hint).toBeVisible();

    // Back inside the range and it goes away again.
    await calories.fill("2200");
    await expect(hint).toHaveCount(0);
  });

  /**
   * Someone who has signed up and not filled anything in must be shown the
   * prompt, never a number. The formula on an empty profile returns the safety
   * floor, and 1,200 kcal presented as "worked out from your height and
   * weight" is a figure nobody gave being passed off as one they did — which
   * is also how you teach people to enter fake stats to get past a gate.
   */
  test("a brand-new account is asked to set goals, not shown invented ones", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page, { fresh: true });
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/today");
    await expect(page.getByRole("heading", { name: /Let.s get you set up/ })).toBeVisible({
      timeout: 15_000,
    });

    // Nothing that implies a target exists.
    await expect(page.getByText(/kcal left|kcal over/)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your intake" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Quick add" })).toHaveCount(0);

    // Nor in Settings, which is where the invented figure used to appear.
    await page.goto("/settings");
    await page.getByRole("button", { name: /Daily targets/ }).click();

    await expect(page.getByRole("button", { name: "Set your goals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit targets" })).toHaveCount(0);
    await expect(page.getByText("1,200")).toHaveCount(0);

    // And the way in is a button they choose to press, not a redirect.
    await page.getByRole("button", { name: "Set your goals" }).click();
    await expect(page).toHaveURL(/\/goals/);
  });

  test("a long food name keeps its controls inside the row", async ({ page }) => {
    await signIn(page);
    await stubSupabase(page);
    await page.setViewportSize({ width: 320, height: 568 });

    await page.goto("/dashboard");
    await expect(page.getByText("Slow-roasted lamb shoulder", { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    const remove = page.getByRole("button", { name: /^Remove Slow-roasted/ });
    const box = await remove.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(box!.x).toBeGreaterThanOrEqual(0);
  });
});
