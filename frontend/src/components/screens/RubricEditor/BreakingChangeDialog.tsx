import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/layout";
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="This change affects existing annotations"
      description={`${impact.affected_annotations} annotation${
        impact.affected_annotations === 1 ? "" : "s"
      } would be affected.`}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onForkToNewTask}>
            Fork to a new task
          </Button>
          <Button variant="destructive" onClick={onRemoveAnyway}>
            Remove anyway
          </Button>
        </>
      }
    >
      <Notice tone="warning" title="Review the impact">
        Removing schema values can make prior annotation data unavailable in this task.
      </Notice>
      <ul className="mt-4 flex flex-col gap-2 rounded-xl border border-line bg-surface-inset/45 p-4 text-sm text-ink-muted">
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
    </Dialog>
  );
}
