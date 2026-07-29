import { ArrowRightIcon, SparklesIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useController } from "@/state/NavContext";
import { validateDraft } from "@/state/navReducer";
import { FieldRenderer } from "./FieldRenderer";
import { SavedDot } from "./SavedDot";

export function AnnotationPane() {
  const ctl = useController();
  const { session, trace, state, errors, activeTarget, commitPending } = ctl;

  if (!activeTarget) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-xs">
          <p className="text-sm font-medium text-ink">No labelable target</p>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            This trace has no target matching the task configuration. Press{" "}
            <kbd className="rounded-md border border-line-strong bg-surface-inset px-1.5 py-0.5 font-mono text-[10px] text-ink">
              n
            </kbd>{" "}
            for the next trace.
          </p>
        </div>
      </div>
    );
  }

  const existing = trace.annotations[activeTarget.id];
  const isReview = session.mode === "review";
  const judge = trace.review_of?.[activeTarget.id];
  const showSuggestion = !isReview && !existing && !!state.prefillModel;
  const savedStatus = commitPending ? "saving" : existing ? "saved" : "idle";
  const targetLabel = activeTarget.type === "trace" ? "Trace label" : `Turn #${activeTarget.turnIdx}`;
  const missingRequired = Object.keys(validateDraft(session.fields, state.draft));
  const canCommit = missingRequired.length === 0;

  return (
    <div className="flex h-full flex-col overflow-hidden text-ink">
      <div className="shrink-0 border-b border-line bg-surface px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.17em] text-accent-strong">
              Annotation
            </p>
            <h2 className="mt-1 text-base font-semibold tracking-tight text-ink">
              {targetLabel}
            </h2>
          </div>
          {isReview ? (
            <span className="rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent-strong">
              {existing ? "Reviewed" : `Reviewing ${session.review_of}`}
            </span>
          ) : (
            showSuggestion && (
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent-strong">
                <SparklesIcon className="h-3 w-3" />
                {state.prefillModel}
              </span>
            )
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {isReview && judge && (
          <div className="mb-6 rounded-xl border border-accent/25 bg-accent/[0.06] p-4">
            <div className="mb-3 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-strong">
              <SparklesIcon className="h-3.5 w-3.5" />
              {session.review_of} predicted
            </div>
            <dl className="space-y-2 text-sm">
              {session.fields.map((field) => {
                const value = judge.values[field.name];
                if (value === undefined || (Array.isArray(value) && value.length === 0)) {
                  return null;
                }
                return (
                  <div key={field.name}>
                    <dt className="text-xs text-ink-muted">{field.label}</dt>
                    <dd className="mt-0.5 font-medium text-ink">
                      {Array.isArray(value) ? value.join(", ") : value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}

        <div className="space-y-7">
          {session.fields.map((field, index) => (
            <section key={field.name}>
              <div className="mb-2.5 flex items-baseline gap-2">
                <span className="font-mono text-[9px] text-ink-faint">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <label className="text-sm font-semibold text-ink">
                  {field.label}
                  {field.required && (
                    <>
                      <span className="ml-1 text-fail">*</span>
                      <span className="sr-only"> required</span>
                    </>
                  )}
                </label>
              </div>
              {field.help && <p className="mb-2.5 pl-7 text-xs leading-5 text-ink-muted">{field.help}</p>}
              <div className="pl-7">
                <FieldRenderer
                  field={field}
                  value={state.draft[field.name]}
                  setValue={(value) => ctl.setField(field.name, value)}
                  toggle={(option) => ctl.toggleMulti(field.name, option)}
                />
                {errors[field.name] && (
                  <p className="mt-2 text-xs font-medium text-fail">{errors[field.name]}</p>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>

      <footer className="shrink-0 border-t border-line bg-surface/95 px-5 py-4 shadow-[0_-18px_45px_-32px_rgb(0_0_0/0.9)] backdrop-blur">
        {!canCommit && (
          <p className="mb-2.5 text-[11px] text-ink-faint">
            Complete {missingRequired.length} required{" "}
            {missingRequired.length === 1 ? "field" : "fields"} to continue.
          </p>
        )}
        <button
          type="button"
          onClick={() => ctl.commit()}
          aria-disabled={!canCommit}
          title={canCommit ? undefined : "Fill in the required fields to continue"}
          className={cn(
            "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-semibold outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent/60",
            canCommit
              ? "border-accent bg-accent text-accent-fg shadow-glow hover:bg-accent-strong"
              : "border-line-strong bg-surface-raised text-ink-faint",
          )}
        >
          <span>{isReview ? "Approve and continue" : "Commit and continue"}</span>
          <span className="inline-flex items-center gap-2">
            <kbd
              className={cn(
                "rounded-md border px-1.5 py-0.5 font-mono text-[9px]",
                canCommit
                  ? "border-accent-fg/20 bg-accent-fg/10"
                  : "border-line bg-surface-inset",
              )}
            >
              Enter
            </kbd>
            <ArrowRightIcon className="h-4 w-4" />
          </span>
        </button>
        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => ctl.skip()}
            className="rounded-lg px-2.5 py-2 text-xs font-medium text-ink-muted outline-none transition-colors hover:bg-surface-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <kbd className="mr-1 font-mono text-[10px] text-ink-faint">s</kbd>
            Skip
          </button>
          <button
            type="button"
            onClick={() => ctl.clearDraft()}
            className="rounded-lg px-2.5 py-2 text-xs text-ink-faint outline-none transition-colors hover:bg-surface-raised hover:text-ink-muted focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Clear
          </button>
          <span className="ml-auto">
            <SavedDot status={savedStatus} />
          </span>
        </div>
      </footer>
    </div>
  );
}
