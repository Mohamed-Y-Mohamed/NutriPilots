import {
  BookOpen,
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
import { cx } from "./ui";

/**
 * Five destinations, always at the bottom, at every screen size. Keeping the
 * bar in one place means a user never has to learn a second navigation model
 * when they move between phone and desktop.
 */
const NAVIGATION = [
  { to: "/", label: "Today", icon: Gauge },
  { to: "/diary", label: "Add food", icon: Plus },
  { to: "/recipes", label: "Recipes", icon: CookingPot },
  { to: "/library", label: "Library", icon: BookOpen },
  { to: "/coach", label: "Coach", icon: Bot },
] as const;

export function AppShell() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Route changes scroll to the top and reset the reading position, the way a
  // native screen transition does.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [location.pathname]);

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
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="h-tabbar pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/85 backdrop-blur-md"
      >
        <div className="mx-auto grid h-17 max-w-md grid-cols-5 px-1 pt-1.5">
          {NAVIGATION.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cx(
                  "group relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium",
                  "transition-colors duration-200",
                  isActive ? "text-brand" : "text-ink-faint hover:text-ink-muted",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={cx(
                      "absolute top-0 h-0.5 rounded-full bg-brand transition-all duration-300",
                      isActive ? "w-8 opacity-100" : "w-0 opacity-0",
                    )}
                  />
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.2 : 1.9}
                    aria-hidden="true"
                    className="transition-transform duration-200 group-active:scale-90"
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
