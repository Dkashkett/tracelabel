import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "default";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, size = "default", ...props }, ref) => {
    const sizes: Record<string, string> = {
      default: "px-3 py-2 text-sm",
      sm: "px-2 py-1 text-sm",
    };
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-lg border border-line-strong bg-surface-inset/55 text-ink shadow-inner shadow-black/10 outline-none transition-all placeholder:text-ink-faint hover:border-ink-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-50",
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
