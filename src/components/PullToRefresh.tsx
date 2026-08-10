import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { cx } from "./ui";

const TRIGGER_DISTANCE = 72;
const MAX_PULL = 110;

/**
 * Drag down from the top of a page to reload it, the way a native app does.
 *
 * Only engages when the page is already scrolled to the very top and the drag
 * is clearly vertical, so it never fights an ordinary scroll or a horizontal
 * swipe through the diet filters.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: PropsWithChildren<{ onRefresh: () => Promise<unknown> }>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startY = useRef(0);
  const startX = useRef(0);
  const active = useRef(false);

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      if (window.scrollY > 0 || refreshing) return;
      const touch = event.touches[0];
      startY.current = touch.clientY;
      startX.current = touch.clientX;
      active.current = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!active.current) return;

      const touch = event.touches[0];
      const deltaY = touch.clientY - startY.current;
      const deltaX = Math.abs(touch.clientX - startX.current);

      // Sideways movement means the user is swiping, not pulling.
      if (deltaY <= 0 || deltaX > Math.abs(deltaY)) {
        active.current = false;
        setPull(0);
        return;
      }

      // Resistance, so the sheet does not track the finger one-for-one.
      setPull(Math.min(MAX_PULL, deltaY * 0.5));
    };

    const onTouchEnd = () => {
      if (!active.current) return;
      active.current = false;

      setPull((current) => {
        if (current >= TRIGGER_DISTANCE) void run();
        return 0;
      });
    };

    const run = async () => {
      setRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onRefresh, refreshing]);

  const armed = pull >= TRIGGER_DISTANCE;
  const visible = refreshing || pull > 0;

  return (
    <>
      <div
        aria-hidden={!visible}
        className="pt-header pointer-events-none fixed inset-x-0 top-0 z-20 flex justify-center"
        style={{
          transform: `translateY(${refreshing ? 12 : Math.max(0, pull - 24)}px)`,
          opacity: visible ? 1 : 0,
          transition: active.current ? "none" : "transform 200ms, opacity 200ms",
        }}
      >
        <span
          className={cx(
            "grid size-9 place-items-center rounded-full border border-line bg-surface shadow-sm",
            armed || refreshing ? "text-brand" : "text-ink-faint",
          )}
        >
          <LoaderCircle
            size={17}
            className={refreshing ? "animate-spin" : undefined}
            style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          />
        </span>
      </div>

      {refreshing && (
        <span role="status" className="sr-only">
          Refreshing
        </span>
      )}

      {children}
    </>
  );
}
