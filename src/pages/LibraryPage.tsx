import { BookOpen, CookingPot, Plus, Salad, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AddIngredientSheet } from "../components/AddIngredientSheet";
import { AddRecipeSheet } from "../components/AddRecipeSheet";
import { PortionEditor } from "../components/PortionEditor";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Page,
  PageHeader,
  Segmented,
  Spinner,
  VerificationBadge,
} from "../components/ui";
import {
  deleteMyIngredient,
  deleteMyRecipe,
  loadMyIngredients,
  loadMyRecipes,
} from "../services/libraryRepository";
import type { Ingredient, Recipe } from "../types";

type Tab = "ingredients" | "recipes";

const TAB_OPTIONS = [
  { value: "ingredients" as const, label: "My ingredients", icon: <Salad size={15} /> },
  { value: "recipes" as const, label: "My recipes", icon: <CookingPot size={15} /> },
];

export function LibraryPage() {
  const [tab, setTab] = useState<Tab>("ingredients");
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Tab | null>(null);
  const [selected, setSelected] = useState<Ingredient | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedIngredients, loadedRecipes] = await Promise.all([
        loadMyIngredients(),
        loadMyRecipes(),
      ]);
      setIngredients(loadedIngredients);
      setRecipes(loadedRecipes);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load your library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const removeIngredient = async (id: string) => {
    try {
      await deleteMyIngredient(id);
      setIngredients((current) => current.filter((item) => item.id !== id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete that food.");
    } finally {
      setConfirming(null);
    }
  };

  const removeRecipe = async (id: string) => {
    try {
      await deleteMyRecipe(id);
      setRecipes((current) => current.filter((item) => item.id !== id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete that recipe.");
    } finally {
      setConfirming(null);
    }
  };

  if (selected) {
    return (
      <PortionEditor
        ingredient={selected}
        defaultMeal="Lunch"
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <Page>
      <PageHeader
        title="Your library"
        subtitle="Foods and recipes you added yourself. Every one was checked by AI before it was saved."
        actions={
          <Button variant="primary" onClick={() => setSheet(tab)}>
            <Plus size={17} /> {tab === "ingredients" ? "Add ingredient" : "Add recipe"}
          </Button>
        }
      />

      <Segmented options={TAB_OPTIONS} value={tab} onChange={setTab} ariaLabel="Library section" />

      {error && (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      )}

      <div className="mt-4">
        {loading ? (
          <Spinner label="Loading your library…" />
        ) : tab === "ingredients" ? (
          ingredients.length === 0 ? (
            <EmptyState
              icon={<BookOpen size={20} />}
              title="No foods yet"
              text="Add the foods you eat that are not in the database — a local brand, a protein shake, your own bread."
              action={
                <Button variant="primary" size="sm" onClick={() => setSheet("ingredients")}>
                  <Plus size={15} /> Add your first food
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {ingredients.map((item) => (
                <Card key={item.id} className="grid gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-[15px] font-semibold">{item.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        {item.brand || "Own entry"} · per {item.basis_quantity}
                        {item.basis_unit}
                      </p>
                    </div>
                    <VerificationBadge verdict={item.verification?.verdict} />
                  </div>

                  <MacroStrip
                    values={[
                      [Math.round(item.calories_kcal ?? 0), "kcal"],
                      [`${round1(item.protein_g)}g`, "protein"],
                      [`${round1(item.carbohydrates_g)}g`, "carbs"],
                      [`${round1(item.fat_g)}g`, "fat"],
                    ]}
                  />

                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" onClick={() => setSelected(item)}>
                      <Plus size={14} /> Log it
                    </Button>
                    <Button
                      size="sm"
                      variant={confirming === item.id ? "danger" : "ghost"}
                      onClick={() =>
                        confirming === item.id
                          ? void removeIngredient(item.id)
                          : setConfirming(item.id)
                      }
                    >
                      <Trash2 size={14} />
                      {confirming === item.id ? "Confirm" : ""}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : recipes.length === 0 ? (
          <EmptyState
            icon={<CookingPot size={20} />}
            title="No recipes yet"
            text="Save the meals you cook regularly so logging them later takes one tap."
            action={
              <Button variant="primary" size="sm" onClick={() => setSheet("recipes")}>
                <Plus size={15} /> Add your first recipe
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {recipes.map((recipe) => (
              <Card key={recipe.id} className="grid gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[15px] font-semibold">{recipe.name}</h3>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {recipe.servings} servings · {recipe.ingredient_count} ingredients
                    </p>
                  </div>
                  <VerificationBadge verdict={recipe.verification?.verdict} />
                </div>

                <MacroStrip
                  values={[
                    [Math.round(recipe.calories_per_serving), "kcal"],
                    [`${round1(recipe.protein_per_serving_g)}g`, "protein"],
                    [`${round1(recipe.carbs_per_serving_g)}g`, "carbs"],
                    [`${round1(recipe.fat_per_serving_g)}g`, "fat"],
                  ]}
                />

                <div className="flex gap-2">
                  <Link
                    to={`/recipes/${recipe.id}?mine=1`}
                    className="inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-medium hover:bg-muted"
                  >
                    Open
                  </Link>
                  <Button
                    size="sm"
                    variant={confirming === recipe.id ? "danger" : "ghost"}
                    onClick={() =>
                      confirming === recipe.id
                        ? void removeRecipe(recipe.id)
                        : setConfirming(recipe.id)
                    }
                  >
                    <Trash2 size={14} />
                    {confirming === recipe.id ? "Confirm" : ""}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {sheet === "ingredients" && (
        <AddIngredientSheet
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            void load();
          }}
        />
      )}
      {sheet === "recipes" && (
        <AddRecipeSheet
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            void load();
          }}
        />
      )}
    </Page>
  );
}

function MacroStrip({ values }: { values: Array<[string | number, string]> }) {
  return (
    <dl className="grid grid-cols-4 gap-2 border-y border-line-soft py-2.5">
      {values.map(([value, label]) => (
        <div key={label}>
          <dd className="text-sm font-semibold tabular-nums">{value}</dd>
          <dt className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

function round1(value: number | null): number {
  return Math.round((value ?? 0) * 10) / 10;
}
