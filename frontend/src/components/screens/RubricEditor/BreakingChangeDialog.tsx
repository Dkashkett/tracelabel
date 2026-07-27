import { Button } from "@/components/ui/button";
import type { SchemaImpactOut } from "@/api/types";

export interface BreakingChangeDialogProps {
  impact: SchemaImpactOut;
  onCancel: () => void;
  onRemoveAnyway: () => void;
  onForkToNewTask: () => void;
}

// Shown when PATCH .../schema comes back 409 (SchemaImpactError) — the plan calls the
// hash-split behind this dialog "the single most important correctness change".
export function BreakingChangeDialog({
  impact,
  onCancel,
  onRemoveAnyway,
  onForkToNewTask,
}: BreakingChangeDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-5 shadow-lg">
        <h2 className="text-sm font-semibold text-ink">This change affects existing annotations</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {impact.affected_annotations} annotation{impact.affected_annotations === 1 ? "" : "s"} would
          be affected.
        </p>

        <ul className="mt-3 flex flex-col gap-1 text-sm text-ink-muted">
          {impact.removed_fields.length > 0 && (
            <li>Removed fields: {impact.removed_fields.join(", ")}</li>
          )}
          {impact.retyped_fields.map((field) => (
            <li key={field.name}>
              Retyped: {field.name} ({field.old_type} → {field.new_type})
            </li>
          ))}
          {Object.entries(impact.removed_options).map(([field, options]) => (
            <li key={field}>
              Removed options on {field}: {options.join(", ")}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onForkToNewTask}>
            Fork to a new task
          </Button>
          <Button onClick={onRemoveAnyway}>Remove anyway</Button>
        </div>
      </div>
    </div>
  );
}
