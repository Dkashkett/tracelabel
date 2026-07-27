import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { FieldDef, Level, TaskCreate } from "@/api/types";

// No shared preset registry exists in this codebase yet — these are small, local
// starting points for the "starting preset" step of new-task creation.
const PRESETS: { label: string; fields: FieldDef[] | undefined }[] = [
  {
    label: "Pass / fail",
    fields: [
      { name: "verdict", label: "Verdict", type: "single_select", options: ["pass", "fail"], required: true },
    ],
  },
  {
    label: "Freeform notes",
    fields: [{ name: "notes", label: "Notes", type: "text", required: true }],
  },
  {
    // undefined -> omit `fields` entirely, letting the server apply its own
    // DEFAULT_FIELDS (see api/routes/tasks.py).
    label: "Blank (server default)",
    fields: undefined,
  },
];

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export interface NewTaskDialogProps {
  onSubmit: (input: TaskCreate) => void;
  onClose: () => void;
  submitting: boolean;
}

export function NewTaskDialog({ onSubmit, onClose, submitting }: NewTaskDialogProps) {
  const [name, setName] = useState("");
  const [level, setLevel] = useState<Level>("turn");
  const [presetIndex, setPresetIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!NAME_PATTERN.test(name)) {
      setError("Name must be lowercase letters, numbers, or underscores, starting with a letter.");
      return;
    }
    setError(null);
    // queue_scope is deliberately omitted — {type:"all"} is the server default and
    // the only option this wave supports ("filter" scope is Phase 2).
    onSubmit({ name, level, fields: PRESETS[presetIndex].fields });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-5 shadow-lg"
      >
        <h2 className="text-sm font-semibold text-ink">New task</h2>

        <label className="mt-4 block text-xs font-medium text-ink-muted">
          Name
          <input
            className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="escalation-risk"
            autoFocus
          />
        </label>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}

        <label className="mt-4 block text-xs font-medium text-ink-muted">
          Level
          <select
            className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink"
            value={level}
            onChange={(event) => setLevel(event.target.value as Level)}
          >
            <option value="turn">Turn</option>
            <option value="trace">Trace</option>
          </select>
        </label>

        <fieldset className="mt-4">
          <legend className="text-xs font-medium text-ink-muted">Starting preset</legend>
          <div className="mt-1 flex flex-col gap-1">
            {PRESETS.map((preset, index) => (
              <label key={preset.label} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="preset"
                  checked={presetIndex === index}
                  onChange={() => setPresetIndex(index)}
                />
                {preset.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create task"}
          </Button>
        </div>
      </form>
    </div>
  );
}
