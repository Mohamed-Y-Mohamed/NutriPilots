/**
 * The no-photo route into a recipe: the user types what they ate and the same
 * review flow a photo scan produces fills in around it.
 *
 * Worth pinning because the two routes share one code path — a change to the
 * scan flow silently changes this one, and the only visible symptom would be a
 * form that stays empty after the estimate comes back.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserFacingError } from "../lib/errors";
import { AddRecipeSheet } from "./AddRecipeSheet";

const submitRecipe = vi.fn();
const scanRecipePhoto = vi.fn();
const estimateDishFromText = vi.fn();
const promoteToSharedDatabase = vi.fn();

vi.mock("../services/libraryRepository", () => ({
  submitRecipe: (...args: unknown[]) => submitRecipe(...args),
  scanRecipePhoto: (...args: unknown[]) => scanRecipePhoto(...args),
  estimateDishFromText: (...args: unknown[]) => estimateDishFromText(...args),
  promoteToSharedDatabase: (...args: unknown[]) => promoteToSharedDatabase(...args),
}));

vi.mock("../services/aiClient", () => ({
  uploadMealPhoto: vi.fn().mockResolvedValue("user-1/photo.jpg"),
}));

vi.mock("../state/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "a@b.com" } }),
}));

vi.mock("../lib/image", () => ({
  prepareImage: vi.fn().mockResolvedValue({
    blob: new Blob(["x"], { type: "image/jpeg" }),
    previewUrl: "data:image/jpeg;base64,x",
  }),
}));

vi.mock("../lib/native", () => ({
  isNative: false,
  capturePhoto: vi.fn().mockResolvedValue(null),
}));

const estimate = {
  recognised: true,
  draft: {
    name: "Chicken and rice traybake",
    description: "",
    servings: 4,
    prep_time_minutes: 0,
    cook_time_minutes: 0,
    instructions: "Chicken and rice traybake, serves 4",
    cuisine: "",
    calories_per_serving: 593,
    protein_per_serving_g: 33.2,
    carbs_per_serving_g: 77.8,
    fat_per_serving_g: 15,
    fibre_per_serving_g: 0,
    ingredients: ["400g chicken thigh, raw", "370g basmati rice", "14g olive oil"],
    dietary_tags: ["omnivore"],
  },
  estimatedFields: ["servings"],
  matchedFromDatabase: 2,
  totalIngredients: 3,
  review: {
    verdict: "approved" as const,
    confidence: "medium" as const,
    reasons: [],
    suggested: null,
    fingerprint: "chicken and rice traybake|593|33.2|77.8|15",
  },
};

async function describeDish(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole("button", { name: /describe it instead/i }));
  await user.type(screen.getByPlaceholderText(/chicken curry with rice/i), text);
  await user.click(screen.getByRole("button", { name: /work it out/i }));
}

beforeEach(() => {
  submitRecipe.mockReset().mockResolvedValue({
    saved: true,
    review: { verdict: "approved", confidence: "high", reasons: [], suggested: null },
  });
  scanRecipePhoto.mockReset();
  estimateDishFromText.mockReset().mockResolvedValue(estimate);
  promoteToSharedDatabase.mockReset();
});

describe("describing a dish instead of photographing it", () => {
  it("stays out of the way until asked for", () => {
    render(<AddRecipeSheet onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/chicken curry with rice/i)).toBeNull();
  });

  it("will not send an empty description", async () => {
    const user = userEvent.setup();
    render(<AddRecipeSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /describe it instead/i }));
    expect(screen.getByRole("button", { name: /work it out/i })).toBeDisabled();
    expect(estimateDishFromText).not.toHaveBeenCalled();
  });

  it("fills the recipe form from what the user typed", async () => {
    const user = userEvent.setup();
    render(<AddRecipeSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    await describeDish(user, "Chicken and rice traybake, serves 4");

    await waitFor(() =>
      expect(estimateDishFromText).toHaveBeenCalledWith("Chicken and rice traybake, serves 4"),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Recipe name")).toHaveValue("Chicken and rice traybake"),
    );
    expect(screen.getByLabelText("Servings *")).toHaveValue(4);
    expect(screen.getByLabelText("Calories (kcal) *")).toHaveValue(593);
  });

  it("says how much of the estimate came from real data, not the model", async () => {
    const user = userEvent.setup();
    render(<AddRecipeSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    await describeDish(user, "Chicken and rice traybake");

    await waitFor(() => expect(screen.getByText(/2 of 3/)).toBeInTheDocument());
    expect(screen.getByText(/already in the database/i)).toBeInTheDocument();
  });

  it("fills the method with what was typed, so the dish can actually be saved", async () => {
    const user = userEvent.setup();
    render(<AddRecipeSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    await describeDish(user, "Chicken and rice traybake, serves 4");

    // The form requires a method of its own; a described meal has none, so the
    // description stands in. Without it the save button never enables.
    await waitFor(() =>
      expect(screen.getByLabelText(/^Method \*/)).toHaveValue(
        "Chicken and rice traybake, serves 4",
      ),
    );
    expect(screen.getByRole("button", { name: /save to my recipes/i })).toBeEnabled();
  });

  it("carries the verdict into the save so it is not checked twice", async () => {
    const user = userEvent.setup();
    render(<AddRecipeSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    await describeDish(user, "Chicken and rice traybake");
    await waitFor(() =>
      expect(screen.getByLabelText("Recipe name")).toHaveValue("Chicken and rice traybake"),
    );

    await user.click(screen.getByRole("button", { name: /save to my recipes/i }));

    await waitFor(() => expect(submitRecipe).toHaveBeenCalled());
    expect(submitRecipe.mock.calls[0][2]).toMatchObject({
      fingerprint: estimate.review.fingerprint,
    });
  });

  it("reports a description it could not read without filling the form", async () => {
    estimateDishFromText.mockResolvedValue({
      recognised: false,
      error: "That did not look like a real dish. Try naming the ingredients you used.",
    });
    const user = userEvent.setup();
    render(<AddRecipeSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    await describeDish(user, "a chair made of oak");

    await waitFor(() => expect(screen.getByText(/did not look like a real dish/i)).toBeInTheDocument());
    expect(screen.getByLabelText("Recipe name")).toHaveValue("");
  });

  it("surfaces a rate limit as the server worded it", async () => {
    estimateDishFromText.mockRejectedValue(
      new UserFacingError("That is a lot at once — give it 20 seconds and try again."),
    );
    const user = userEvent.setup();
    render(<AddRecipeSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    await describeDish(user, "Chicken and rice traybake");

    await waitFor(() =>
      expect(screen.getByText(/give it 20 seconds and try again/i)).toBeInTheDocument(),
    );
  });
});
