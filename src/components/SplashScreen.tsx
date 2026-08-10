import { cx } from "./ui";

/**
 * The web splash mirrors the native Capacitor splash exactly — same olive, same
 * logo, same size — so the handover between the two is invisible.
 */
export function SplashScreen({ leaving = false }: { leaving?: boolean }) {
  return (
    <div
      role="status"
      aria-label="Loading NutriPilot"
      className={cx(
        "pt-safe pb-safe fixed inset-0 z-100 grid place-items-center bg-olive transition-opacity duration-300",
        leaving ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <div className="animate-rise grid justify-items-center">
        <img src="/logo-512.png" width={96} height={96} alt="" className="size-24 rounded-3xl" />
        <span className="mt-5 text-2xl font-semibold tracking-tight text-white">
          Nutri<span className="text-lime">Pilot</span>
        </span>
        <span className="mt-1.5 text-[13px] text-white/55">Eat well. Track simply.</span>
      </div>

      <span
        aria-hidden="true"
        className="absolute bottom-[max(3.5rem,env(safe-area-inset-bottom))] h-0.5 w-24 overflow-hidden rounded-full bg-white/15"
      >
        <i className="animate-splash-slide block h-full w-2/5 rounded-full bg-lime" />
      </span>
    </div>
  );
}
