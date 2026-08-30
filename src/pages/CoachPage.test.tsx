import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionError } from "../services/aiClient";
import { CoachPage } from "./CoachPage";

/**
 * Being told to wait is fine. Being told to wait, left with a live send button,
 * and then given a hard failure for doing the only thing on offer is not — and
 * the failure named the Edge Function it could not reach while it was at it.
 */

const { loadChatHistory, getAiUsage, sendChatMessage } = vi.hoisted(() => ({
  loadChatHistory: vi.fn(),
  getAiUsage: vi.fn(),
  sendChatMessage: vi.fn(),
}));

vi.mock("../services/aiClient", async () => {
  // The real class, so the test exercises the real rule: presentError shows a
  // FunctionError verbatim precisely because it descends from UserFacingError.
  const { UserFacingError } = await vi.importActual<typeof import("../lib/errors")>(
    "../lib/errors",
  );

  class FunctionError extends UserFacingError {
    constructor(message: string, readonly payload: unknown) {
      super(message);
      this.name = "FunctionError";
    }
  }

  return {
    FunctionError,
    loadChatHistory,
    getAiUsage,
    sendChatMessage,
    uploadMealPhoto: vi.fn(),
    clearChatHistory: vi.fn(),
    markEstimateLogged: vi.fn(),
  };
});

vi.mock("../state/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "a@b.com" } }),
}));

vi.mock("../state/AppDataContext", () => ({
  useAppData: () => ({ logFood: vi.fn(), date: "2026-08-30", refresh: vi.fn() }),
}));

vi.mock("../lib/native", () => ({ isNative: false, capturePhoto: vi.fn() }));

const allowance = (callType: string, used: number, dailyLimit: number) => ({
  callType,
  used,
  dailyLimit,
  resetsAt: "2026-08-31T00:00:00.000Z",
});

/** A burst refusal, shaped exactly as the server sends one. */
const tooFast = (retryAfter: number) =>
  new FunctionError(`That is a lot at once — give it ${retryAfter} seconds and try again.`, {
    code: "rate_limit",
    usage: { ...allowance("chat", 2, 35), retryAfter },
  });

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByPlaceholderText(/ask about food/i), text);
  await user.click(screen.getByRole("button", { name: /^send$/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  loadChatHistory.mockResolvedValue([]);
  getAiUsage.mockImplementation((callType: string) =>
    Promise.resolve(allowance(callType, 0, callType === "vision" ? 8 : 35)),
  );
});

describe("sending too quickly", () => {
  it("counts the wait down instead of inviting a retry that cannot work", async () => {
    sendChatMessage.mockRejectedValueOnce(tooFast(20));
    const user = userEvent.setup();
    render(<CoachPage />);

    await ask(user, "How much protein?");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/send again in \d+ seconds/i),
    );
    expect(screen.getByRole("button", { name: /available in/i })).toBeDisabled();
  });

  it("refuses the second press locally rather than earning a second refusal", async () => {
    sendChatMessage.mockRejectedValueOnce(tooFast(20));
    const user = userEvent.setup();
    render(<CoachPage />);

    await ask(user, "How much protein?");
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    // The words are put back for them, so pressing send is the obvious move.
    await user.click(screen.getByRole("button", { name: /available in/i }));

    expect(sendChatMessage).toHaveBeenCalledTimes(1);
  });

  it("never names the service it could not reach", async () => {
    sendChatMessage.mockRejectedValueOnce(
      new Error('Could not reach the "ai-chat" service. It may not be deployed yet.'),
    );
    const user = userEvent.setup();
    render(<CoachPage />);

    await ask(user, "How much protein?");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/ai-chat|deployed|function/i);
    expect(alert).toHaveTextContent(/try again/i);
  });
});

describe("running out for the day", () => {
  it("stands the composer down before the user spends a call finding out", async () => {
    getAiUsage.mockImplementation((callType: string) =>
      Promise.resolve(
        callType === "chat" ? allowance("chat", 35, 35) : allowance("vision", 0, 8),
      ),
    );
    const user = userEvent.setup();
    render(<CoachPage />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/used all 35 of today's coach messages/i),
    );

    await user.type(screen.getByPlaceholderText(/back tomorrow/i), "One more?");
    await user.click(screen.getByRole("button", { name: /^send$/i }));

    expect(sendChatMessage).not.toHaveBeenCalled();
  });
});
