import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveVerification } from "./verification";

const URL_BASE = "https://project.supabase.co";
const KEY = "anon-key";

const verify = (href: string) => resolveVerification(URL_BASE, KEY, href);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveVerification", () => {
  it("treats a code with no error as confirmed", async () => {
    // The real link that was reported as stuck. Supabase only redirects with a
    // code after its own /auth/v1/verify accepted the token.
    const result = await verify("?code=c143b740-1147-4782-a816-241eed94304b");
    expect(result.outcome).toBe("verified");
  });

  it("refuses a link that only claims success", async () => {
    // Anyone can type this into the address bar.
    expect((await verify("?verified=true")).outcome).toBe("failed");
  });

  it("refuses a link with nothing on it", async () => {
    expect((await verify("")).outcome).toBe("failed");
  });

  it("reports an expired link from the query string", async () => {
    const result = await verify("?error=access_denied&error_description=Email+link+is+invalid");
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("Email link is invalid");
  });

  it("reports an expired link from the fragment", async () => {
    // The implicit flow puts the failure after the hash instead.
    const result = await verify("#error=access_denied&error_code=otp_expired");
    expect(result.outcome).toBe("failed");
  });

  it("prefers an error over a code sitting on the same link", async () => {
    expect((await verify("?code=abc&error=access_denied")).outcome).toBe("failed");
  });

  it("accepts an implicit-flow access token", async () => {
    expect((await verify("#access_token=ey.123&type=signup")).outcome).toBe("verified");
  });

  it("checks a token_hash against Supabase and believes only its answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "ey.123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verify("?token_hash=pkce_abc&type=signup");

    expect(result.outcome).toBe("verified");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL_BASE}/auth/v1/verify`);
    expect(JSON.parse(init.body)).toEqual({ type: "signup", token_hash: "pkce_abc" });
  });

  it("fails when Supabase rejects the token_hash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ msg: "Token has expired" }) }),
    );

    const result = await verify("?token_hash=pkce_abc");
    expect(result.outcome).toBe("failed");
    expect(result.reason).toBe("Token has expired");
  });

  it("does not claim success when Supabase is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const result = await verify("?token_hash=pkce_abc");
    expect(result.outcome).toBe("failed");
  });

  it("does not claim success when the response carries no session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    expect((await verify("?token_hash=pkce_abc")).outcome).toBe("failed");
  });
});
