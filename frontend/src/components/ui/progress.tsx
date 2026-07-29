import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

export function Progress({ className, value = 0, ...props }: ProgressProps) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(100, Math.max(0, value)))}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-surface-inset ring-1 ring-inset ring-line/70",
        className,
      )}
      {...props}
    >
      <div
        className="h-full rounded-full bg-accent shadow-[0_0_12px_rgb(var(--accent-glow)/0.35)] transition-all duration-300"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
