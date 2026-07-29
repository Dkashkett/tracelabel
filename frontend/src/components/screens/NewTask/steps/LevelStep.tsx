import { RadioCard } from "@/components/ui/radio-card";
import type { Level } from "@/api/types";
import { LevelDiagram } from "./LevelDiagram";

export interface LevelStepProps {
  level: Level;
  onChange: (level: Level) => void;
  selectedTraceCount: number;
}

export function LevelStep({ level, onChange, selectedTraceCount }: LevelStepProps) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-muted">Level</p>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <RadioCard checked={level === "trace"} onSelect={() => onChange("trace")}>
          <p className="mb-3 text-sm font-semibold text-ink">Trace level</p>
          <LevelDiagram level="trace" selected={level === "trace"} />
          <p className="mt-3 text-sm text-ink-muted">One label per trace</p>
          <p className="text-xs text-ink-faint">
            {selectedTraceCount} {selectedTraceCount === 1 ? "trace" : "traces"} to label
          </p>
        </RadioCard>

        <RadioCard checked={level === "turn"} onSelect={() => onChange("turn")}>
          <p className="mb-3 text-sm font-semibold text-ink">Turn level</p>
          <LevelDiagram level="turn" selected={level === "turn"} />
          <p className="mt-3 text-sm text-ink-muted">One label per turn</p>
          <p className="text-xs text-ink-faint">One target per labelable turn</p>
        </RadioCard>
      </div>
    </div>
  );
}
