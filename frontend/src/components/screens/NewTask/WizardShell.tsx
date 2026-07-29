import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface WizardShellProps {
  step: number;
  stepLabels: string[];
  subtitle: string;
  wide?: boolean;
  error?: string | null;
  onStepClick: (index: number) => void;
  onCancel: () => void;
  onBack: () => void;
  onNext: () => void;
  isLastStep: boolean;
  isSubmitting?: boolean;
  submitLabel?: string;
  children: React.ReactNode;
}

// Chrome shared by every New Task step: title, clickable stepper, a fixed-height body
// slot (so the footer doesn't jump between steps), and the Cancel/Back/Next footer.
export function WizardShell({
  step,
  stepLabels,
  subtitle,
  wide,
  error,
  onStepClick,
  onCancel,
  onBack,
  onNext,
  isLastStep,
  isSubmitting,
  submitLabel = "Create task",
  children,
}: WizardShellProps) {
  return (
    <div className={cn("mx-auto p-8", wide ? "max-w-6xl" : "max-w-3xl")}>
      <h1 className="text-lg font-semibold text-ink">New task</h1>
      <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>

      <ol className="mt-6 flex items-center">
        {stepLabels.map((label, index) => {
          const isDone = index < step;
          const isCurrent = index === step;
          const clickable = isDone;
          return (
            <li key={label} className="flex flex-1 items-center last:flex-none">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => onStepClick(index)}
                className={cn(
                  "flex items-center gap-2 rounded-full text-xs font-medium transition-colors",
                  clickable ? "cursor-pointer" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums transition-colors",
                    isDone && "bg-accent text-accent-fg",
                    isCurrent && "border border-accent text-accent-strong",
                    !isDone && !isCurrent && "bg-surface-raised text-ink-faint",
                  )}
                >
                  {isDone ? "✓" : index + 1}
                </span>
                <span className={isCurrent ? "font-semibold text-ink" : "text-ink-faint"}>
                  {label}
                </span>
              </button>
              {index < stepLabels.length - 1 && (
                <span
                  className={cn("mx-3 h-px flex-1", isDone ? "bg-accent" : "bg-line")}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-6 min-h-[26rem]">{children}</div>

      {error && <p className="mt-3 text-xs text-fail">{error}</p>}

      <div className="mt-8 flex items-center justify-between border-t border-line pt-5">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <div className="flex gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
          )}
          {!isLastStep ? (
            <Button onClick={onNext}>Next</Button>
          ) : (
            <Button onClick={onNext} disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : submitLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
