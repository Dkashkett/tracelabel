import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "outline" | "muted" | "pass" | "warn" | "fail";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants: Record<string, string> = {
    default: "bg-accent text-accent-fg",
    outline: "border border-line-strong bg-surface-inset/30 text-ink-muted",
    muted: "border border-line bg-surface-raised text-ink-muted",
    pass: "border border-pass/25 bg-pass/10 text-pass",
    warn: "border border-warn/25 bg-warn/10 text-warn",
    fail: "border border-fail/25 bg-fail/10 text-fail",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-transparent px-2.5 py-1 text-[11px] font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
