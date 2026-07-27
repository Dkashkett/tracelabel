import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// A minimal modal, built locally rather than in components/ui/ — there's no shared
// Dialog primitive yet, and the brief asks each F2 packet to build its own rather
// than collide on a shared file. A plain overlay div is enough here; no need for
// focus-trapping or portal semantics.
export interface NewProjectDialogProps {
  onCancel: () => void;
  onCreate: (name: string, notes: string) => void;
  submitting: boolean;
}

export function NewProjectDialog({ onCancel, onCreate, submitting }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  const trimmedName = name.trim();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmedName) return;
    onCreate(trimmedName, notes.trim());
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label="New project"
        className="w-full max-w-sm rounded-lg border border-line bg-surface-raised p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink">New project</h2>
        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="new-project-name" className="text-xs font-medium text-ink-muted">
              Name
            </label>
            <input
              id="new-project-name"
              autoFocus
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              placeholder="Project name"
            />
          </div>
          <div>
            <label htmlFor="new-project-notes" className="text-xs font-medium text-ink-muted">
              Notes (optional)
            </label>
            <Textarea
              id="new-project-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-1"
              placeholder="What is this project for?"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmedName || submitting}>
              {submitting ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
