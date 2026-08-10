export type DietTag =
  | "vegan"
  | "vegetarian"
  | "pescatarian"
  | "omnivore"
  | "dairy-free"
  | "gluten-free"
  | "high-protein"
  | "weight-loss"
  | "high-fibre"
  | "low-carb"
  | "low-fat";

export const DIET_TAGS: DietTag[] = [
  "vegan",
  "vegetarian",
  "pescatarian",
  "omnivore",
  "dairy-free",
  "gluten-free",
  "high-protein",
  "weight-loss",
  "high-fibre",
  "low-carb",
  "low-fat",
];

export type MealName = "Breakfast" | "Lunch" | "Dinner" | "Snacks";

export const MEALS: MealName[] = ["Breakfast", "Lunch", "Dinner", "Snacks"];

export interface Ingredient {
  id: string;
  name: string;
  brand: string | null;
  food_type: string;
  basis_quantity: number;
  basis_unit: "g" | "ml";
  calories_kcal: number | null;
  protein_g: number | null;
  carbohydrates_g: number | null;
  fat_g: number | null;
  saturated_fat_g: number | null;
  sugars_g: number | null;
  fibre_g: number | null;
  salt_g: number | null;
  sodium_mg: number | null;
  category: string | null;
  dietary_tags: string[] | null;
  image_url: string | null;
  /** Present on foods from the signed-in user's own library. */
  owned?: boolean;
  verification?: FoodReview | null;
}

export interface RecipeIngredient {
  name?: string;
  ingredient_name?: string;
  normalized_ingredient_name?: string;
  original_text: string;
  quantity: number | null;
  unit: string | null;
  weight_g?: number | null;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  image_url: string;
  servings: number;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  instructions: string;
  calories_per_serving: number;
  protein_per_serving_g: number;
  carbs_per_serving_g: number;
  fat_per_serving_g: number;
  fibre_per_serving_g: number;
  saturated_fat_per_serving_g: number;
  sugar_per_serving_g: number;
  sodium_per_serving_mg: number;
  cholesterol_per_serving_mg: number;
  cuisine: string | null;
  dietary_tags: DietTag[];
  ingredient_count: number;
  ingredients: RecipeIngredient[];
  video_url: string;
  video_source_url: string | null;
  video_duration_seconds: number | null;
  video_verified_short: boolean;
  /** Present on recipes from the signed-in user's own library. */
  owned?: boolean;
  verification?: FoodReview | null;
}

export type GoalMode = "lose-fast" | "lose" | "maintain" | "lean-gain" | "gain";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very" | "athlete";
export type ThemePreference = "system" | "light" | "dark";

export interface UserProfile {
  name: string;
  age: number;
  calculationSex: "female" | "male";
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  activityLevel: ActivityLevel;
  goalMode: GoalMode;
  theme: ThemePreference;
  onboarded: boolean;
}

export interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
}

export type DiarySource =
  | "ingredient"
  | "recipe"
  | "user_ingredient"
  | "user_recipe"
  | "ai_photo"
  | "manual";

export interface DiaryEntry {
  id: string;
  name: string;
  amount: number;
  unit: string;
  meal: MealName;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  date: string;
  source: DiarySource;
  servings: number | null;
  notes: string | null;
  ingredientId: string | null;
  recipeId: string | null;
  userIngredientId: string | null;
  userRecipeId: string | null;
  createdAt: string;
}

/** The shape written to the diary. Totals are already scaled by the caller. */
export interface DiaryDraft {
  name: string;
  amount: number;
  unit: string;
  meal: MealName;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  date: string;
  source: DiarySource;
  servings?: number | null;
  notes?: string | null;
  ingredientId?: string | null;
  recipeId?: string | null;
  userIngredientId?: string | null;
  userRecipeId?: string | null;
}

export interface RecentFood {
  name: string;
  source: DiarySource;
  unit: string;
  amount: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  lastLogged: string;
  timesLogged: number;
  ingredientId: string | null;
  recipeId: string | null;
  userIngredientId: string | null;
  userRecipeId: string | null;
}

export interface MealEstimate {
  dish_name: string;
  description: string;
  /** What the calorie figure is based on, with assumed amounts. */
  ingredients?: string[];
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  confidence: "low" | "medium" | "high";
  summary: string;
  is_food: boolean;
}

export type AiProvider = "groq" | "openrouter";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Local-only preview of the photo the user sent; never persisted. */
  imagePreviewUrl?: string;
  estimate?: MealEstimate | null;
  /** Meals the coach named, each offered as an editable diary entry. */
  suggestions?: MealSuggestion[];
  provider?: AiProvider | null;
  createdAt: string;
  /** Set once the user has logged this estimate, so the card stops offering it. */
  loggedAt?: string;
}

export interface FoodReview {
  verdict: "approved" | "needs_review" | "rejected";
  confidence: "low" | "medium" | "high";
  reasons: string[];
  suggested: Record<string, number> | null;
  /**
   * Ties a verdict to the exact numbers it was made against, so a review from
   * a photo scan can be reused on save instead of paying for a second AI call.
   */
  fingerprint?: string;
}

/** A meal the coach named in a reply, offered for logging. */
export interface MealSuggestion {
  name: string;
  /** What the calorie figure is based on, with amounts for one serving. */
  ingredients?: string[];
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fibre_g: number;
  servings: number;
}

/** One AI call: read the recipe, fill in what it does not show, judge it. */
export interface RecipeScan {
  recognised: boolean;
  draft: {
    name: string;
    description: string;
    servings: number;
    prep_time_minutes: number;
    cook_time_minutes: number;
    instructions: string;
    cuisine: string;
    calories_per_serving: number;
    protein_per_serving_g: number;
    carbs_per_serving_g: number;
    fat_per_serving_g: number;
    fibre_per_serving_g: number;
    ingredients: string[];
    dietary_tags: string[];
  };
  estimatedFields: string[];
  review: FoodReview;
  error?: string;
}

/** One AI call: read the food, fill in what the photo does not show, judge it. */
export interface IngredientScan {
  recognised: boolean;
  draft: IngredientDraft & { category: string };
  /** Fields the AI estimated from typical values rather than read from the photo. */
  estimatedFields: string[];
  readFrom: "label" | "food";
  review: FoodReview;
  error?: string;
}

export interface IngredientDraft {
  name: string;
  brand: string;
  basis_quantity: number;
  basis_unit: "g" | "ml";
  calories_kcal: number;
  protein_g: number;
  carbohydrates_g: number;
  fat_g: number;
  saturated_fat_g?: number | null;
  sugars_g?: number | null;
  fibre_g?: number | null;
  salt_g?: number | null;
  sodium_mg?: number | null;
  category?: string | null;
  dietary_tags?: string[];
}

export interface RecipeDraft {
  name: string;
  description: string;
  servings: number;
  prep_time_minutes?: number | null;
  cook_time_minutes?: number | null;
  instructions: string;
  calories_per_serving: number;
  protein_per_serving_g: number;
  carbs_per_serving_g: number;
  fat_per_serving_g: number;
  fibre_per_serving_g?: number | null;
  cuisine?: string | null;
  dietary_tags?: string[];
  ingredients: Array<{ original_text: string; name?: string; quantity: number | null; unit: string | null }>;
}

export interface SubmitFoodResult {
  saved: boolean;
  review: FoodReview;
  requiresConfirmation?: boolean;
  item?: unknown;
}
