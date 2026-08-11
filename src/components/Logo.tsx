import { Link } from "react-router-dom";
import { cx } from "./ui";

function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo-192.png"
      width={size}
      height={size}
      alt=""
      style={{ width: size, height: size }}
      className={cx("shrink-0 rounded-lg ring-1 ring-line dark:ring-ink-faint", className)}
    />
  );
}

export function Brand({
  size = 28,
  to = "/",
  onDark = false,
}: {
  size?: number;
  to?: string | null;
  onDark?: boolean;
}) {
  const content = (
    <>
      <LogoMark size={size} />
      <span className={cx("text-lg font-semibold tracking-tight", onDark && "text-white")}>
        Nutri<span className={onDark ? "text-lime" : "text-brand"}>Pilot</span>
      </span>
    </>
  );

  const className = "inline-flex items-center gap-2.5";

  if (!to) return <span className={className}>{content}</span>;

  return (
    <Link to={to} className={className} aria-label="NutriPilot home">
      {content}
    </Link>
  );
}
