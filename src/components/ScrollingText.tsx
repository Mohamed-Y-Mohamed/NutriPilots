import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

/** Pixels per second. Slow enough to read, quick enough not to feel stuck. */
const SPEED = 45;
/** How long the start of the name sits still before it sets off. */
const HOLD_START = 1600;
/** And how long the end stays put before it comes back. */
const HOLD_END = 1300;

/** Still and truncated, travelling out to its tail, or travelling home. */
type Phase = "rest" | "out" | "back";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A single line of text that stays inside its box.
 *
 * Short text is left alone entirely. Text too long for the space it has been
 * given is cut off with an ellipsis, then — because a name cut to "Grilled
 * chicken thigh with…" is not much use — it scrolls itself out to its tail and
 * back on a loop, so the whole thing can be read without tapping anything.
 *
 * The full string is always in the DOM, so screen readers and text search see
 * it whether it happens to be scrolled or not.
 */
export function ScrollingText({
  children,
  className,
  title,
}: {
  children: ReactNode;
  /** Applied to the box, so the caller controls the width it has to fit in. */
  className?: string;
  /** The plain text behind `children`, for the hover tooltip. */
  title?: string;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLSpanElement>(null);

  // How far it has to travel to show its tail. 0 means it already fits, which
  // is the common case and costs nothing beyond the measurement.
  const [distance, setDistance] = useState(0);
  const [phase, setPhase] = useState<Phase>("rest");

  // Measure after paint, and again whenever either side of the comparison
  // changes: the box, because rotating the phone changes what fits, and the
  // line itself, because the name it is showing can change under it.
  useEffect(() => {
    const outer = box.current;
    const inner = line.current;
    if (!outer || !inner) return;

    const measure = () => {
      // A couple of pixels of slack stops a name that fits almost exactly from
      // twitching back and forth over a rounding difference.
      const overflow = inner.scrollWidth - outer.clientWidth;
      setDistance(overflow > 2 ? overflow : 0);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  // Whatever the length, it travels at the same speed. A long name simply
  // takes longer rather than whipping past.
  const duration = Math.round((distance / SPEED) * 1000);

  // rest → out → back → rest, for as long as there is something to see.
  // Reduced motion keeps the ellipsis and skips the journey entirely.
  useEffect(() => {
    if (distance === 0 || reducedMotion()) {
      setPhase("rest");
      return;
    }

    const next: Record<Phase, { after: number; then: Phase }> = {
      rest: { after: HOLD_START, then: "out" },
      out: { after: duration + HOLD_END, then: "back" },
      back: { after: duration, then: "rest" },
    };

    const step = next[phase];
    const timer = setTimeout(() => setPhase(step.then), step.after);
    return () => clearTimeout(timer);
  }, [distance, phase, duration]);

  const travels = distance > 0;
  const moving = phase !== "rest";

  return (
    <span ref={box} className={cx("block min-w-0 overflow-hidden", className)}>
      <span
        ref={line}
        // At rest the browser's own ellipsis does the truncating. It only
        // becomes a free-standing line, wider than its box, while it moves.
        //
        // The transition is declared for the whole time it can travel, not
        // just while it is travelling: a transition that appears in the same
        // commit as the value it is meant to animate does not run at all, and
        // the text would jump rather than scroll.
        className={cx(
          "block whitespace-nowrap",
          travels && "transition-transform ease-linear",
          moving ? "w-max" : "truncate",
        )}
        style={
          travels
            ? {
              transform: phase === "out" ? `translateX(-${distance}px)` : "translateX(0)",
              transitionDuration: `${duration}ms`,
            }
            : undefined
        }
        // Only a caller that knows the plain text can offer a tooltip; rich
        // children have no single string to put in one.
        title={travels ? (title ?? (typeof children === "string" ? children : undefined)) : undefined}
      >
        {children}
      </span>
    </span>
  );
}
