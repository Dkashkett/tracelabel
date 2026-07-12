import { useLayoutEffect, useRef } from "react";
import type { ResolvedField } from "@/api/types";

export function AutoGrowTextarea({
  field,
  value,
  onChange,
}: {
  field: ResolvedField;
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div data-field-name={field.name} data-field-type="text">
      <textarea
        ref={ref}
        data-form-control
        rows={2}
        value={value}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-slate-600 dark:bg-slate-800"
      />
    </div>
  );
}
