import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddIngredientSheet } from "./AddIngredientSheet";

const submitIngredient = vi.fn();

vi.mock("../services/libraryRepository", () => ({
  submitIngredient: (...args: unknown[]) => submitIngredient(...args),
}));

const approved = {
  saved: true,
  review: { verdict: "approved", confidence: "high", reasons: [], suggested: null },
};

async function fillValidFood(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Food name"), "Rolled oats");
  await user.type(screen.getByLabelText("Calories (kcal) *"), "379");
  await user.type(screen.getByLabelText("Protein (g) *"), "13.2");
  await user.type(screen.getByLabelText("Carbohydrates (g) *"), "67.7");
  await user.type(screen.getByLabelText("Fat (g) *"), "6.5");
}

beforeEach(() => {
  submitIngredient.mockReset();
  submitIngredient.mockResolvedValue(approved);
});

describe("AddIngredientSheet", () => {
  it("blocks submission until every required nutrient is present", async () => {
    const user = userEvent.setup();
    render(<AddIngredientSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    const submit = screen.getByRole("button", { name: /verify and save/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/still needed/i)).toHaveTextContent("name");

    await fillValidFood(user);
    expect(submit).toBeEnabled();
  });

  it("sends the food for AI verification rather than saving it directly", async () => {
    const user = userEvent.setup();
    render(<AddIngredientSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    await fillValidFood(user);
    await user.click(screen.getByRole("button", { name: /verify and save/i }));

    expect(submitIngredient).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Rolled oats",
        basis_quantity: 100,
        basis_unit: "g",
        calories_kcal: 379,
        protein_g: 13.2,
      }),
      false,
    );
  });

  it("closes only once the food is genuinely saved", async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<AddIngredientSheet onClose={vi.fn()} onSaved={onSaved} />);

    await fillValidFood(user);
    await user.click(screen.getByRole("button", { name: /verify and save/i }));

    expect(onSaved).toHaveBeenCalled();
  });

  it("warns and requires a second confirmation when the AI is unsure", async () => {
    submitIngredient.mockResolvedValue({
      saved: false,
      requiresConfirmation: true,
      review: {
        verdict: "needs_review",
        confidence: "low",
        reasons: ["Calories look high for oats"],
        suggested: null,
      },
    });

    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<AddIngredientSheet onClose={vi.fn()} onSaved={onSaved} />);

    await fillValidFood(user);
    await user.click(screen.getByRole("button", { name: /verify and save/i }));

    expect(screen.getByText("Calories look high for oats")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();

    // The second press carries acceptWarnings.
    submitIngredient.mockResolvedValue(approved);
    await user.click(screen.getByRole("button", { name: /save anyway/i }));

    expect(submitIngredient).toHaveBeenLastCalledWith(expect.any(Object), true);
    expect(onSaved).toHaveBeenCalled();
  });

  it("never saves a food the AI rejects", async () => {
    submitIngredient.mockResolvedValue({
      saved: false,
      review: {
        verdict: "rejected",
        confidence: "high",
        reasons: ["Not a real food"],
        suggested: null,
      },
    });

    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<AddIngredientSheet onClose={vi.fn()} onSaved={onSaved} />);

    await fillValidFood(user);
    await user.click(screen.getByRole("button", { name: /verify and save/i }));

    expect(screen.getByText(/does not look like a real food/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("warns locally when the macros cannot reconcile with the calories", async () => {
    const user = userEvent.setup();
    render(<AddIngredientSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Food name"), "Impossible lettuce");
    await user.type(screen.getByLabelText("Calories (kcal) *"), "900");
    await user.type(screen.getByLabelText("Protein (g) *"), "1");
    await user.type(screen.getByLabelText("Carbohydrates (g) *"), "3");
    await user.type(screen.getByLabelText("Fat (g) *"), "0");

    expect(screen.getByText(/a long way from the 900 kcal/i)).toBeInTheDocument();
  });

  it("reports a verification outage instead of silently saving", async () => {
    submitIngredient.mockRejectedValue(
      new Error("The verification service is unavailable, so nothing was saved."),
    );

    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<AddIngredientSheet onClose={vi.fn()} onSaved={onSaved} />);

    await fillValidFood(user);
    await user.click(screen.getByRole("button", { name: /verify and save/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/unavailable/i);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
