import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollingText } from "./ScrollingText";

/**
 * jsdom does no layout, so every element measures zero. These tests describe
 * the widths instead: `content` is how wide the text wants to be, `box` how
 * much room it was given.
 */
function measuring(content: number, box: number) {
  const scrollWidth = vi
    .spyOn(HTMLElement.prototype, "scrollWidth", "get")
    .mockReturnValue(content);
  const clientWidth = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(box);
  return () => {
    scrollWidth.mockRestore();
    clientWidth.mockRestore();
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ScrollingText", () => {
  it("keeps the whole name readable by assistive tech, scrolled or not", () => {
    const done = measuring(400, 100);
    render(<ScrollingText>Slow-roasted lamb shoulder with garlic</ScrollingText>);

    expect(screen.getByText("Slow-roasted lamb shoulder with garlic")).toBeInTheDocument();
    done();
  });

  it("leaves text that already fits completely alone", () => {
    const done = measuring(80, 100);
    render(<ScrollingText>Rice</ScrollingText>);

    const line = screen.getByText("Rice");
    expect(line).toHaveClass("truncate");
    expect(line.style.transform).toBe("");
    // Nothing to reveal, so nothing to hover for.
    expect(line).not.toHaveAttribute("title");
    done();
  });

  it("truncates first, then travels far enough to show the tail", () => {
    vi.useFakeTimers();
    const done = measuring(400, 100);
    render(<ScrollingText>Slow-roasted lamb shoulder with garlic</ScrollingText>);

    const line = screen.getByText("Slow-roasted lamb shoulder with garlic");

    // It starts as an ordinary truncated line so the ellipsis is visible.
    expect(line).toHaveClass("truncate");
    expect(line).toHaveAttribute("title", "Slow-roasted lamb shoulder with garlic");

    act(() => void vi.advanceTimersByTime(1600));

    // 400 wanted, 100 available: it has 300px of tail to show.
    expect(line).toHaveClass("w-max");
    expect(line).not.toHaveClass("truncate");
    expect(line.style.transform).toBe("translateX(-300px)");
    done();
  });

  it("comes back to the start rather than snapping", () => {
    vi.useFakeTimers();
    const done = measuring(400, 100);
    render(<ScrollingText>Slow-roasted lamb shoulder with garlic</ScrollingText>);
    const line = screen.getByText("Slow-roasted lamb shoulder with garlic");

    // Out, hold at the end, then home again.
    act(() => void vi.advanceTimersByTime(1600));
    const travel = Number(line.style.transitionDuration.replace("ms", ""));
    act(() => void vi.advanceTimersByTime(travel + 1300));

    // Still laid out for movement, so the return journey animates.
    expect(line).toHaveClass("w-max");
    expect(line.style.transform).toBe("translateX(0)");

    act(() => void vi.advanceTimersByTime(travel));
    expect(line).toHaveClass("truncate");
    done();
  });

  it("travels at a readable speed rather than a fixed duration", () => {
    vi.useFakeTimers();
    const done = measuring(400, 100);
    render(<ScrollingText>Slow-roasted lamb shoulder with garlic</ScrollingText>);
    const line = screen.getByText("Slow-roasted lamb shoulder with garlic");

    act(() => void vi.advanceTimersByTime(1600));
    // 300px at 45px/s.
    expect(line.style.transitionDuration).toBe(`${Math.round((300 / 45) * 1000)}ms`);
    done();
  });

  it("stays still when the reader has asked for less motion", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList);
    const done = measuring(400, 100);

    render(<ScrollingText>Slow-roasted lamb shoulder with garlic</ScrollingText>);
    const line = screen.getByText("Slow-roasted lamb shoulder with garlic");

    act(() => void vi.advanceTimersByTime(10_000));

    expect(line).toHaveClass("truncate");
    expect(line.style.transform).toBe("translateX(0)");
    done();
  });
});
