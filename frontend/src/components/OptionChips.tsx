import { cn } from "@/lib/utils";
import type { ResolvedField } from "@/api/types";

export function OptionChips({
  field,
  value,
  onToggle,
}: {
  field: ResolvedField;
  value: string[];
  onToggle: (option: string) => void;
}) {
  const options = field.options ?? [];
  return (
    <div
      tabIndex={0}
      data-form-control
      data-field-name={field.name}
      data-field-type="multi_select"
      className="flex flex-wrap gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {options.map((opt, i) => {
        const selected = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            role="checkbox"
            aria-checked={selected}
            onClick={() => onToggle(opt)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-all",
              selected
                ? "border-accent bg-accent/10 text-accent-strong"
                : "border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:bg-surface",
            )}
          >
            {i < 9 && (
              <kbd
                className={cn(
                  "rounded px-1 text-[10px] font-semibold tabular-nums",
                  selected ? "bg-accent/15 text-accent-strong" : "bg-surface-inset text-ink-faint",
                )}
              >
                {i + 1}
              </kbd>
            )}
            {opt}
          </button>
        );
      })}
    </div>
  );
}
