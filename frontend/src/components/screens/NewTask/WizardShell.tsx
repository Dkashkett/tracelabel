import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, ArrowRightIcon, SparklesIcon } from "@/components/ui/icons";
import { Notice, PageFrame, PageHeader, SectionCard } from "@/components/ui/layout";
import { Stepper } from "@/components/ui/stepper";

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
  const frameRef = useRef<HTMLElement>(null);

  useEffect(() => {
    frameRef.current?.scrollIntoView?.({ block: "start" });
  }, [step]);

  return (
    <PageFrame ref={frameRef} width={wide ? "wide" : "default"}>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <SparklesIcon className="h-3.5 w-3.5" />
            New task
          </span>
        }
        title={stepLabels[step]}
        description={subtitle}
      />

      <Stepper
        steps={stepLabels}
        current={step}
        onStepClick={onStepClick}
        className="mt-8"
      />

      <SectionCard className="mt-8 overflow-hidden">
        <div className={cn("min-h-[23rem] p-5 sm:p-7", wide && "lg:p-8")}>{children}</div>

        {error && (
          <div className="px-5 pb-5 sm:px-7">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-line bg-surface-inset/30 px-5 py-4 sm:px-7">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={onBack}>
                <ArrowLeftIcon className="h-4 w-4" />
                Back
              </Button>
            )}
            <Button onClick={onNext} disabled={isLastStep && isSubmitting}>
              {isLastStep ? (
                isSubmitting ? (
                  "Creating…"
                ) : (
                  submitLabel
                )
              ) : (
                <>
                  Continue
                  <ArrowRightIcon className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </footer>
      </SectionCard>
    </PageFrame>
  );
}
