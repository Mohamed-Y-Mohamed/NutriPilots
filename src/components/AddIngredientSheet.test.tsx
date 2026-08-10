import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddIngredientSheet } from "./AddIngredientSheet";

const submitIngredient = vi.fn();
const scanIngredientPhoto = vi.fn();
const findExistingIngredients = vi.fn();

vi.mock("../services/libraryRepository", () => ({
  submitIngredient: (...args: unknown[]) => submitIngredient(...args),
  scanIngredientPhoto: (...args: unknown[]) => scanIngredientPhoto(...args),
}));

vi.mock("../services/foodSearch", () => ({
  findExistingIngredients: (...args: unknown[]) => findExistingIngredients(...args),
}));

vi.mock("../services/aiClient", () => ({
  uploadMealPhoto: vi.fn().mockResolvedValue("user-1/photo.jpg"),
}));

vi.mock("../state/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "a@b.com" } }),
}));

// Canvas and Image.decode do not exist in jsdom; resizing is a browser wrapper,
// not the behaviour under test here.
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
  submitIngredient.mockReset().mockResolvedValue(approved);
  scanIngredientPhoto.mockReset();
  findExistingIngredients.mockReset().mockResolvedValue([]);
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
      null,
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

    // A merely plausible food is still the user's to keep — it is private to them.
    expect(screen.getByText(/goes to your foods only/i)).toBeInTheDocument();

    submitIngredient.mockResolvedValue(approved);
    await user.click(screen.getByRole("button", { name: /save to my foods anyway/i }));

    expect(submitIngredient).toHaveBeenLastCalledWith(expect.any(Object), true, expect.anything());
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

describe("scanning a photo", () => {
  const scanned = {
    recognised: true,
    draft: {
      name: "Rolled oats",
      brand: "Own brand",
      basis_quantity: 100,
      basis_unit: "g" as const,
      calories_kcal: 379,
      protein_g: 13.2,
      carbohydrates_g: 67.7,
      fat_g: 6.5,
      fibre_g: 10.1,
      sugars_g: 1,
      saturated_fat_g: 1.1,
      sodium_mg: 5,
      salt_g: 0.01,
      category: "Grains",
      dietary_tags: ["vegan"],
    },
    estimatedFields: ["fibre_g", "sodium_mg"],
    readFrom: "label" as const,
    review: {
      verdict: "approved" as const,
      confidence: "high" as const,
      reasons: [],
      suggested: null,
      fingerprint: "rolled oats|379|13.2|67.7|6.5",
    },
  };

  async function scanWith(result: unknown) {
    scanIngredientPhoto.mockResolvedValue(result);
    const user = userEvent.setup();
    render(<AddIngredientSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    const file = new File(["x"], "label.jpg", { type: "image/jpeg" });
    // The web path routes the camera button through a hidden file input.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    return user;
  }

  it("fills every field from one call and flags what was estimated", async () => {
    await scanWith(scanned);

    expect(await screen.findByDisplayValue("Rolled oats")).toBeInTheDocument();
    expect(screen.getByLabelText("Calories (kcal) *")).toHaveValue(379);
    expect(screen.getByLabelText("Protein (g) *")).toHaveValue(13.2);
    expect(screen.getByText(/estimated rather than read/i)).toBeInTheDocument();
    expect(screen.getByText(/fibre, sodium/i)).toBeInTheDocument();
  });

  it("reuses the scan's verdict on save instead of paying for a second call", async () => {
    const user = await scanWith(scanned);
    await screen.findByDisplayValue("Rolled oats");

    await user.click(screen.getByRole("button", { name: /save to my foods/i }));

    expect(submitIngredient).toHaveBeenCalledWith(
      expect.any(Object),
      false,
      expect.objectContaining({ fingerprint: "rolled oats|379|13.2|67.7|6.5" }),
    );
  });

  it("drops the carried verdict once a macro is edited", async () => {
    const user = await scanWith(scanned);
    await screen.findByDisplayValue("Rolled oats");

    await user.clear(screen.getByLabelText("Protein (g) *"));
    await user.type(screen.getByLabelText("Protein (g) *"), "40");
    await user.click(screen.getByRole("button", { name: /verify and save/i }));

    expect(submitIngredient).toHaveBeenLastCalledWith(expect.any(Object), false, null);
  });

  it("says so when the photo is not a food", async () => {
    await scanWith({
      recognised: false,
      error: "That photo does not look like a food or a nutrition label.",
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/not look like a food/i);
  });
});

describe("duplicate detection", () => {
  it("offers the existing food rather than a needless copy", async () => {
    findExistingIngredients.mockResolvedValue([
      { id: "ref-1", name: "Tomatoes, cherry, raw" },
    ]);

    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AddIngredientSheet onClose={onClose} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Food name"), "cherry tomatoes");

    expect(
      await screen.findByText(/Tomatoes, cherry, raw is already in the food database/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /use the existing food/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("lets the user keep their own copy anyway", async () => {
    findExistingIngredients.mockResolvedValue([
      { id: "ref-1", name: "Tomatoes, cherry, raw" },
    ]);

    const user = userEvent.setup();
    render(<AddIngredientSheet onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText("Food name"), "cherry tomatoes");
    await screen.findByText(/already in the food database/i);

    await user.click(screen.getByRole("button", { name: /save mine anyway/i }));

    expect(screen.queryByText(/already in the food database/i)).not.toBeInTheDocument();
  });
});
