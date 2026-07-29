import * as React from "react";
import { cn } from "@/lib/utils";

export interface RadioCardProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> {
  checked: boolean;
  onSelect: () => void;
}

// A selectable card. Same button[role="radio"] pattern as FieldRenderer's OptionRow,
// rather than a native <input type="radio"> — keeps card content (diagrams, multi-line
// copy) free of the hidden-input layout quirks a real radio input brings along.
export const RadioCard = React.forwardRef<HTMLButtonElement, RadioCardProps>(
  ({ className, children, checked, onSelect, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onSelect}
        className={cn(
          "block w-full cursor-pointer rounded-xl border p-4 text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
          checked
            ? "border-accent bg-accent/5 ring-1 ring-accent/30"
            : "border-line bg-surface-raised hover:border-line-strong",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
RadioCard.displayName = "RadioCard";
