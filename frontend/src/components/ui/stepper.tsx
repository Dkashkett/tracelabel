import { CheckIcon } from "./icons";
import { cn } from "@/lib/utils";

export function Stepper({
  steps,
  current,
  onStepClick,
  className,
}: {
  steps: readonly string[];
  current: number;
  onStepClick?: (step: number) => void;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-center", className)} aria-label="Progress">
      {steps.map((label, index) => {
        const complete = index < current;
        const active = index === current;
        const canNavigate = complete && Boolean(onStepClick);
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center last:flex-none">
            <button
              type="button"
              disabled={!canNavigate}
              onClick={() => onStepClick?.(index)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "group flex min-w-0 items-center gap-2 rounded-full text-xs font-medium outline-none",
                canNavigate && "cursor-pointer text-ink-muted hover:text-ink",
                active && "text-ink",
                !complete && !active && "cursor-default text-ink-faint",
              )}
            >
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold tabular-nums transition-all",
                  complete && "border-accent bg-accent text-accent-fg",
                  active && "border-accent bg-accent/10 text-accent-strong shadow-glow",
                  !complete && !active && "border-line-strong bg-surface-raised text-ink-faint",
                )}
              >
                {complete ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="hidden truncate sm:inline">{label}</span>
            </button>
            {index < steps.length - 1 && (
              <span
                className={cn("mx-2 h-px flex-1 sm:mx-3", complete ? "bg-accent" : "bg-line")}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
