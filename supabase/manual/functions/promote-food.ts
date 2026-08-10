// ============================================================================
// NutriPilot Edge Function: promote-food
//
// GENERATED FILE — do not edit. Edit supabase/functions/promote-food/index.ts (and
// supabase/functions/_shared/*) then run: npm run bundle:functions
//
// This is a single-file copy for pasting into the Supabase dashboard when the
// CLI is not available. The shared modules are inlined below.
// ============================================================================


import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function preflight(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
/**
 * A client that acts as the calling user. Every query it runs is subject to
 * row level security, so a function can never read another user's rows by
 * accident.
 */
export function userClient(authorization: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
}

/** Bypasses RLS. Only for deletes/cleanup that RLS cannot express. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface AuthedUser {
  id: string;
  email: string | null;
}

/**
 * Resolves the bearer token to a real user. Returns null when the token is
 * missing, expired or invalid — callers must treat that as 401.
 */
export async function requireUser(
  request: Request,
): Promise<{ user: AuthedUser; authorization: string } | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const client = userClient(authorization);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  return {
    user: { id: data.user.id, email: data.user.email ?? null },
    authorization,
  };
}
/**
 * Contributes a user's own food or recipe to the shared reference tables.
 *
 * Runs after a user saves something to their library. If the food is not
 * already in `public.ingredients` / `public.recipes`, a copy is added there so
 * everyone benefits. The user's own row is never touched or removed — they keep
 * their copy either way.
 *
 * Only AI-approved entries are promoted. Something the reviewer was unsure
 * about stays private, because a shared database is worth less than nothing if
 * it is full of guesses.
 *
 * The shared tables are written with the service role, since they are read-only
 * to clients by design.
 */


Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authed = await requireUser(request);
  if (!authed) return json({ error: "Please sign in first." }, 401);

  let body: { type?: unknown; id?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const type = body.type === "recipe" ? "recipe" : body.type === "ingredient" ? "ingredient" : null;
  if (!type || typeof body.id !== "string") {
    return json({ error: "Specify type and id." }, 400);
  }

  const client = userClient(authed.authorization);
  const admin = adminClient();

  try {
    return type === "ingredient"
      ? await promoteIngredient(client, admin, body.id)
      : await promoteRecipe(client, admin, body.id);
  } catch (error) {
    console.error("[promote-food]", error instanceof Error ? error.message : "unknown");
    // Promotion is a bonus, never the point of the request. The user's own copy
    // is already saved, so a failure here must not read as a failure to them.
    return json({ promoted: false, reason: "error" }, 200);
  }
});

// ---------------------------------------------------------------------------

async function promoteIngredient(
  client: ReturnType<typeof userClient>,
  admin: ReturnType<typeof adminClient>,
  id: string,
): Promise<Response> {
  // RLS means this only ever finds a row the caller owns.
  const { data: own } = await client
    .from("user_ingredients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!own) return json({ promoted: false, reason: "not_found" }, 404);

  if (own.verification?.verdict !== "approved") {
    return json({ promoted: false, reason: "not_approved" }, 200);
  }

  const name = String(own.name ?? "").trim();
  if (name.length < 2) return json({ promoted: false, reason: "invalid" }, 200);

  // `normalized_name` is a generated lower/trimmed column, so this is an exact
  // match on the same basis the reference data uses.
  const { data: existing } = await admin
    .from("ingredients")
    .select("id,name")
    .eq("normalized_name", normalise(name))
    .limit(1);

  if (existing && existing.length > 0) {
    return json({ promoted: false, reason: "already_exists", match: existing[0].name }, 200);
  }

  // The shared table fixes the basis at exactly 100, so anything else cannot be
  // represented there faithfully.
  if (Number(own.basis_quantity) !== 100) {
    return json({ promoted: false, reason: "unsupported_basis" }, 200);
  }

  const { error } = await admin.from("ingredients").insert({
    name,
    brand: own.brand,
    food_type: "ingredient",
    basis_quantity: 100,
    basis_unit: own.basis_unit === "ml" ? "ml" : "g",
    calories_kcal: own.calories_kcal,
    protein_g: own.protein_g,
    carbohydrates_g: own.carbohydrates_g,
    fat_g: own.fat_g,
    saturated_fat_g: own.saturated_fat_g,
    sugars_g: own.sugars_g,
    fibre_g: own.fibre_g,
    salt_g: own.salt_g,
    sodium_mg: own.sodium_mg,
    category: own.category,
    dietary_tags: own.dietary_tags,
    source_provider: "manual",
    // Keeps the unique (source_provider, external_id) pair stable, so a repeat
    // promotion of the same row conflicts instead of duplicating.
    external_id: `user:${own.id}`,
    nutrition_data_type: "estimated",
    estimation_method: "user_submitted_ai_verified",
    confidence_score: own.verification?.confidence === "high" ? 70 : 50,
    verified: false,
  });

  if (error) {
    // A duplicate here means another request won the race; that is a success.
    const duplicate = error.code === "23505";
    console.error("[promote-food] ingredient insert", error.message);
    return json({ promoted: duplicate, reason: duplicate ? "already_exists" : "rejected" }, 200);
  }

  return json({ promoted: true, reason: "added" }, 201);
}

async function promoteRecipe(
  client: ReturnType<typeof userClient>,
  admin: ReturnType<typeof adminClient>,
  id: string,
): Promise<Response> {
  const { data: own } = await client
    .from("user_recipes")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!own) return json({ promoted: false, reason: "not_found" }, 404);

  if (own.verification?.verdict !== "approved") {
    return json({ promoted: false, reason: "not_approved" }, 200);
  }

  const name = String(own.name ?? "").trim();
  const { data: existing } = await admin
    .from("recipes")
    .select("id,name")
    .ilike("name", name)
    .limit(1);

  if (existing && existing.length > 0) {
    return json({ promoted: false, reason: "already_exists", match: existing[0].name }, 200);
  }

  const ingredients = Array.isArray(own.ingredients) ? own.ingredients : [];
  const description = String(own.description ?? "").trim();
  const instructions = String(own.instructions ?? "").trim();
  const tags = Array.isArray(own.dietary_tags) ? own.dietary_tags : [];

  // The shared table enforces all of these. Checking here turns a constraint
  // violation into a clear reason the UI can explain.
  const baseDiets = tags.filter((tag: string) =>
    ["vegan", "vegetarian", "pescatarian", "omnivore"].includes(tag)
  );

  if (
    ingredients.length === 0 ||
    description.length <= 10 ||
    instructions.length <= 10 ||
    baseDiets.length !== 1
  ) {
    return json({ promoted: false, reason: "incomplete" }, 200);
  }

  const { error } = await admin.from("recipes").insert({
    name,
    description,
    // The reference table requires an https image; user recipes have none, and
    // an invented URL would be worse than an honest placeholder.
    image_url: own.image_url ?? null,
    servings: own.servings,
    prep_time_minutes: own.prep_time_minutes,
    cook_time_minutes: own.cook_time_minutes,
    instructions,
    calories_per_serving: own.calories_per_serving,
    protein_per_serving_g: own.protein_per_serving_g,
    carbs_per_serving_g: own.carbs_per_serving_g,
    fat_per_serving_g: own.fat_per_serving_g,
    fibre_per_serving_g: own.fibre_per_serving_g ?? 0,
    saturated_fat_per_serving_g: own.saturated_fat_per_serving_g ?? 0,
    sugar_per_serving_g: own.sugar_per_serving_g ?? 0,
    sodium_per_serving_mg: own.sodium_per_serving_mg ?? 0,
    cholesterol_per_serving_mg: 0,
    cuisine: own.cuisine,
    dietary_tags: tags,
    ingredients,
    ingredient_count: ingredients.length,
    source_provider: "manual",
    external_id: `user:${own.id}`,
    // `video_url` is NOT NULL and must be https. A search link is a real,
    // working destination for this dish rather than a fabricated video id.
    video_url: `https://www.youtube.com/results?search_query=${
      encodeURIComponent(`${name} recipe`)
    }`,
    video_verified_short: false,
  });

  if (error) {
    const duplicate = error.code === "23505";
    console.error("[promote-food] recipe insert", error.message);
    return json({ promoted: duplicate, reason: duplicate ? "already_exists" : "rejected" }, 200);
  }

  return json({ promoted: true, reason: "added" }, 201);
}

function normalise(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
