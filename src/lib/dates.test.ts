/**
 * The AI allowance resets at midnight UTC, which for most people is a
 * meaningless hour of their own day. The Coach page therefore counts down to it
 * rather than naming a time — and a countdown is only reassuring if it stays
 * sensible at both ends of the day, including the moment it runs out.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTimeUntil } from "./dates";

const NOW = new Date("2026-08-20T09:30:00.000Z");

function at(iso: string): string {
  vi.setSystemTime(NOW);
  return formatTimeUntil(iso);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("formatTimeUntil", () => {
  it("gives hours and minutes for most of the day", () => {
    vi.useFakeTimers();
    expect(at("2026-08-21T00:00:00.000Z")).toBe("14h 30m");
  });

  it("drops the hours once under an hour is left", () => {
    vi.useFakeTimers();
    expect(at("2026-08-20T09:47:00.000Z")).toBe("17m");
  });

  it("does not say '0m' in the last few seconds", () => {
    vi.useFakeTimers();
    expect(at("2026-08-20T09:30:20.000Z")).toBe("under a minute");
  });

  it("reads sensibly just after the reset, when the stale time is already past", () => {
    // The page loaded before midnight; the counters have in fact already reset.
    vi.useFakeTimers();
    expect(at("2026-08-20T09:29:00.000Z")).toBe("a moment");
    expect(at("2026-08-20T09:30:00.000Z")).toBe("a moment");
  });

  it("does not print NaN when the server sends something unparseable", () => {
    vi.useFakeTimers();
    expect(at("not a date")).toBe("a moment");
  });

  it("keeps a whole number of hours honest", () => {
    vi.useFakeTimers();
    expect(at("2026-08-20T11:30:00.000Z")).toBe("2h 0m");
  });
});
