import { describe, expect, it, vi } from "vitest";
import { submitDeletionRequest } from "./deletionRequest";

describe("submitDeletionRequest", () => {
  it("posts the fields Netlify expects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });

    await submitDeletionRequest({ email: "a@b.com", reason: "Too many carbs" }, fetchMock);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const sent = new URLSearchParams(init.body);
    // Without form-name, Netlify has nothing to match the submission against.
    expect(sent.get("form-name")).toBe("account-deletion");
    expect(sent.get("email")).toBe("a@b.com");
    expect(sent.get("reason")).toBe("Too many carbs");
    // The honeypot must be present and empty, or the submission looks like a bot.
    expect(sent.get("company")).toBe("");
  });

  it("points the user at the instant route when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(
      submitDeletionRequest({ email: "a@b.com", reason: "" }, fetchMock),
    ).rejects.toThrow(/delete your account from the app/);
  });
});
