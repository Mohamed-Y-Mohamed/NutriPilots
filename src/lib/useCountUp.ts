import { useEffect, useRef, useState } from "react";

/**
 * A number that travels to its new value instead of snapping to it.
 *
 * Used for the figures that change as a direct result of something the user
 * just did — logging a meal, editing a target. The movement is what says "this
 * changed because of you"; a number that simply swaps is indistinguishable
 * from a re-render.
 *
 * Deliberately NOT used for numbers the user is reading rather than watching.
 * A macro gram figure in a list should not animate every time the list paints.
 */

/** Matches --ease-out. Strong enough that most of the travel is over early. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const DEFAULT_DURATION = 520;

/** Below this, animating is more distracting than the change it describes. */
const MIN_WORTH_ANIMATING = 2;

export function useCountUp(target: number, durationMs = DEFAULT_DURATION): number {
  const [value, setValue] = useState(target);

  // Read once per run rather than subscribing: someone changing this setting
  // mid-animation is not a case worth the listener.
  const reduced = useRef(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!Number.isFinite(target)) return;

    const from = value;
    const distance = target - from;

    // Jump for a reduced-motion user, for a change too small to see, and for
    // the very first value — counting up from zero on load would delay the
    // number being readable for no benefit.
    if (reduced.current || Math.abs(distance) < MIN_WORTH_ANIMATING) {
      setValue(target);
      return;
    }

    const started = performance.now();

    const step = (now: number) => {
      const elapsed = now - started;
      const progress = Math.min(1, elapsed / durationMs);
      setValue(from + distance * easeOut(progress));

      if (progress < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        // Land exactly on the target rather than on 2,399.997.
        setValue(target);
      }
    };

    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
    // `value` is deliberately not a dependency: including it would restart the
    // animation on every frame it sets. Retargeting mid-flight is handled by
    // reading the current value as the new starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}
