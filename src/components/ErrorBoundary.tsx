import { Component, type ErrorInfo, type ReactNode } from "react";
import { hideNativeSplash } from "../lib/native";

/**
 * Last line of defence against a render crash taking the whole app with it.
 *
 * This matters far more on Android than on the web. A browser tab that goes
 * blank still has a reload button; the WebView does not, so an uncaught render
 * error leaves the user staring at the splash colour with no way out but
 * force-quitting — and the app is broken again on next launch if the crash is
 * in the first render.
 *
 * Deliberately dependency-free: no contexts, no design-system imports, no
 * Tailwind classes. Whatever broke could be any of those, and a fallback that
 * needs the broken tree to render is not a fallback. Inline styles and the
 * splash palette only.
 *
 * The error text is never shown to the user — it goes to the console, where a
 * developer can reach it, and the screen says something a human can act on.
 */

const SPLASH_GREEN = "#071F18";
const MINT = "#7BE3A8";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The only record of what happened. Kept to the console rather than sent
    // anywhere, because the app has no error-reporting service wired up and a
    // silent network call from a crash handler is its own bug.
    console.error(
      `[NutriPilot ${__BUILD_ID__}] render crash:`,
      error,
      info.componentStack,
    );

    // `launchAutoHide: false` means the native splash only ever comes down
    // because the app asks it to. If the crash happened before App got that
    // far, this screen would render underneath a splash that never lifts —
    // which looks exactly like a frozen app. Failure-tolerant by design, and a
    // no-op on the web.
    void hideNativeSplash();
  }

  /**
   * A full reload rather than clearing the flag. Re-rendering the same broken
   * tree from the same broken state just crashes again; the session survives
   * the reload because Supabase persists it.
   */
  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem 1.5rem",
          background: SPLASH_GREEN,
          color: "#E8F5EE",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
          NutriPilot hit a snag
        </h1>
        <p style={{ margin: 0, maxWidth: "32ch", lineHeight: 1.5, opacity: 0.8 }}>
          Something went wrong displaying this screen. Your food diary is saved
          and nothing has been lost.
        </p>
        <button
          type="button"
          onClick={this.reload}
          style={{
            marginTop: "0.5rem",
            padding: "0.75rem 1.75rem",
            minHeight: "44px",
            borderRadius: "999px",
            border: "none",
            background: MINT,
            color: SPLASH_GREEN,
            fontSize: "1rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Reload NutriPilot
        </button>
        <p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.45 }}>
          Build {__BUILD_ID__}
        </p>
      </div>
    );
  }
}
