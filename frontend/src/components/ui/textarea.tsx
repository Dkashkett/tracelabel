import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[88px] w-full rounded-lg border border-line-strong bg-surface-inset/55 px-3 py-2.5 text-sm leading-6 text-ink shadow-inner shadow-black/10 outline-none transition-all placeholder:text-ink-faint hover:border-ink-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
