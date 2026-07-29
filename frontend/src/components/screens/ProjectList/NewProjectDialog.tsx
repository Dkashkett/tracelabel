import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface NewProjectDialogProps {
  onCancel: () => void;
  onCreate: (name: string, notes: string) => void;
  submitting: boolean;
}

export function NewProjectDialog({ onCancel, onCreate, submitting }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const trimmedName = name.trim();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmedName) return;
    onCreate(trimmedName, notes.trim());
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="New project"
      description="Create a workspace for related traces, tasks, and exports."
      initialFocusRef={nameRef}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form="new-project-form" disabled={!trimmedName || submitting}>
            {submitting ? "Creating…" : "Create project"}
          </Button>
        </>
      }
    >
      <form id="new-project-form" className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="new-project-name" className="text-xs font-semibold text-ink">
            Project name
          </label>
          <Input
            ref={nameRef}
            id="new-project-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2"
            placeholder="Support quality"
          />
          <p className="mt-1.5 text-xs leading-5 text-ink-faint">
            A readable name for the dataset and labeling work.
          </p>
        </div>
        <div>
          <label htmlFor="new-project-notes" className="text-xs font-semibold text-ink">
            Notes <span className="font-normal text-ink-faint">optional</span>
          </label>
          <Textarea
            id="new-project-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-2"
            placeholder="What are you evaluating?"
          />
        </div>
      </form>
    </Dialog>
  );
}
