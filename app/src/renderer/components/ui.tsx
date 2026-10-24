/** Small building blocks styled like Seleya's shadcn components (base-nova, Seleya tokens). */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

const BUTTON_VARIANTS = {
  primary: "bg-primary text-primary-foreground shadow-soft hover:bg-primary/90",
  outline: "border border-input bg-card text-foreground hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
} as const;

const BUTTON_SIZES = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-sm",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  icon: "size-8 rounded-lg",
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}

export function Button({ variant = "outline", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "no-drag inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors duration-150",
        "focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

interface CardProps {
  id: string;
  title?: string;
  /** Right side of the title row. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Card({ id, title, action, className, children }: CardProps) {
  return (
    <section
      id={id}
      aria-label={title}
      className={cn("rounded-2xl border bg-card p-4 shadow-soft", className)}
    >
      {(title || action) && (
        <div className="mb-3 flex min-h-8 items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = "success" | "primary" | "warning" | "muted" | "destructive";

const DOT_TONES: Record<Tone, string> = {
  success: "bg-success",
  primary: "bg-primary",
  warning: "bg-warning",
  muted: "bg-muted-foreground/60",
  destructive: "bg-destructive",
};

const PILL_TONES: Record<Tone, string> = {
  success: "bg-success/10 text-success",
  primary: "bg-primary/10 text-primary",
  warning: "bg-warning/10 text-warning",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
};

export const Dot = ({ tone, className }: { tone: Tone; className?: string }) => (
  <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", DOT_TONES[tone], className)} />
);

export const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className={cn("inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-xs font-medium", PILL_TONES[tone])}>
    <Dot tone={tone} />
    {children}
  </span>
);

interface SwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}

export function Switch({ id, checked, onChange, label, description }: SwitchProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "no-drag relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200",
          "focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-5 rounded-full bg-white shadow-soft transition-transform duration-200",
            checked ? "translate-x-[1.125rem]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

export const inputClass = cn(
  "h-10 w-full min-w-0 rounded-xl border border-input bg-card px-3 text-sm transition-colors duration-150",
  "placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
  "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
);

/** "3 days ago", "just now". */
export function relativeTime(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return "just now";
}

export const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};
