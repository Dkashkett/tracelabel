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
      <div className="rounded-xl border border-line bg-surface-inset/45 p-6">
        <p className="text-sm text-ink-muted">
          No sources imported yet — this task will start with an empty queue until you add
          one.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">Available sources</p>
          <p className="mt-1 text-xs text-ink-muted">Choose the data included in this task.</p>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onSelectAll}>
            Select all
          </Button>
          <Button size="sm" variant="ghost" onClick={onSelectNone}>
            Select none
          </Button>
        </div>
      </div>

      <fieldset className="mt-5 flex flex-col gap-2">
        {sources.map((source) => (
          <label
            key={source.id}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-line-strong bg-surface-raised/75 px-4 py-3 text-sm text-ink transition-all hover:border-accent/35 hover:bg-surface-raised"
          >
            <input
              type="checkbox"
              checked={selected.has(source.id)}
              onChange={() => onToggle(source.id)}
            />
            <span className="min-w-0 flex-1 truncate">
              {source.name} · {source.trace_count} traces
            </span>
            <span className="shrink-0 rounded-full border border-line bg-surface-inset px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              {source.adapter}
            </span>
          </label>
        ))}
      </fieldset>

      <p className="mt-4 font-mono text-xs text-ink-muted">
        This task will label {selectedTraceCount} {selectedTraceCount === 1 ? "trace" : "traces"}.
      </p>
    </div>
  );
}
