import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * The app used the way somebody actually uses it: log a food, take it off
 * again, talk to the coach, come back to it later, change a setting.
 *
 * Unlike the layout suite, the fake behind this one holds state. A food that is
 * logged is really there on the next screen and really gone after it is
 * removed, and a coach exchange is really written down and really read back.
 * A stub that answers every read with the same fixture cannot catch an ordering
 * bug, because nothing it returns ever depends on what was written.
 *
 * No live project and no credentials: the session is planted, and the fake
 * answers Supabase's REST, RPC and Edge Function endpoints closely enough that
 * the real components take the real code paths.
 */

const PROJECT_REF = "yhgkrbnmhgspgckvvfhe";
const USER_ID = "00000000-0000-4000-8000-000000000001";

const SESSION = {
  access_token: "test-token",
  token_type: "bearer",
  expires_in: 3600,
  refresh_token: "test-refresh",
  user: {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "sam@example.com",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  },
};

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

const RECENT_FOODS = [
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
    times_logged: 5,
    ingredient_id: null,
    recipe_id: null,
    user_ingredient_id: null,
    user_recipe_id: null,
  },
];

interface ChatRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  estimate: unknown;
  created_at: string;
  logged_at: string | null;
}

/** How the coach should answer the next message. */
type CoachMode = "reply" | "rate_limit" | "server_error";

interface Backend {
  diary: Array<Record<string, unknown>>;
  chat: ChatRow[];
  coach: CoachMode;
  /** Every Edge Function call the page made, so a blocked send is provable. */
  coachCalls: number;
}

function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * PostgREST's ordering, honestly applied — including the tie-break, which is
 * the whole point. `order=created_at.desc,role.asc` has to mean what it says,
 * or this suite would pass on a database that returns rows in any order it
 * likes and prove nothing about the bug it exists to catch.
 */
function applyOrder(rows: ChatRow[], url: URL): ChatRow[] {
  const spec = url.searchParams.get("order");
  if (!spec) return rows;

  const keys = spec.split(",").map((part) => {
    const [column, direction] = part.split(".");
    return { column: column as keyof ChatRow, descending: direction === "desc" };
  });

  return [...rows].sort((left, right) => {
    for (const { column, descending } of keys) {
      const a = String(left[column] ?? "");
      const b = String(right[column] ?? "");
      if (a !== b) return (a < b ? -1 : 1) * (descending ? -1 : 1);
    }
    return 0;
  });
}

async function signIn(page: Page) {
  await page.addInitScript((session) => {
    localStorage.setItem(
      `sb-yhgkrbnmhgspgckvvfhe-auth-token`,
      JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    );
  }, SESSION);
}

async function stubBackend(page: Page, backend: Backend) {
  await page.route(`https://${PROJECT_REF}.supabase.co/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    const send = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      });

    if (method === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    }

    const path = url.pathname;

    if (path.includes("/auth/v1/user")) return send(SESSION.user);
    if (path.includes("/auth/v1/token")) return send(SESSION);
    if (path.includes("/auth/v1/logout")) return send({});

    if (path.includes("/rpc/get_ai_usage")) {
      return send({ used: 2, daily_limit: 35, resets_at: "2099-01-01T00:00:00Z" });
    }
    if (path.includes("/rpc/daily_totals")) return send([]);
    if (path.includes("/rpc/recent_foods")) return send(RECENT_FOODS);
    if (path.includes("/user_profiles")) return send(PROFILE);

    // --- diary --------------------------------------------------------------
    if (path.includes("/diary_entries")) {
      if (method === "POST") {
        const body = request.postDataJSON() as Record<string, unknown>;
        const row = {
          ...body,
          id: `entry-${backend.diary.length + 1}`,
          created_at: new Date().toISOString(),
        };
        backend.diary.push(row);
        // supabase-js asks for a single object back, not an array of one.
        return send(row, 201);
      }
      if (method === "DELETE") {
        const match = url.searchParams.get("id")?.replace("eq.", "");
        backend.diary = backend.diary.filter((row) => row.id !== match);
        return send([]);
      }
      return send(backend.diary);
    }

    // --- coach transcript ---------------------------------------------------
    if (path.includes("/chat_messages")) {
      if (method === "DELETE") {
        backend.chat = [];
        return send([]);
      }
      if (method === "PATCH") return send([]);
      return send(applyOrder(backend.chat, url));
    }

    // --- the coach itself ---------------------------------------------------
    if (path.includes("/functions/v1/ai-chat")) {
      backend.coachCalls += 1;

      if (backend.coach === "rate_limit") {
        return send(
          {
            error: "That is a lot at once — give it 20 seconds and try again.",
            code: "rate_limit",
            usage: {
              callType: "chat",
              used: 3,
              dailyLimit: 35,
              resetsAt: "2099-01-01T00:00:00Z",
              retryAfter: 20,
            },
          },
          429,
        );
      }

      if (backend.coach === "server_error") {
        // Deliberately the sort of body a broken deployment produces. None of
        // it may reach the screen.
        return send(
          {
            error:
              'permission denied for relation "chat_messages" in function ai-chat (groq/llama-3.3-70b)',
          },
          500,
        );
      }

      const message = (request.postDataJSON() as { message: string }).message;
      const reply = `Chicken breast is a good shout — about 165 kcal per 100g.`;

      // The same trap the real function used to fall into is reproduced here on
      // purpose: both rows carry an identical timestamp, exactly as one INSERT
      // under a single transaction clock produced. The transcript must still
      // come back in the order it happened.
      const stamp = new Date().toISOString();
      backend.chat.push(
        {
          id: `msg-${backend.chat.length + 1}`,
          role: "user",
          content: message,
          estimate: null,
          created_at: stamp,
          logged_at: null,
        },
        {
          id: `msg-${backend.chat.length + 2}`,
          role: "assistant",
          content: reply,
          estimate: null,
          created_at: stamp,
          logged_at: null,
        },
      );

      return send({
        reply,
        suggestions: [],
        plan: null,
        messageId: `msg-${backend.chat.length}`,
        usage: {
          callType: "chat",
          used: 3,
          dailyLimit: 35,
          resetsAt: "2099-01-01T00:00:00Z",
        },
      });
    }

    return send([]);
  });
}

function freshBackend(): Backend {
  return { diary: [], chat: [], coach: "reply", coachCalls: 0 };
}

/** Nothing on any screen may name a table, a function, a model or a vendor. */
const INTERNALS =
  /chat_messages|diary_entries|user_profiles|ai-chat|submit-food|groq|openrouter|llama|permission denied|relation |row-level security|supabase/i;

async function expectNothingInternalOnScreen(page: Page, where: string) {
  const text = await page.locator("body").innerText();
  const match = text.match(INTERNALS);
  expect(match?.[0] ?? null, `${where} shows internals: ${match?.[0]}`).toBeNull();
}

test.describe("using the app", () => {
  let backend: Backend;

  test.beforeEach(async ({ page }) => {
    backend = freshBackend();
    await signIn(page);
    await stubBackend(page, backend);
  });

  test("logs a food, sees it counted, and takes it off again", async ({ page }) => {
    await page.goto("/diary");
    await expect(page.getByRole("heading", { name: "What did you eat?" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("tab", { name: "My foods" }).click();
    await page.getByRole("button", { name: /Chicken breast/ }).click();
    await expect(page.getByText(/Chicken breast added to/i)).toBeVisible();

    // It is really in the diary, not merely acknowledged on screen.
    expect(backend.diary).toHaveLength(1);
    expect(backend.diary[0]).toMatchObject({ name: "Chicken breast", date: today() });

    await page.getByRole("link", { name: "Today" }).click();
    await expect(page.getByRole("heading", { name: /Hello, Sam/ })).toBeVisible();
    await expect(page.getByRole("listitem").getByText("Chicken breast")).toBeVisible();
    // The ring counts it, rather than the row simply existing beside a zero.
    await expect(page.getByText("330", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /Remove Chicken breast/ }).click();
    await expect(page.getByRole("listitem").getByText("Chicken breast")).toHaveCount(0);
    expect(backend.diary).toHaveLength(0);
  });

  test("keeps a coach exchange in the order it happened after a reload", async ({ page }) => {
    await page.goto("/coach");
    await expect(page.getByRole("heading", { name: "Nutrition coach" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByPlaceholder(/ask about food/i).fill("Is chicken breast good for me?");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(/about 165 kcal per 100g/)).toBeVisible({ timeout: 10_000 });

    // The bug only ever showed itself on the way back in: live, the messages
    // were appended in order regardless of what the database would return.
    await page.reload();
    await expect(page.getByText(/about 165 kcal per 100g/)).toBeVisible({ timeout: 15_000 });

    const transcript = await page.locator("main").innerText();
    const question = transcript.indexOf("Is chicken breast good for me?");
    const answer = transcript.indexOf("about 165 kcal per 100g");

    expect(question).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(-1);
    expect(question, "the reply is sitting above the question").toBeLessThan(answer);
  });

  test("counts down a rate limit instead of failing the next press", async ({ page }) => {
    backend.coach = "rate_limit";

    await page.goto("/coach");
    await expect(page.getByRole("heading", { name: "Nutrition coach" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByPlaceholder(/ask about food/i).fill("How much protein?");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByRole("status")).toContainText(/send again in \d+ seconds/i, {
      timeout: 10_000,
    });
    expect(backend.coachCalls).toBe(1);

    // The send button is the obvious next move, and it must not spend another
    // call to earn the same refusal.
    const send = page.getByRole("button", { name: /available in/i });
    await expect(send).toBeDisabled();
    await send.click({ force: true });
    await page.waitForTimeout(500);
    expect(backend.coachCalls, "a second call went out inside the cooldown").toBe(1);

    await expectNothingInternalOnScreen(page, "the rate-limited coach");
  });

  test("says nothing about the server when the server breaks", async ({ page }) => {
    backend.coach = "server_error";

    await page.goto("/coach");
    await expect(page.getByRole("heading", { name: "Nutrition coach" })).toBeVisible({
      timeout: 15_000,
    });

    await page.getByPlaceholder(/ask about food/i).fill("How much protein?");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("alert")).toContainText(/try again/i);
    await expectNothingInternalOnScreen(page, "the failing coach");
  });

  test("changes a setting and clears the conversation", async ({ page }) => {
    backend.chat = [
      {
        id: "old-1",
        role: "user",
        content: "Something I asked before",
        estimate: null,
        created_at: "2026-08-29T10:00:00Z",
        logged_at: null,
      },
      {
        id: "old-2",
        role: "assistant",
        content: "Something the coach answered",
        estimate: null,
        created_at: "2026-08-29T10:00:00Z",
        logged_at: null,
      },
    ];

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: /Appearance/ }).first().click();
    await page.getByRole("button", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByRole("button", { name: /Your data/ }).first().click();

    // Deleting is two deliberate taps: the row arms, then confirms. Anything
    // that erases data should be hard to do by accident.
    const conversation = page
      .getByRole("listitem")
      .filter({ hasText: "Coach conversation" })
      .or(page.locator("div").filter({ hasText: /^Coach conversation/ }))
      .first();
    await conversation.getByRole("button", { name: "Delete", exact: true }).click();
    await conversation.getByRole("button", { name: "Confirm delete" }).click();

    await expect(page.getByText(/coach conversation has been deleted/i)).toBeVisible();
    expect(backend.chat).toHaveLength(0);

    await expectNothingInternalOnScreen(page, "settings");
  });
});
