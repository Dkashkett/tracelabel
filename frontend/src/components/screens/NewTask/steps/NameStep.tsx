import { Input } from "@/components/ui/input";

export interface NameStepProps {
  name: string;
  onChange: (name: string) => void;
}

export function NameStep({ name, onChange }: NameStepProps) {
  return (
    <div className="rounded-xl border border-line bg-surface p-6">
      <label className="block text-xs font-medium text-ink-muted" htmlFor="task-name">
        Name
      </label>
      <Input
        id="task-name"
        className="mt-2 max-w-sm"
        value={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder="escalation_risk"
        autoFocus
      />
      <p className="mt-2 text-xs text-ink-faint">
        Lowercase letters, numbers, and underscores, starting with a letter.
      </p>
    </div>
  );
}
