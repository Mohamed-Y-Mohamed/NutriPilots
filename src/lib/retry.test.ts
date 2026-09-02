import { describe, expect, it, vi } from "vitest";
import { withRetry } from "./retry";
import { isTransient } from "./errors";

/**
 * The value of retrying is entirely in what it refuses to retry. A permanent
 * failure tried three times is three times the wait for the same answer, and a
 * server that already said no being asked twice more.
 */

describe("isTransient", () => {
  it("retries the shapes a dropped connection takes", () => {
    for (const message of [
      "TypeError: Failed to fetch",
      "NetworkError when attempting to fetch resource",
      "Network request failed",
      "Load failed",
      "fetch failed",
      "The operation timed out",
      "502 Bad Gateway",
      "503 Service Unavailable",
    ]) {
      expect(isTransient(new Error(message)), message).toBe(true);
    }
  });

  it("refuses to retry an answer the server settled on purpose", () => {
    for (const message of [
      "JWT expired",
      "invalid token",
      "not authenticated",
      "permission denied for table diary_entries",
      'new row violates row-level security policy for table "diary_entries"',
      "duplicate key value violates unique constraint",
      "value violates check constraint",
    ]) {
      expect(isTransient(new Error(message)), message).toBe(false);
    }
  });

  /**
   * An expired token surfacing through a failed request must not be retried
   * just because the word "fetch" appears alongside it — the auth check runs
   * first for exactly this case.
   */
  it("treats an auth failure as permanent even when it mentions the network", () => {
    expect(isTransient(new Error("Failed to fetch: JWT expired"))).toBe(false);
  });

  it("says nothing useful about an empty reason", () => {
    expect(isTransient(undefined)).toBe(false);
    expect(isTransient({})).toBe(false);
  });
});

describe("withRetry", () => {
  it("does not retry what already worked", async () => {
    const run = vi.fn().mockResolvedValue("ok");

    await expect(withRetry(run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("tries again after a dropped connection", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue("ok");

    await expect(withRetry(run, { attempts: 2 })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up immediately on a permanent failure", async () => {
    const run = vi.fn().mockRejectedValue(new Error("permission denied"));

    await expect(withRetry(run)).rejects.toThrow("permission denied");
    // Once, not three times: the answer would be identical.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("surfaces the real error after the last attempt", async () => {
    const run = vi.fn().mockRejectedValue(new Error("Failed to fetch"));

    // The message the user eventually sees is built from this, so it must be
    // the underlying failure rather than something generic about retrying.
    await expect(withRetry(run, { attempts: 2 })).rejects.toThrow("Failed to fetch");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("honours a caller's own idea of what is worth retrying", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("nope")).mockResolvedValue("ok");

    await expect(
      withRetry(run, { attempts: 2, shouldRetry: () => true }),
    ).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });
});
