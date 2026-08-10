import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge, cx, FoodImage } from "./ui";

interface FoodRowProps {
  title: string;
  subtitle: ReactNode;
  imageUrl?: string | null;
  /** Replaces the thumbnail — used by the recents list for a "3×" pill. */
  leading?: ReactNode;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mine?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
  to?: string;
}

/**
 * The one row used for every food list in the app. Search results, recipes and
 * recents differ only in what they put in the leading slot.
 */
export function FoodRow({
  title,
  subtitle,
  imageUrl,
  leading,
  calories,
  protein,
  carbs,
  fat,
  mine,
  trailing,
  onClick,
  to,
}: FoodRowProps) {
  const className =
    "flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted sm:px-4";

  const content = (
    <>
      {leading ?? (
        <FoodImage
          src={imageUrl ?? undefined}
          alt=""
          className="size-12 shrink-0 rounded-xl object-cover"
        />
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium">{title}</span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-ink-muted">
          {mine && <Badge tone="info">Mine</Badge>}
          <span className="truncate">{subtitle}</span>
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className="block text-[14px] font-semibold tabular-nums">
          {Math.round(calories)}
          <span className="ml-0.5 text-[11px] font-normal text-ink-muted">kcal</span>
        </span>
        <span className="block text-[11px] tabular-nums text-ink-faint">
          P {Math.round(protein)} · C {Math.round(carbs)} · F {Math.round(fat)}
        </span>
      </span>

      {trailing && <span className="shrink-0 text-ink-faint">{trailing}</span>}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

export function FoodList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}
