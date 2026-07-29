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
      className="grid gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
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
              "group inline-flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all",
              selected
                ? tone.button
                : "border-line-strong bg-surface-raised/80 text-ink-muted hover:border-ink-faint hover:bg-surface-overlay hover:text-ink",
            )}
          >
            {i < 9 && (
              <kbd
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[10px] font-semibold tabular-nums",
                  selected
                    ? `${tone.kbd} border-current/30`
                    : "border-line-strong bg-surface-inset text-ink-faint group-hover:border-ink-faint",
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
