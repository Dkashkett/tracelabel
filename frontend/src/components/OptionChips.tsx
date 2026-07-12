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
      className="flex flex-wrap gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
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
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
              selected
                ? "border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
            )}
          >
            {i < 9 && (
              <kbd className="rounded bg-slate-200 px-1 text-[10px] font-semibold text-slate-500 dark:bg-slate-700">
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
