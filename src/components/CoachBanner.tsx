import { Bot, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * The way into the photo estimate, for people who do not yet know it exists.
 *
 * It lives inside the add-food card, where someone is already looking for a way
 * to log a meal. It appears on the Today screen exactly once — the first time
 * the app is ever opened — because a permanent advert for a feature you have
 * already found is just something to scroll past.
 */
export function CoachBanner({ className }: { className?: string }) {
  return (
    <Link
      to="/coach"
      className={`flex items-center gap-3 rounded-xl bg-olive px-3.5 py-3 transition-transform transition-colors hover:bg-olive-deep active:scale-[0.98] ${className ?? ""}`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-lime">
        <Bot size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-white">
          Not sure what you just ate?
        </span>
        <span className="block text-[12px] leading-snug text-white/55">
          Photograph the plate and the coach estimates it.
        </span>
      </span>
      <ChevronRight size={17} className="shrink-0 text-white/40" />
    </Link>
  );
}
