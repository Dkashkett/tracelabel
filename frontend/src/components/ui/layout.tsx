import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InfoIcon } from "./icons";

export const PageFrame = forwardRef<HTMLElement, {
  children: ReactNode;
  width?: "narrow" | "default" | "wide" | "full";
  className?: string;
}>(function PageFrame({
  children,
  width = "wide",
  className,
}, ref) {
  const widths = {
    narrow: "max-w-2xl",
    default: "max-w-4xl",
    wide: "max-w-6xl",
    full: "max-w-none",
  };
  return (
    <main ref={ref} className="relative min-h-full overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_72%_0%,rgb(var(--accent)/0.055),transparent_48%)]" />
      <div
        className={cn(
          "relative mx-auto w-full px-5 py-8 sm:px-8 sm:py-10 lg:px-10",
          widths[width],
          className,
        )}
      >
        {children}
      </div>
    </main>
  );
});

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-5", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-accent-strong">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-ink sm:text-[1.75rem]">
          {title}
        </h1>
        {description && (
          <div className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{description}</div>
        )}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionCard({
  children,
  className,
  inset = false,
}: {
  children: ReactNode;
  className?: string;
  inset?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-line-strong/70 shadow-panel",
        inset ? "bg-surface-inset/75" : "bg-surface/90",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            {eyebrow}
          </p>
        )}
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-1 text-sm leading-6 text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-64 place-items-center rounded-2xl border border-dashed border-line-strong bg-surface/45 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="max-w-sm">
        {icon && (
          <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl border border-line-strong bg-surface-raised text-ink-muted">
            {icon}
          </div>
        )}
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{description}</p>
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

export function Notice({
  children,
  title,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  title?: ReactNode;
  tone?: "neutral" | "accent" | "warning" | "danger";
  className?: string;
}) {
  const tones = {
    neutral: "border-line-strong bg-surface-inset/65 text-ink-muted",
    accent: "border-accent/30 bg-accent/[0.07] text-ink-muted",
    warning: "border-warn/30 bg-warn/[0.07] text-ink-muted",
    danger: "border-fail/30 bg-fail/[0.07] text-ink-muted",
  };
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4 text-sm leading-6", tones[tone], className)}>
      <InfoIcon className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "danger" ? "text-fail" : "text-ink-faint")} />
      <div>
        {title && <p className="font-medium text-ink">{title}</p>}
        <div className={title ? "mt-0.5" : undefined}>{children}</div>
      </div>
    </div>
  );
}
