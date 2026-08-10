import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortionEditor } from "./PortionEditor";
import type { Ingredient } from "../types";

const logFood = vi.fn();

vi.mock("../state/AppDataContext", () => ({
  useAppData: () => ({ logFood, date: "2026-08-10" }),
}));

const chicken: Ingredient = {
  id: "ref-1",
  name: "Chicken breast, raw",
  brand: null,
  food_type: "ingredient",
  basis_quantity: 100,
  basis_unit: "g",
  calories_kcal: 165,
  protein_g: 31,
  carbohydrates_g: 0,
  fat_g: 3.6,
  saturated_fat_g: 1,
  sugars_g: 0,
  fibre_g: 0,
  salt_g: 0.1,
  sodium_mg: 74,
  category: "Meat",
  dietary_tags: null,
  image_url: null,
};

beforeEach(() => {
  logFood.mockReset();
  logFood.mockResolvedValue({ id: "entry-1" });
});

describe("PortionEditor", () => {
  it("recalculates the headline calories when the amount changes", async () => {
    const user = userEvent.setup();
    render(<PortionEditor ingredient={chicken} defaultMeal="Lunch" onBack={vi.fn()} />);

    expect(screen.getByText("165 kcal")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "200g" }));
    expect(screen.getByText("330 kcal")).toBeInTheDocument();
  });

  it("scales every macro, not just calories", async () => {
    const user = userEvent.setup();
    render(<PortionEditor ingredient={chicken} defaultMeal="Lunch" onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "50g" }));

    expect(screen.getByText("15.5g")).toBeInTheDocument(); // protein
    expect(screen.getByText("1.8g")).toBeInTheDocument(); // fat
  });

  it("logs the scaled values against the chosen meal and date", async () => {
    const user = userEvent.setup();
    render(<PortionEditor ingredient={chicken} defaultMeal="Lunch" onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "150g" }));
    await user.selectOptions(screen.getByLabelText("Meal"), "Dinner");
    await user.click(screen.getByRole("button", { name: /add to diary/i }));

    expect(logFood).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Chicken breast, raw",
        amount: 150,
        unit: "g",
        meal: "Dinner",
        date: "2026-08-10",
        calories: 248,
        protein: 46.5,
        source: "ingredient",
        ingredientId: "ref-1",
        userIngredientId: null,
      }),
    );
  });

  it("attributes a library food to the user's own table, not the reference one", async () => {
    const user = userEvent.setup();
    render(
      <PortionEditor
        ingredient={{ ...chicken, owned: true }}
        defaultMeal="Breakfast"
        onBack={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add to diary/i }));

    expect(logFood).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "user_ingredient",
        ingredientId: null,
        userIngredientId: "ref-1",
      }),
    );
  });

  it("surfaces a failure instead of pretending the food was logged", async () => {
    logFood.mockRejectedValue(new Error("Network unreachable"));
    const user = userEvent.setup();
    render(<PortionEditor ingredient={chicken} defaultMeal="Lunch" onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /add to diary/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Network unreachable");
    expect(screen.queryByText("Added to diary")).not.toBeInTheDocument();
  });

  it("goes back without logging anything", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<PortionEditor ingredient={chicken} defaultMeal="Lunch" onBack={onBack} />);

    await user.click(screen.getByRole("button", { name: /back to search/i }));

    expect(onBack).toHaveBeenCalled();
    expect(logFood).not.toHaveBeenCalled();
  });
});
