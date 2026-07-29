import { Button } from "@/components/ui/button";
import type { SourceOut } from "@/api/types";

export interface SourcesStepProps {
  sources: SourceOut[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  selectedTraceCount: number;
}

export function SourcesStep({
  sources,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  selectedTraceCount,
}: SourcesStepProps) {
  if (sources.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6">
        <p className="text-sm text-ink-muted">
          No sources imported yet — this task will start with an empty queue until you add
          one.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-6">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ink-muted">Sources</p>
        <div className="flex gap-1">
          <Button variant="ghost" onClick={onSelectAll}>
            Select all
          </Button>
          <Button variant="ghost" onClick={onSelectNone}>
            Select none
          </Button>
        </div>
      </div>

      <fieldset className="mt-2 flex flex-col gap-2">
        {sources.map((source) => (
          <label
            key={source.id}
            className="flex items-center gap-3 rounded-lg border border-line bg-surface-raised px-3 py-2.5 text-sm text-ink transition-colors hover:border-line-strong"
          >
            <input
              type="checkbox"
              checked={selected.has(source.id)}
              onChange={() => onToggle(source.id)}
            />
            <span className="min-w-0 flex-1 truncate">
              {source.name} · {source.trace_count} traces
            </span>
            <span className="shrink-0 rounded-full bg-surface-inset px-2 py-0.5 text-[11px] uppercase tracking-wider text-ink-faint">
              {source.adapter}
            </span>
          </label>
        ))}
      </fieldset>

      <p className="mt-3 text-xs text-ink-faint">
        This task will label {selectedTraceCount} {selectedTraceCount === 1 ? "trace" : "traces"}.
      </p>
    </div>
  );
}
