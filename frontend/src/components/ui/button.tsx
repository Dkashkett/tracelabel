import * as React from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "default" | "lg" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variants: Record<ButtonVariant, string> = {
  default:
    "border border-accent bg-accent text-accent-fg shadow-sm shadow-black/20 hover:border-accent-strong hover:bg-accent-strong",
  secondary:
    "border border-line-strong bg-surface-overlay text-ink shadow-sm hover:border-ink-faint hover:bg-surface-overlay/80",
  outline:
    "border border-line-strong bg-transparent text-ink-muted hover:border-ink-faint hover:bg-surface-raised hover:text-ink",
  ghost:
    "border border-transparent bg-transparent text-ink-muted hover:bg-surface-raised hover:text-ink",
  destructive:
    "border border-fail/40 bg-fail/10 text-fail hover:border-fail/60 hover:bg-fail/15",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-8 rounded-md px-2.5 py-1.5 text-xs",
  default: "min-h-10 rounded-lg px-3.5 py-2 text-sm",
  lg: "min-h-11 rounded-lg px-4 py-2.5 text-sm",
  icon: "h-9 w-9 rounded-lg p-0",
};

export function buttonClassName({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 font-medium transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-45",
    variants[variant],
    sizes[size],
    className,
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={buttonClassName({ variant, size, className })}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
