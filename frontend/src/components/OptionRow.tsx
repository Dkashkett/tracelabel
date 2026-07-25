import { cn } from "@/lib/utils";
import { optionTone, toneSelectedClasses } from "@/lib/optionTone";
import type { ResolvedField } from "@/api/types";

export function OptionRow({
  field,
  value,
  onSelect,
}: {
  field: ResolvedField;
  value: string | undefined;
  onSelect: (option: string) => void;
}) {
  const options = field.options ?? [];

  function onKeyDown(e: React.KeyboardEvent) {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const i = value ? options.indexOf(value) : -1;
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = Math.max(0, Math.min(options.length - 1, (i === -1 ? 0 : i) + dir));
    onSelect(options[next]);
  }

  return (
    <div
      role="radiogroup"
      tabIndex={0}
      data-form-control
      data-field-name={field.name}
      data-field-type="single_select"
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {options.map((opt, i) => {
        const selected = value === opt;
        const tone = toneSelectedClasses[optionTone(opt)];
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(opt)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-all",
              selected
                ? tone.button
                : "border-line bg-surface-raised text-ink-muted hover:border-line-strong hover:bg-surface",
            )}
          >
            {i < 9 && (
              <kbd
                className={cn(
                  "rounded px-1 text-[10px] font-semibold tabular-nums",
                  selected ? tone.kbd : "bg-surface-inset text-ink-faint",
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
