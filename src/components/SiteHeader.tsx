import {
  Bot,
  ChartNoAxesColumnIncreasing,
  CookingPot,
  Gauge,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings,
  Sun,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Link } from "react-router-dom";
import { Brand } from "./Logo";
import { IconButton, buttonClass, cx } from "./ui";
import { useAuth } from "../state/AuthContext";
import { useTheme } from "../state/ThemeContext";

/**
 * The signed-in destinations, in the order someone would reach for them: the
 * two daily jobs first, then the things visited occasionally. Deliberately the
 * same labels as the app's tab bar so the menu never teaches a second name for
 * a screen the user already knows.
 */
const MENU_LINKS = [
  { to: "/today", label: "Today", icon: Gauge },
  { to: "/diary", label: "Add food", icon: Plus },
  { to: "/recipes", label: "Recipes", icon: CookingPot },
  { to: "/coach", label: "Coach", icon: Bot },
  { to: "/goals", label: "Goals", icon: ChartNoAxesColumnIncreasing },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

/**
 * The header for the public landing page — not the app shell.
 *
 * The shell's header is fixed with a bottom tab bar underneath it and assumes a
 * signed-in user. A marketing page has neither, so this is a separate component
 * rather than a variant: sticky instead of fixed, and it has to read correctly
 * for a visitor who has never signed in.
 */
export function SiteHeader() {
  const { user } = useAuth();

  return (
    <header className="pt-safe sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <span className="min-w-0">
          <Brand size={26} />
        </span>

        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          {user ? (
            <AccountMenu />
          ) : (
            <Link to="/auth" className={buttonClass("primary")}>
              Log in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Button renders a <button>, and every call to action on this page navigates.
 * Something that looks like a button but changes page still has to *be* a link:
 * middle-clickable, copyable, and announced as "link" rather than as a control
 * that acts in place.
 *
 * This deliberately mirrors Button's recipe instead of replacing it. It belongs
 * in ui.tsx as a proper LinkButton primitive; it lives here because this work
 * was scoped to new files only.
 */

/**
 * One button, two states.
 *
 * The icon names the destination rather than the current theme — a sun means
 * "switch to light" — and the label spells that out for anyone who cannot see
 * the icon. No aria-pressed: the accessible name already changes with the
 * state, and a toggle that announces both ("Switch to light theme, pressed")
 * describes itself twice and contradicts itself once.
 *
 * Pressing it writes an explicit preference, dropping "system". Someone who
 * reaches for the switch has an opinion about right now; Settings still offers
 * "System" for handing the decision back to the OS.
 */
function ThemeToggle() {
  const { resolved, setPreference } = useTheme();
  const isDark = resolved === "dark";

  return (
    <IconButton
      label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setPreference(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun size={19} strokeWidth={1.9} /> : <Moon size={19} strokeWidth={1.9} />}
    </IconButton>
  );
}

/**
 * The signed-in menu, built to the ARIA menu-button pattern.
 *
 * A signed-in visitor landing here arrived from a bookmark or a shared link and
 * wants back into the app, so every destination is one press away rather than
 * behind a trip through /today.
 */
function AccountMenu() {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);

  /** Closing by keyboard has to hand focus back, or it lands on <body>. */
  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Opening moves focus into the menu, which is what makes the arrow keys and
  // Escape meaningful for a keyboard user the moment the menu appears.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  // Pointerdown rather than click: a press that starts outside should dismiss
  // the menu even if the pointer is released somewhere else entirely.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  /**
   * Listens on the wrapper rather than the menu so Escape still works while
   * focus sits on the trigger, which is where it returns to.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      // The arrow keys open the menu from the trigger, which is what a keyboard
      // user reaches for once aria-haspopup has told them a menu is there.
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }

    // Tab out is a deliberate exit: let focus go where the user aimed it and
    // just take the menu away behind them.
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }

    const items = itemRefs.current.filter((item): item is HTMLElement => item !== null);
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement as HTMLElement);

    const focusAt = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };

    if (event.key === "ArrowDown") focusAt(current + 1);
    else if (event.key === "ArrowUp") focusAt(current - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(items.length - 1);
  };

  const handleSignOut = () => {
    setOpen(false);
    void signOut().catch(() => {
      // Sign-out fails when the network is down, and the menu has already gone.
      // There is nowhere honest to report it from here, and the session is
      // still valid, so leaving the user signed in is the truthful outcome.
    });
  };

  return (
    <div ref={wrapperRef} onKeyDown={onKeyDown} className="relative">
      {/* A plain button rather than IconButton: returning focus here after
          Escape needs a ref, and IconButton does not accept one. The classes
          are IconButton's so the two controls stay visually identical. */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        className={cx(
          "grid size-10 shrink-0 place-items-center rounded-lg transition-colors",
          open ? "bg-muted text-ink" : "text-ink-faint hover:bg-muted hover:text-ink",
        )}
      >
        {open ? <X size={20} strokeWidth={1.9} /> : <Menu size={20} strokeWidth={1.9} />}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          // animate-rise is already neutralised by the global reduced-motion
          // rule in styles.css, so no extra guard is needed here.
          className="animate-rise absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-line bg-surface p-1.5 shadow-lg"
        >
          {MENU_LINKS.map(({ to, label, icon: Icon }, index) => (
            <Link
              key={to}
              to={to}
              role="menuitem"
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              onClick={() => setOpen(false)}
              className="flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm text-ink transition-colors hover:bg-muted"
            >
              <Icon size={17} strokeWidth={1.9} aria-hidden="true" className="text-ink-muted" />
              <span className="min-w-0 truncate">{label}</span>
            </Link>
          ))}

          <hr className="my-1.5 border-0 border-t border-line-soft" />

          <button
            type="button"
            role="menuitem"
            ref={(node) => {
              itemRefs.current[MENU_LINKS.length] = node;
            }}
            onClick={handleSignOut}
            className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm text-danger transition-colors hover:bg-danger-soft"
          >
            <LogOut size={17} strokeWidth={1.9} aria-hidden="true" />
            <span className="min-w-0 truncate">Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
