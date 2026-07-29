import { Button } from "@/components/ui/button";
import type { FieldDef, Level, SourceOut } from "@/api/types";

export interface ReviewStepProps {
  name: string;
  level: Level;
  sources: SourceOut[];
  selected: Set<number>;
  selectedTraceCount: number;
  fields: FieldDef[];
  onEditStep: (step: number) => void;
}

function ReviewRow({
  label,
  value,
  step,
  onEditStep,
}: {
  label: string;
  value: React.ReactNode;
  step: number;
  onEditStep: (step: number) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <dt className="text-xs uppercase tracking-wide text-ink-faint">{label}</dt>
        <dd className="mt-1 text-sm text-ink">{value}</dd>
      </div>
      <Button variant="ghost" onClick={() => onEditStep(step)}>
        Edit
      </Button>
    </div>
  );
}

export function ReviewStep({
  name,
  level,
  sources,
  selected,
  selectedTraceCount,
  fields,
  onEditStep,
}: ReviewStepProps) {
  const allSelected = selected.size === sources.length;
  const sourceSummary =
    sources.length === 0
      ? "No sources"
      : allSelected
        ? `All sources (${sources.length})`
        : `${selected.size} of ${sources.length} sources`;

  const itemCount = level === "trace" ? selectedTraceCount : sources.length === 0 ? 0 : undefined;

  return (
    <div className="rounded-xl border border-line bg-surface p-8 shadow-card">
      <dl className="mb-6 grid grid-cols-3 divide-x divide-line rounded-lg border border-line">
        <div className="px-3 py-4">
          <dt className="text-xs uppercase tracking-wide text-ink-faint">Sources</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{selected.size}</dd>
        </div>
        <div className="px-3 py-4">
          <dt className="text-xs uppercase tracking-wide text-ink-faint">Items to label</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">
            {itemCount ?? "—"}
          </dd>
        </div>
        <div className="px-3 py-4">
          <dt className="text-xs uppercase tracking-wide text-ink-faint">Rubric fields</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{fields.length}</dd>
        </div>
      </dl>

      <dl className="divide-y divide-line">
        <ReviewRow label="Name" value={name} step={0} onEditStep={onEditStep} />
        <ReviewRow
          label="Level"
          value={level === "trace" ? "Trace" : "Turn"}
          step={2}
          onEditStep={onEditStep}
        />
        <ReviewRow label="Sources" value={sourceSummary} step={1} onEditStep={onEditStep} />
        <ReviewRow
          label="Rubric"
          value={
            <ul className="space-y-0.5">
              {fields.map((field, i) => (
                <li key={i}>
                  {field.label || field.name || "Untitled field"}
                  <span className="text-ink-faint">
                    {" "}
                    · {field.type}
                    {field.required ? " · required" : ""}
                  </span>
                </li>
              ))}
            </ul>
          }
          step={3}
          onEditStep={onEditStep}
        />
      </dl>
    </div>
  );
}
