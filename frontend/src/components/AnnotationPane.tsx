import { useController } from "@/state/NavContext";
import { FieldRenderer } from "./FieldRenderer";
import { SavedDot } from "./SavedDot";

export function AnnotationPane() {
  const ctl = useController();
  const { session, trace, state, errors, activeTarget, commitPending } = ctl;

  if (!activeTarget) {
    return (
      <div className="p-4 text-sm text-slate-500">
        No labelable target on this trace — press <kbd>n</kbd> for the next trace.
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

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          target: {targetLabel}
        </span>
        {isReview ? (
          <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
            {existing ? "reviewed" : `reviewing ${session.review_of}`}
          </span>
        ) : (
          showSuggestion && (
            <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300">
              ✦ suggested by {state.prefillModel}
            </span>
          )
        )}
      </div>

      {isReview && judge && (
        <div className="mb-4 rounded-md border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900/50 dark:bg-indigo-900/20">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-300">
            {session.review_of} predicted
          </div>
          <dl className="space-y-1 text-sm">
            {session.fields.map((f) => {
              const v = judge.values[f.name];
              if (v === undefined || (Array.isArray(v) && v.length === 0)) return null;
              return (
                <div key={f.name} className="flex gap-2">
                  <dt className="shrink-0 text-slate-500 dark:text-slate-400">{f.label}:</dt>
                  <dd className="min-w-0 font-medium">{Array.isArray(v) ? v.join(", ") : v}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      )}

      <div className="flex-1 space-y-4">
        {session.fields.map((f) => (
          <div key={f.name}>
            <label className="mb-1 flex items-baseline gap-1 text-sm font-medium">
              {f.label}
              {f.required && <span className="text-red-500">*</span>}
            </label>
            {f.help && <p className="mb-1.5 text-xs text-slate-400">{f.help}</p>}
            <FieldRenderer
              field={f}
              value={state.draft[f.name]}
              setValue={(v) => ctl.setField(f.name, v)}
              toggle={(opt) => ctl.toggleMulti(f.name, opt)}
            />
            {errors[f.name] && <p className="mt-1 text-xs text-red-500">{errors[f.name]}</p>}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
        <button
          type="button"
          onClick={() => ctl.commit()}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
        >
          {isReview ? "Enter · approve ▸ next" : "Enter · commit ▸ next"}
        </button>
        <button
          type="button"
          onClick={() => ctl.skip()}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          s · skip
        </button>
        <button
          type="button"
          onClick={() => ctl.clearDraft()}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          clear
        </button>
        <span className="ml-auto">
          <SavedDot status={savedStatus} />
        </span>
      </div>
    </div>
  );
}
