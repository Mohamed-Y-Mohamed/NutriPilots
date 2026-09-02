/**
 * Demo data for marketing screenshots. Consumed by capture-marketing.mjs.
 *
 * Field names match the row shapes the repositories in src/services select —
 * snake_case as PostgREST returns it, not the camelCase the app maps to. If a
 * screen captures empty, check the select list in the matching repository
 * before touching anything here.
 *
 * A day that looks like a good day: a real deficit, protein hit, nothing
 * performative. Screens are supposed to look achievable, not aspirational.
 *
 * The diary, profile and coach rows below are written by hand — they have to
 * tell the story in §3 of docs/launch-video.md, and real data does not.
 *
 * Recipes are the exception and come from marketing-recipes.json, pulled
 * verbatim out of production. They carry real photography, and the Play listing
 * requires genuine in-app footage; invented recipe cards would be neither. See
 * the licensing note in docs/launch-video.md §5 before shipping those frames.
 */

import recipesFromProduction from "./marketing-recipes.json" with { type: "json" };

export const SESSION = {
  access_token: "capture.access.token",
  token_type: "bearer",
  expires_in: 3600,
  refresh_token: "capture.refresh.token",
  user: {
    id: "capture-user",
    email: "sam@example.com",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-04T09:00:00.000Z",
  },
};

const DAY = "2026-09-01";

/** Totals land near 1,870 kcal / 148 g protein against a 2,150 target. */
const diary_entries = [
  {
    id: "diary-1", name: "Porridge oats", amount: 60, unit: "g", meal: "Breakfast",
    calories: 227, protein: 8.1, carbs: 36.0, fat: 4.6, fibre: 5.4,
    date: DAY, source: "ingredient", servings: null, notes: null,
    ingredient_id: "ing-001", recipe_id: null, user_ingredient_id: null, user_recipe_id: null,
    created_at: `${DAY}T07:42:00.000Z`,
  },
  {
    id: "diary-2", name: "Greek yoghurt, 0% fat", amount: 170, unit: "g", meal: "Breakfast",
    calories: 97, protein: 17.0, carbs: 6.8, fat: 0.7, fibre: 0,
    date: DAY, source: "ingredient", servings: null, notes: null,
    ingredient_id: "ing-002", recipe_id: null, user_ingredient_id: null, user_recipe_id: null,
    created_at: `${DAY}T07:45:00.000Z`,
  },
  {
    id: "diary-3", name: "Chicken breast, grilled", amount: 165, unit: "g", meal: "Lunch",
    calories: 273, protein: 51.2, carbs: 0, fat: 6.4, fibre: 0,
    date: DAY, source: "ingredient", servings: null, notes: null,
    ingredient_id: "ing-003", recipe_id: null, user_ingredient_id: null, user_recipe_id: null,
    created_at: `${DAY}T12:58:00.000Z`,
  },
  {
    id: "diary-4", name: "Basmati rice, cooked", amount: 180, unit: "g", meal: "Lunch",
    calories: 232, protein: 4.9, carbs: 50.4, fat: 0.7, fibre: 1.4,
    date: DAY, source: "ingredient", servings: null, notes: null,
    ingredient_id: "ing-004", recipe_id: null, user_ingredient_id: null, user_recipe_id: null,
    created_at: `${DAY}T12:59:00.000Z`,
  },
  {
    id: "diary-5", name: "Banana", amount: 118, unit: "g", meal: "Snacks",
    calories: 105, protein: 1.3, carbs: 27.0, fat: 0.4, fibre: 3.1,
    date: DAY, source: "ingredient", servings: null, notes: null,
    ingredient_id: "ing-005", recipe_id: null, user_ingredient_id: null, user_recipe_id: null,
    created_at: `${DAY}T15:20:00.000Z`,
  },
  {
    id: "diary-8", name: "Whey protein shake", amount: 300, unit: "ml", meal: "Snacks",
    calories: 190, protein: 25.0, carbs: 8.0, fat: 3.0, fibre: 1.0,
    date: DAY, source: "ingredient", servings: null, notes: null,
    ingredient_id: null, recipe_id: null, user_ingredient_id: null, user_recipe_id: null,
    created_at: `${DAY}T17:05:00.000Z`,
  },
  {
    id: "diary-9", name: "Almonds", amount: 30, unit: "g", meal: "Snacks",
    calories: 174, protein: 6.4, carbs: 6.5, fat: 15.0, fibre: 3.8,
    date: DAY, source: "ingredient", servings: null, notes: null,
    ingredient_id: "ing-013", recipe_id: null, user_ingredient_id: null, user_recipe_id: null,
    created_at: `${DAY}T17:06:00.000Z`,
  },
  {
    id: "diary-6", name: "Salmon fillet, baked", amount: 140, unit: "g", meal: "Dinner",
    calories: 291, protein: 34.7, carbs: 0, fat: 16.8, fibre: 0,
    date: DAY, source: "ingredient", servings: null, notes: null,
    ingredient_id: "ing-006", recipe_id: null, user_ingredient_id: null, user_recipe_id: null,
    created_at: `${DAY}T19:14:00.000Z`,
  },
  {
    id: "diary-7", name: "New potatoes and greens", amount: 320, unit: "g", meal: "Dinner",
    calories: 288, protein: 9.6, carbs: 55.0, fat: 3.2, fibre: 8.1,
    date: DAY, source: "ingredient", servings: null, notes: null,
    ingredient_id: "ing-007", recipe_id: null, user_ingredient_id: null, user_recipe_id: null,
    created_at: `${DAY}T19:16:00.000Z`,
  },
];

const ing = (id, name, brand, category, tags, per100) => ({
  id, name, brand,
  food_type: brand ? "branded" : "whole",
  basis_quantity: 100,
  basis_unit: "g",
  calories_kcal: per100[0], protein_g: per100[1], carbohydrates_g: per100[2],
  fat_g: per100[3], saturated_fat_g: per100[4], sugars_g: per100[5],
  fibre_g: per100[6], salt_g: per100[7], sodium_mg: per100[8],
  category, dietary_tags: tags, image_url: null,
});

const ingredients = [
  ing("ing-001", "Porridge oats", null, "Grains", ["vegan", "high-fibre"], [379, 13.5, 60.0, 7.7, 1.3, 1.0, 9.0, 0.01, 4]),
  ing("ing-002", "Greek yoghurt, 0% fat", "Fage", "Dairy", ["vegetarian", "high-protein", "low-fat"], [57, 10.0, 4.0, 0.4, 0.2, 4.0, 0, 0.10, 40]),
  ing("ing-003", "Chicken breast, skinless", null, "Meat & fish", ["high-protein", "low-carb"], [165, 31.0, 0, 3.9, 1.1, 0, 0, 0.18, 71]),
  ing("ing-004", "Basmati rice, cooked", null, "Grains", ["vegan", "gluten-free"], [129, 2.7, 28.0, 0.4, 0.1, 0.1, 0.8, 0.01, 3]),
  ing("ing-005", "Banana", null, "Fruit & veg", ["vegan", "high-fibre"], [89, 1.1, 22.8, 0.3, 0.1, 12.2, 2.6, 0.00, 1]),
  ing("ing-006", "Salmon fillet", null, "Meat & fish", ["pescatarian", "high-protein"], [208, 24.8, 0, 12.0, 2.5, 0, 0, 0.14, 55]),
  ing("ing-007", "New potatoes", null, "Fruit & veg", ["vegan", "gluten-free", "high-fibre"], [77, 2.0, 17.0, 0.1, 0.0, 0.8, 2.2, 0.01, 6]),
  ing("ing-008", "Semi-skimmed milk", null, "Dairy", ["vegetarian"], [50, 3.6, 4.8, 1.8, 1.1, 4.8, 0, 0.10, 44]),
  ing("ing-009", "Wholemeal bread", "Hovis", "Grains", ["vegan", "high-fibre"], [219, 9.4, 35.6, 2.5, 0.5, 2.8, 6.0, 0.95, 380]),
  ing("ing-010", "Cheddar, mature", null, "Dairy", ["vegetarian", "high-protein", "low-carb"], [416, 25.4, 0.1, 34.9, 21.7, 0.1, 0, 1.80, 720]),
  ing("ing-011", "Lentils, cooked", null, "Pulses", ["vegan", "high-fibre", "high-protein"], [116, 9.0, 20.1, 0.4, 0.1, 1.8, 7.9, 0.01, 2]),
  ing("ing-012", "Broccoli, steamed", null, "Fruit & veg", ["vegan", "low-carb", "high-fibre"], [35, 2.4, 7.2, 0.4, 0.0, 1.4, 3.3, 0.03, 41]),
  ing("ing-013", "Almonds", null, "Nuts & seeds", ["vegan", "low-carb", "high-fibre"], [579, 21.2, 21.6, 49.9, 3.8, 4.4, 12.5, 0.00, 1]),
  ing("ing-014", "Eggs, free range", null, "Dairy", ["vegetarian", "high-protein", "low-carb"], [143, 12.6, 0.7, 9.5, 3.1, 0.4, 0, 0.36, 142]),
];

/**
 * Real production rows, in the exact shape REFERENCE_RECIPE_SELECT asks for.
 * Refresh with scripts/refresh-marketing-recipes.mjs rather than editing.
 *
 * Note the `ingredients` element shape varies between rows — some carry `name`,
 * some `ingredient_name`, some only `original_text`. That is production
 * reality, RecipeDetailPage already falls back across all three, and keeping
 * the variance here is the point: it is what the camera will see.
 */
const recipes = recipesFromProduction;

/**
 * PostgREST returns the row, not the mapped UserProfile — profileRepository
 * does the camelCase mapping. Keep these column names.
 */
const user_profiles = [
  {
    display_name: "Sam",
    age: 31,
    calculation_sex: "male",
    height_cm: 178,
    weight_kg: 84.2,
    target_weight_kg: 78,
    activity_level: "moderate",
    goal_mode: "lose",
    theme: "system",
    onboarded: true,
    steps_per_day: 8200,
    resistance_sessions: 3,
    cardio_sessions: 2,
    body_fat_percent: 21.4,
    waist_cm: 88,
    training_experience: "intermediate",
    on_medication: false,
    target_calories: 2150,
    target_protein_g: 165,
    target_carbs_g: 195,
    target_fat_g: 68,
    target_fibre_g: 30,
    targets_source: "manual",
    targets_set_at: "2026-08-02T10:15:00.000Z",
  },
];

/**
 * Deliberately non-monotonic. The trend is down, four of the readings are up on
 * the one before, and that is the entire argument the app makes about weight.
 */
const weight_logs = [
  { date: "2026-09-01", weight_kg: 84.2, waist_cm: 88 },
  { date: "2026-08-29", weight_kg: 84.6, waist_cm: null },
  { date: "2026-08-25", weight_kg: 84.1, waist_cm: null },
  { date: "2026-08-21", weight_kg: 84.9, waist_cm: 88.5 },
  { date: "2026-08-17", weight_kg: 84.7, waist_cm: null },
  { date: "2026-08-13", weight_kg: 85.4, waist_cm: null },
  { date: "2026-08-09", weight_kg: 85.0, waist_cm: 89 },
  { date: "2026-08-05", weight_kg: 85.8, waist_cm: null },
  { date: "2026-08-01", weight_kg: 85.5, waist_cm: null },
  { date: "2026-07-28", weight_kg: 86.1, waist_cm: 90 },
];

/** The first user line is the hook of the whole film. Do not reword it. */
const chat_messages = [
  {
    id: "msg-1", role: "user",
    content: "I have been the same weight for 3 weeks — what should I change?",
    created_at: `${DAY}T20:02:00.000Z`,
  },
  {
    id: "msg-2", role: "assistant",
    content:
      "Three weeks flat is shorter than it feels. Today you logged 1,877 kcal against a 2,150 target, so on paper the deficit is there — but weekends are the usual culprit, and two untracked days can quietly cancel five good ones. Before changing anything, log a full seven days including Saturday and Sunday.",
    created_at: `${DAY}T20:02:14.000Z`,
  },
  {
    id: "msg-3", role: "user",
    content: "Should I just eat less?",
    created_at: `${DAY}T20:03:40.000Z`,
  },
  {
    id: "msg-4", role: "assistant",
    content:
      "Not yet. Cutting further while the picture is incomplete usually costs you protein and training quality for no extra fat loss. Your protein is at 158 g against a 165 g target — closing that last gap tends to do more than dropping calories.",
    created_at: `${DAY}T20:03:58.000Z`,
  },
  {
    id: "msg-5", role: "user",
    content: "The scale went up 400g yesterday though.",
    created_at: `${DAY}T20:05:02.000Z`,
  },
  {
    id: "msg-6", role: "assistant",
    content:
      "That is water, not fat. 400 g of fat is roughly 3,600 kcal, which you did not eat. Salt, carbs and a hard session all move the reading by more than a week of actual loss. Weigh daily, read the weekly average, and ignore any single morning.",
    created_at: `${DAY}T20:05:19.000Z`,
  },
];

const meal_photo_analyses = [
  {
    id: "photo-1",
    created_at: `${DAY}T12:58:00.000Z`,
    status: "complete",
    label: "Grilled chicken, rice and roasted vegetables",
    estimated_calories: 615,
    estimated_protein_g: 58.4,
    estimated_carbs_g: 57.6,
    estimated_fat_g: 15.2,
    items: [
      { name: "Grilled chicken breast", calories: 273, protein_g: 51.2, carbs_g: 0, fat_g: 6.4 },
      { name: "Basmati rice", calories: 232, protein_g: 4.9, carbs_g: 50.4, fat_g: 0.7 },
      { name: "Roasted vegetables", calories: 76, protein_g: 2.4, carbs_g: 7.2, fat_g: 4.1 },
      { name: "Olive oil, drizzled", calories: 31, protein_g: 0, carbs_g: 0, fat_g: 3.5 },
    ],
  },
];

/**
 * The scan the add-food sheet returns in beat 5 — a supermarket own-brand
 * yoghurt, because a branded label is what "scan the label" actually means.
 *
 * `verdict: "needs_review"` is deliberate and is the whole point of shots
 * S14/S15: it is what puts "The AI is not fully confident about these numbers."
 * on screen. Every competitor hides model uncertainty. Showing it is the shot.
 */
const ingredientScan = {
  recognised: true,
  readFrom: "label",
  draft: {
    name: "Greek style natural yoghurt",
    brand: "Own brand",
    basis_quantity: 100,
    basis_unit: "g",
    calories_kcal: 133,
    protein_g: 5.7,
    carbohydrates_g: 5.2,
    fat_g: 9.8,
    saturated_fat_g: 6.7,
    sugars_g: 5.2,
    fibre_g: 0,
    sodium_mg: 48,
    salt_g: 0.12,
    category: "Dairy",
    dietary_tags: ["vegetarian"],
  },
  // Named exactly as the columns are, because prettyField() maps them for display.
  estimatedFields: ["fibre_g", "sodium_mg"],
  review: {
    verdict: "needs_review",
    confidence: "medium",
    reasons: [
      "Fibre and sodium were not visible on the label and are estimated from typical values for full-fat Greek style yoghurt.",
      "Stated calories are about 4% above what the macros alone come to, which is normal rounding on a pack but worth a glance.",
    ],
    suggested: null,
    fingerprint: "capture-fixture",
  },
};

/**
 * What the coach returns when the message carries a photo — the entire hook of
 * the film. "Photograph the plate, the macros land" is only true on screen if
 * the reply is an itemised estimate; a paragraph of advice is the wrong beat
 * and would quietly make the video promise something the app does not do.
 *
 * The dish matches meal_photo_analyses and the diary's lunch entries, and it is
 * what the live-action plate in beat 1 has to be: chicken, rice, roasted veg.
 * A mismatch there is exactly what people notice.
 */
const photoResponse = {
  /**
   * The numbers in this sentence must match what the app computes from `lines`
   * below — it totals them itself and renders both in the same frame. Say 612
   * here while the card totals 615 and the video shows the product
   * contradicting itself.
   */
  reply:
    "Grilled chicken, rice and roasted vegetables — about 615 kcal and 58 g of protein. " +
    "The chicken and rice matched the food tables; the vegetables and the oil are estimated " +
    "from the photo, so nudge the amounts if I have read the portion wrong.",
  estimate: {
    dish_name: "Grilled chicken, rice and roasted vegetables",
    description: "A plated lunch: chicken breast, basmati rice and roasted vegetables.",
    ingredients: [
      "165 g grilled chicken breast",
      "180 g cooked basmati rice",
      "120 g roasted vegetables",
      "1 tsp olive oil",
    ],
    lines: [
      {
        name: "Chicken breast, grilled",
        amount: 165,
        unit: "g",
        estimatedAmount: true,
        source: "database",
        caloriesPer100: 165,
        proteinPer100: 31,
        carbsPer100: 0,
        fatPer100: 3.9,
      },
      {
        name: "Basmati rice, cooked",
        amount: 180,
        unit: "g",
        estimatedAmount: true,
        source: "database",
        caloriesPer100: 129,
        proteinPer100: 2.7,
        carbsPer100: 28,
        fatPer100: 0.4,
      },
      {
        name: "Roasted vegetables",
        amount: 120,
        unit: "g",
        estimatedAmount: true,
        source: "ai_estimate",
        caloriesPer100: 63,
        proteinPer100: 2,
        carbsPer100: 6,
        fatPer100: 3.4,
      },
      {
        name: "Olive oil",
        amount: 4,
        unit: "ml",
        estimatedAmount: true,
        source: "ai_estimate",
        caloriesPer100: 884,
        proteinPer100: 0,
        carbsPer100: 0,
        fatPer100: 100,
      },
    ],
    calories: 615,
    protein_g: 58.4,
    carbs_g: 57.6,
    fat_g: 15.2,
    fibre_g: 6,
    confidence: "medium",
    summary: "Chicken and rice read from the tables, vegetables and oil estimated.",
    is_food: true,
  },
};

export const FIXTURES = {
  /** First row in marketing-recipes.json — the one beat 6 opens. */
  featuredRecipeId: recipes[0].id,
  coachResponse: { reply: chat_messages[1].content },
  photoResponse,
  ingredientScan,
  tables: {
    diary_entries,
    ingredients,
    recipes,
    user_profiles,
    weight_logs,
    chat_messages,
    meal_photo_analyses,
    // The app queries these alongside the reference tables; empty is correct
    // here, because the demo user has not added anything of their own.
    user_ingredients: [],
    user_recipes: [],
  },
};
