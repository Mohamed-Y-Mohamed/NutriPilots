import {
  Bot,
  ChartNoAxesColumnIncreasing,
  CookingPot,
  Gauge,
  Plus,
  Settings,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Brand } from "./Logo";
import { PullToRefresh } from "./PullToRefresh";
import { cx } from "./ui";
import { useAppData } from "../state/AppDataContext";

/**
 * Four destinations, always at the bottom, at every screen size. Keeping the
 * bar in one place means a user never has to learn a second navigation model
 * when they move between phone and desktop.
 */
const NAVIGATION = [
  { to: "/today", label: "Today", icon: Gauge },
  { to: "/diary", label: "Add food", icon: Plus },
  { to: "/recipes", label: "Recipes", icon: CookingPot },
  { to: "/coach", label: "Coach", icon: Bot },
] as const;

export function AppShell() {
  const location = useLocation();
  const { refresh } = useAppData();
  const mainRef = useRef<HTMLElement>(null);

  // Route changes scroll to the top and reset the reading position, the way a
  // native screen transition does.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [location.pathname]);

  /**
   * Which tab the indicator sits under, or -1 when the user is somewhere the
   * tab bar does not describe — Goals and Settings live in the header, and an
   * indicator parked under an unrelated tab would be actively misleading.
   */
  const activeIndex = NAVIGATION.findIndex(({ to }) => location.pathname.startsWith(to));

  return (
    <div className="min-h-svh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-100 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <header className="h-header pt-safe fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-line bg-canvas/80 px-4 backdrop-blur-md">
        <Brand size={26} />
        <nav className="flex items-center gap-1" aria-label="Secondary">
          <HeaderLink to="/goals" label="Goals">
            <ChartNoAxesColumnIncreasing size={19} strokeWidth={1.9} />
          </HeaderLink>
          <HeaderLink to="/settings" label="Settings">
            <Settings size={19} strokeWidth={1.9} />
          </HeaderLink>
        </nav>
      </header>

      <main
        ref={mainRef}
        id="main-content"
        tabIndex={-1}
        className="pt-header pb-tabbar outline-none"
      >
        <PullToRefresh onRefresh={refresh}>
          {/*
            Keyed on the path so the entrance replays on every navigation.
            Entrance animations only run on mount, and without a changing key
            React reuses this subtree between routes — which is why the app
            animated on first load and then never again.
          */}
          <div key={location.pathname} className="animate-route">
            <Outlet />
          </div>
        </PullToRefresh>
      </main>

      <nav
        aria-label="Main"
        className="h-tabbar pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/85 backdrop-blur-md"
      >
        <div className="relative mx-auto grid h-17 max-w-md grid-cols-4 px-1 pt-1.5">
          {/*
            One indicator that travels, rather than four that grow and shrink.

            The old version faded a separate bar in under each tab, so nothing
            connected the place you left to the place you arrived — which is
            the one thing the indicator exists to say. A single pill sliding
            the distance makes the movement legible.

            Only `transform` and `opacity` animate, so it never touches layout,
            and it is quick: the tab bar is used dozens of times a day and
            anything slower than about a quarter of a second turns navigation
            into waiting.
          */}
          <span
            aria-hidden="true"
            className={cx(
              "pointer-events-none absolute inset-y-1.5 left-0 w-1/4 px-2",
              "transition-[transform,opacity] duration-[260ms] ease-out",
              // Hidden on Goals and Settings, which the bar does not describe —
              // an indicator parked under an unrelated tab is worse than none.
              activeIndex < 0 && "opacity-0",
            )}
            style={{ transform: `translateX(${Math.max(activeIndex, 0) * 100}%)` }}
          >
            <span className="block size-full rounded-2xl bg-brand-soft" />
          </span>

          {NAVIGATION.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cx(
                  "group relative z-10 flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium",
                  "transition-colors duration-200 ease-out",
                  isActive ? "text-brand" : "text-ink-faint hover:text-ink-muted",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.3 : 1.9}
                    aria-hidden="true"
                    // The lift is what makes the icon feel picked up by the
                    // indicator arriving under it rather than just recoloured.
                    className={cx(
                      "transition-transform duration-[260ms] ease-out group-active:scale-90",
                      isActive && "-translate-y-0.5 scale-110",
                    )}
                  />
                  <span className="truncate">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function HeaderLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        cx(
          "grid size-10 place-items-center rounded-xl transition-colors",
          isActive ? "bg-brand-soft text-brand" : "text-ink-muted hover:bg-muted hover:text-ink",
        )
      }
    >
      {children}
    </NavLink>
  );
}
