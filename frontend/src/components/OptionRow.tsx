import { cn } from "@/lib/utils";
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
      className="flex flex-wrap gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      {options.map((opt, i) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(opt)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
              selected
                ? "border-sky-600 bg-sky-600 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
            )}
          >
            {i < 9 && (
              <kbd
                className={cn(
                  "rounded px-1 text-[10px] font-semibold",
                  selected ? "bg-sky-700 text-sky-100" : "bg-slate-200 text-slate-500 dark:bg-slate-700",
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
