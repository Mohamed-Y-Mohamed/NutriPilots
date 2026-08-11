import { ChevronDown, ImageOff, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ImgHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/* -------------------------------------------------------------------------- */
/* Form field styling                                                          */
/* -------------------------------------------------------------------------- */

/** Shared so every input in the app has the same height and focus treatment. */
export const inputClass =
  "w-full min-h-11 rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px] " +
  "outline-none transition-colors focus:border-brand";

export const labelClass = "text-xs font-medium text-ink-muted";

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "lime";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong",
  lime: "bg-lime text-olive-deep hover:bg-lime-strong",
  secondary: "border border-line bg-surface text-ink hover:bg-muted",
  ghost: "text-ink-muted hover:bg-muted hover:text-ink",
  danger: "bg-danger text-white hover:opacity-90",
};

const SIZES: Record<Size, string> = {
  sm: "min-h-9 px-3 text-xs",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-5 text-[15px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  full = false,
  // Without this a <button> inside a form defaults to submit, which reloads the
  // whole app the first time an action button is pressed. Callers that really
  // want a submit pass type="submit" explicitly.
  type = "button",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  full?: boolean;
}) {
  return (
    <button
      type={type}
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium",
        "transition-colors active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100",
        VARIANTS[variant],
        SIZES[size],
        full && "w-full",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export function Page({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={cx(
        "animate-rise mx-auto w-full max-w-5xl px-4 pt-6 pb-10 sm:px-6 lg:px-8 lg:pt-10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-muted">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}

export function Card({
  children,
  className,
  as: Tag = "section",
}: PropsWithChildren<{ className?: string; as?: "section" | "div" | "article" }>) {
  return (
    <Tag className={cx("rounded-2xl border border-line bg-surface", className)}>{children}</Tag>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                    */
/* -------------------------------------------------------------------------- */

const ALERT_TONES = {
  error: "border-danger/30 bg-danger-soft text-danger",
  warn: "border-warn/30 bg-warn-soft text-warn",
  success: "border-ok/30 bg-ok-soft text-ok",
  info: "border-line bg-muted text-ink-muted",
} as const;

export function Alert({
  tone = "info",
  className,
  children,
}: PropsWithChildren<{ tone?: keyof typeof ALERT_TONES; className?: string }>) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cx(
        "rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed",
        ALERT_TONES[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-xl bg-brand-soft text-brand">
        {icon}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm leading-relaxed text-ink-muted">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const BADGE_TONES = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  info: "bg-brand-soft text-brand",
  neutral: "bg-muted text-ink-muted",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: PropsWithChildren<{ tone?: keyof typeof BADGE_TONES }>) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Data display                                                                */
/* -------------------------------------------------------------------------- */

export function FoodImage({
  alt,
  className,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);

  if (failed || !props.src) {
    return (
      <div
        role="img"
        aria-label={`${alt || "Food"} image unavailable`}
        className={cx("grid place-items-center bg-muted text-ink-faint", className)}
      >
        <ImageOff size={20} />
      </div>
    );
  }

  return (
    <img
      {...props}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function MacroBar({
  label,
  value,
  target,
  colour,
}: {
  label: string;
  value: number;
  target: number;
  colour: string;
}) {
  const percent = Math.min(100, Math.max(0, (value / Math.max(target, 1)) * 100));
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
        <span className="text-ink-muted">{label}</span>
        <span className="font-medium">
          {Math.round(value)}
          <span className="text-ink-faint"> / {target}g</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${percent}%`, background: colour }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl border border-line bg-muted p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition-colors",
              active ? "bg-surface text-ink shadow-xs" : "text-ink-muted hover:text-ink",
            )}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: PropsWithChildren<{ active: boolean; onClick: () => void }>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "min-h-9 shrink-0 rounded-full border px-3 text-xs font-medium capitalize transition-colors",
        active
          ? "border-brand bg-brand-soft text-brand"
          : "border-line bg-surface text-ink-muted hover:border-brand/40",
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  danger = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }) {
  return (
    <button
      {...props}
      aria-label={label}
      className={cx(
        "grid size-10 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors",
        danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-muted hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <label className="grid gap-1.5">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Sheet                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A bottom sheet rather than a centred dialog: on a phone it is reachable with
 * a thumb, and on a desktop it still reads as one focused task.
 */
export function Sheet({
  title,
  description,
  onClose,
  footer,
  children,
}: PropsWithChildren<{
  title: string;
  description?: string;
  onClose: () => void;
  footer?: ReactNode;
}>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Rendered into <body>, not into the page. Inside the page it competed with
  // the fixed bottom navigation and the footer buttons ended up underneath it.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="animate-fade-in fixed inset-0 z-200 flex items-end justify-center bg-olive-deep/60 backdrop-blur-[2px] sm:items-center sm:p-6"
    >
      <div className="animate-sheet flex max-h-[92svh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-line bg-surface sm:max-h-[86svh] sm:rounded-3xl">
        <div className="relative shrink-0 border-b border-line-soft px-5 pb-4 pt-4">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line sm:hidden" aria-hidden="true" />
          <h2 className="pr-10 text-lg font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-1 pr-10 text-[13px] leading-relaxed text-ink-muted">{description}</p>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 grid size-10 place-items-center rounded-lg text-ink-muted hover:bg-muted"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">{children}</div>

        {footer && (
          <div className="grid shrink-0 gap-2.5 border-t border-line-soft bg-muted/60 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/* Loading skeletons                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A skeleton says "this is loading and here is roughly what will appear".
 * A spinner says "something is happening somewhere". The first is calmer, so
 * it is the default everywhere a layout is predictable.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("animate-pulse rounded-md bg-muted", className)} />;
}

export function SkeletonBlock({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cx("grid gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cx("h-3", index === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Mirrors the shape of a FoodRow so the list does not jump when data lands. */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading results"
      className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-3 sm:px-4">
          <Skeleton className="size-12 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 grid gap-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <div className="grid shrink-0 justify-items-end gap-2">
            <Skeleton className="h-3.5 w-12" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 6, height = "h-64" }: { count?: number; height?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-line bg-surface">
          <Skeleton className={cx("w-full rounded-none", height === "h-64" ? "h-40" : height)} />
          <div className="grid gap-2.5 p-4">
            <Skeleton className="h-2.5 w-1/3" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Typewriter                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Reveals text at roughly 900 characters per second — quick enough that a fast
 * reader never waits, slow enough that the answer feels like it is being
 * written rather than pasted. Honours reduced-motion by showing it instantly.
 */
export function useTypewriter(text: string, enabled: boolean): string {
  const [shown, setShown] = useState(() => (enabled ? "" : text));
  const frame = useRef(0);

  useEffect(() => {
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!enabled || reduced || !text) {
      setShown(text);
      return;
    }

    setShown("");
    let start: number | null = null;
    const charactersPerMs = 0.9;

    const step = (timestamp: number) => {
      start ??= timestamp;
      const count = Math.floor((timestamp - start) * charactersPerMs);

      if (count >= text.length) {
        setShown(text);
        return;
      }
      setShown(text.slice(0, count));
      frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [text, enabled]);

  return shown;
}

/* -------------------------------------------------------------------------- */
/* Collapsible section                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A titled section that opens on demand. Settings is a long list of things a
 * user touches rarely; showing all of it at once buries the two or three
 * controls anyone actually came for.
 */
export function CollapsibleCard({
  icon,
  title,
  description,
  defaultOpen = false,
  danger = false,
  children,
}: PropsWithChildren<{
  icon: ReactNode;
  title: string;
  description: string;
  defaultOpen?: boolean;
  danger?: boolean;
}>) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card className={cx("overflow-hidden", danger && "border-danger/30")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50 sm:p-5"
      >
        <span
          className={cx(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            danger ? "bg-danger-soft text-danger" : "bg-brand-soft text-brand",
          )}
        >
          {icon}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-tight">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-muted">
            {description}
          </span>
        </span>

        <ChevronDown
          size={18}
          aria-hidden="true"
          className={cx(
            "shrink-0 text-ink-faint transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="animate-rise border-t border-line-soft p-4 sm:p-5">{children}</div>
      )}
    </Card>
  );
}
