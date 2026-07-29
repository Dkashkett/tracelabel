import { Input } from "@/components/ui/input";

export interface NameStepProps {
  name: string;
  onChange: (name: string) => void;
}

export function NameStep({ name, onChange }: NameStepProps) {
  return (
    <div className="max-w-xl">
      <label className="block text-xs font-semibold text-ink" htmlFor="task-name">
        Task name
      </label>
      <Input
        id="task-name"
        className="mt-2 font-mono"
        value={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder="escalation_risk"
        autoFocus
      />
      <p className="mt-2 text-xs leading-5 text-ink-faint">
        Lowercase letters, numbers, and underscores, starting with a letter.
      </p>
      <div className="mt-8 rounded-xl border border-line bg-surface-inset/45 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          Example
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Use a durable name that describes the evaluation, such as{" "}
          <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-xs text-ink">
            response_quality
          </code>
          .
        </p>
      </div>
    </div>
  );
}
