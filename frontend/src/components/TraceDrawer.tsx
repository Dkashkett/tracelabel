import { cn } from "@/lib/utils";
import { useController } from "@/state/NavContext";
import type { QueueEntry } from "@/api/types";

function statusOf(e: QueueEntry): { glyph: string; label: string; className: string } {
  const addressed = e.n_labeled + e.n_skipped;
  if (addressed === 0) return { glyph: "○", label: "todo", className: "text-slate-400" };
  if (addressed < e.n_targets)
    return { glyph: "◐", label: "partial", className: "text-amber-500" };
  if (e.n_labeled === 0) return { glyph: "⊘", label: "skipped", className: "text-slate-400" };
  return { glyph: "●", label: "done", className: "text-green-600" };
}

export function TraceDrawer() {
  const { queue, state, goToTrace, drawerOpen, setDrawerOpen } = useController();

  return (
    <div className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button
        type="button"
        onClick={() => setDrawerOpen(!drawerOpen)}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-400"
      >
        <span>{drawerOpen ? "▾" : "▸"}</span>
        traces ({queue.length})
      </button>
      {drawerOpen && (
        <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto px-4 pb-2">
          {queue.map((e, i) => {
            const s = statusOf(e);
            const current = i === state.traceIdx;
            return (
              <button
                key={e.trace_id}
                type="button"
                title={`${e.trace_id} — ${s.label} (${e.n_labeled + e.n_skipped}/${e.n_targets})`}
                onClick={() => goToTrace(i)}
                className={cn(
                  "flex items-center gap-1 rounded border px-2 py-1 text-xs",
                  current
                    ? "border-sky-500 bg-sky-50 dark:bg-sky-900/30"
                    : "border-transparent hover:bg-slate-100 dark:hover:bg-slate-800",
                )}
              >
                <span className={s.className}>{s.glyph}</span>
                <span className="max-w-[8rem] truncate text-slate-600 dark:text-slate-300">
                  {e.trace_id}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
