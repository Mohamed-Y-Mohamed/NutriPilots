import { Play } from "lucide-react";
import { Link } from "react-router-dom";
import { Brand } from "./Logo";
import { cx } from "./ui";
import { useAuth } from "../state/AuthContext";

/**
 * Fill this in once the Play Store listing is live.
 *
 * While it is empty the badge renders as an inert "coming soon" panel rather
 * than a link to nowhere: a store badge that does nothing when pressed is worse
 * than one that says it is not ready yet.
 */
const PLAY_STORE_URL: string = "";

/**
 * Offering "Log in" to someone already signed in reads as though the site has
 * lost track of them, so the second link follows the session.
 */
function links(signedIn: boolean) {
  return [
    { to: "/", label: "Home" },
    signedIn ? { to: "/today", label: "Today" } : { to: "/auth", label: "Log in" },
    { to: "/delete-account", label: "Delete account" },
  ];
}

/**
 * The public footer.
 *
 * Olive rather than another sheet of canvas, so the page ends on the brand
 * colour the app already uses for its darkest surfaces (the sign-in panel, the
 * coach prompt on the dashboard). Olive is a fixed colour in both themes, which
 * also means the footer looks identical light or dark and only the seam above
 * it changes.
 */
export function SiteFooter() {
  const { user } = useAuth();
  return (
    <footer className="bg-olive text-white">
      <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-14 lg:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between md:gap-12">
          <div className="min-w-0 max-w-sm">
            <Brand size={30} onDark />
            <p className="mt-4 text-[15px] leading-relaxed text-white/60">
              A food diary, a recipe book and a coach that knows what you ate. Estimates for
              general guidance, not medical advice.
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-8 sm:flex-row sm:gap-12 md:gap-16">
            <nav aria-label="Footer">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-lime">
                Pages
              </h2>
              <ul className="mt-3 grid gap-1">
                {links(Boolean(user)).map(({ to, label }) => (
                  <li key={to}>
                    <Link
                      to={to}
                      className="inline-flex min-h-9 items-center text-sm text-white/70 transition-colors hover:text-white"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="min-w-0">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-lime">
                Get the app
              </h2>
              <div className="mt-3">
                <PlayStoreBadge />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 border-t border-white/10 pt-6">
          <small className="block text-xs text-white/60">
            &copy; {new Date().getFullYear()} NutriPilot. All rights reserved.
          </small>
        </div>
      </div>
    </footer>
  );
}

/**
 * An inline glyph rather than an image: the site ships a strict CSP with
 * `default-src 'self'`, so Google's hosted badge could never load, and a local
 * copy of it would be a brand asset this repo has no licence to redraw.
 */
function PlayStoreBadge() {
  const label = "Get it on Google Play";

  const inner = (
    <>
      <Play size={20} strokeWidth={0} fill="currentColor" aria-hidden="true" className="shrink-0" />
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wide text-white/55">
          {PLAY_STORE_URL ? "Get it on" : "Coming soon to"}
        </span>
        <span className="block truncate text-[15px] font-semibold leading-tight">Google Play</span>
      </span>
    </>
  );

  // No colour here: each branch sets its own, because two competing text-white
  // utilities would be resolved by stylesheet order rather than by intent.
  const shared = "inline-flex max-w-full items-center gap-3 rounded-xl border px-4 py-2.5";

  if (!PLAY_STORE_URL) {
    return (
      // aria-disabled on a non-focusable element only helps if it is announced,
      // so the state is written out in the visible text too — nobody has to
      // infer "unavailable" from a dimmed border.
      <span
        aria-disabled="true"
        // A dashed border carries the "not yet" without dimming the text below
        // AA — the state has to be legible to be understood.
        className={cx(
          shared,
          "cursor-not-allowed border-dashed border-white/20 bg-white/3 text-white/60",
        )}
      >
        {inner}
      </span>
    );
  }

  return (
    <a
      href={PLAY_STORE_URL}
      target="_blank"
      // noreferrer covers noopener, and both keep the store tab away from this one.
      rel="noreferrer"
      aria-label={`${label} (opens in a new tab)`}
      className={cx(
        shared,
        "border-white/15 bg-white/5 text-white transition-colors hover:border-lime/40 hover:bg-white/10",
      )}
    >
      {inner}
    </a>
  );
}
