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
          "w-full rounded-lg border border-line bg-transparent text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/50",
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
