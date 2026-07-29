import { ChevronDownIcon, ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useController } from "@/state/NavContext";
import type { QueueEntry } from "@/api/types";

function statusOf(entry: QueueEntry): { label: string; dotClass: string } {
  const addressed = entry.n_labeled + entry.n_skipped;
  if (addressed === 0) return { label: "todo", dotClass: "bg-ink-faint" };
  if (addressed < entry.n_targets) return { label: "partial", dotClass: "bg-warn" };
  if (entry.n_labeled === 0) return { label: "skipped", dotClass: "bg-ink-faint" };
  return { label: "done", dotClass: "bg-pass" };
}

export function TraceDrawer() {
  const {
    queue,
    state,
    goToTrace,
    drawerOpen,
    setDrawerOpen,
    completionCounts,
  } = useController();
  const addressed = completionCounts.labeled + completionCounts.skipped;

  return (
    <div className="relative z-20 shrink-0 border-t border-line bg-surface/95 shadow-[0_-12px_35px_-30px_rgb(0_0_0/0.9)] backdrop-blur">
      <button
        type="button"
        onClick={() => setDrawerOpen(!drawerOpen)}
        aria-expanded={drawerOpen}
        className="flex h-10 w-full items-center gap-2 px-4 text-left outline-none transition-colors hover:bg-surface-raised/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
      >
        {drawerOpen ? (
          <ChevronDownIcon className="h-3.5 w-3.5 text-ink-faint" />
        ) : (
          <ChevronRightIcon className="h-3.5 w-3.5 text-ink-faint" />
        )}
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-muted">
          Traces
        </span>
        <span className="rounded-full border border-line bg-surface-inset px-2 py-0.5 font-mono text-[9px] text-ink-faint">
          {queue.length}
        </span>
        <span className="ml-auto font-mono text-[10px] text-ink-faint">
          {addressed}/{completionCounts.total} targets addressed
        </span>
      </button>
      {drawerOpen && (
        <div className="max-h-52 overflow-y-auto border-t border-line bg-surface-inset/35 px-4 py-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-1.5">
            {queue.map((entry, index) => {
              const status = statusOf(entry);
              const current = index === state.traceIdx;
              return (
                <button
                  key={entry.trace_id}
                  type="button"
                  title={`${entry.trace_id} — ${status.label} (${
                    entry.n_labeled + entry.n_skipped
                  }/${entry.n_targets})`}
                  onClick={() => goToTrace(index)}
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/60",
                    current
                      ? "border-accent/50 bg-accent/10 text-ink"
                      : "border-transparent text-ink-muted hover:border-line hover:bg-surface-raised",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status.dotClass)} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                    {entry.trace_id}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-ink-faint">
                    {entry.n_labeled + entry.n_skipped}/{entry.n_targets}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
