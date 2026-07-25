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
        className="min-h-[4.5rem] w-full resize-none rounded-lg border border-line bg-surface-raised px-3.5 py-2.5 text-sm leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
      />
    </div>
  );
}
