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
      <div className="p-6 text-sm text-ink-muted">
        No labelable target on this trace — press{" "}
        <kbd className="rounded bg-surface-raised px-1.5 py-0.5 text-xs font-semibold">n</kbd> for
        the next trace.
      </div>
    );
  }

  const existing = trace.annotations[activeTarget.id];
  const isReview = session.mode === "review";
  const judge = trace.review_of?.[activeTarget.id];
  const showSuggestion = !isReview && !existing && !!state.prefillModel;
  const savedStatus = commitPending ? "saving" : existing ? "saved" : "idle";
  const targetLabel =
    activeTarget.type === "trace" ? "trace" : `turn #${activeTarget.turnIdx}`;
  const missingRequired = Object.keys(validateDraft(session.fields, state.draft));
  const canCommit = missingRequired.length === 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-5 text-ink">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          {targetLabel}
        </span>
        {isReview ? (
          <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent-strong">
            {existing ? "reviewed" : `reviewing ${session.review_of}`}
          </span>
        ) : (
          showSuggestion && (
            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent-strong">
              ✦ suggested by {state.prefillModel}
            </span>
          )
        )}
      </div>

      {isReview && judge && (
        <div className="mb-5 rounded-xl border border-accent/20 bg-accent/5 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-accent-strong">
            {session.review_of} predicted
          </div>
          <dl className="space-y-1 text-sm">
            {session.fields.map((f) => {
              const v = judge.values[f.name];
              if (v === undefined || (Array.isArray(v) && v.length === 0)) return null;
              return (
                <div key={f.name} className="flex gap-2">
                  <dt className="shrink-0 text-ink-muted">{f.label}:</dt>
                  <dd className="min-w-0 font-medium">{Array.isArray(v) ? v.join(", ") : v}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      <div className="flex-1 space-y-6">
        {session.fields.map((f) => (
          <div key={f.name}>
            <label className="mb-2 flex items-baseline gap-1 text-sm font-semibold text-ink">
              {f.label}
              {f.required && <span className="text-fail">*</span>}
            </label>
            {f.help && <p className="mb-2 text-xs text-ink-faint">{f.help}</p>}
            <FieldRenderer
              field={f}
              value={state.draft[f.name]}
              setValue={(v) => ctl.setField(f.name, v)}
              toggle={(opt) => ctl.toggleMulti(f.name, opt)}
            />
            {errors[f.name] && <p className="mt-1.5 text-xs font-medium text-fail">{errors[f.name]}</p>}
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => ctl.commit()}
            aria-disabled={!canCommit}
            title={canCommit ? undefined : "Fill in the required fields to continue"}
            className={cn(
              "inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-semibold shadow-sm transition-all",
              canCommit
                ? "bg-accent text-accent-fg hover:bg-accent-strong"
                : "cursor-not-allowed bg-surface-raised text-ink-faint shadow-none",
            )}
          >
            {isReview ? "Enter · approve ▸ next" : "Enter · commit ▸ next"}
          </button>
          <button
            type="button"
            onClick={() => ctl.skip()}
            className="inline-flex items-center rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink-muted transition-colors hover:border-line-strong hover:bg-surface-raised"
          >
            s · skip
          </button>
          <button
            type="button"
            onClick={() => ctl.clearDraft()}
            className="text-xs text-ink-faint transition-colors hover:text-ink-muted"
          >
            clear
          </button>
          <span className="ml-auto">
            <SavedDot status={savedStatus} />
          </span>
        </div>
      </div>
    </div>
  );
}
