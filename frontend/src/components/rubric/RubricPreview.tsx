import { useState } from "react";
import { FieldRenderer } from "@/components/FieldRenderer";
import { toResolvedField } from "@/lib/fieldPresets";
import type { FieldDef } from "@/api/types";

export interface RubricPreviewProps {
  fields: FieldDef[];
}

// A genuinely interactive mock of the labeling screen (AnnotationPane), so editors can
// click options and type into text fields while building a rubric. Markup intentionally
// mirrors AnnotationPane's field block (space-y-6, label + required asterisk, help text)
// so what you see here is what labeling will actually look like.
export function RubricPreview({ fields }: RubricPreviewProps) {
  const [values, setValues] = useState<Record<string, string | string[]>>({});

  return (
    <div className="rounded-xl border border-line bg-surface-inset p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Preview</p>
      <div className="mt-4 space-y-6">
        {fields.map((field, index) => {
          const resolved = toResolvedField(field);
          const hasLabel = field.label?.trim() || field.name.trim();
          const value = values[field.name];
          const isEmptySelect =
            (field.type === "single_select" || field.type === "multi_select") &&
            (field.options ?? []).filter((o) => o.trim()).length === 0;

          return (
            <div key={`${index}-${field.type}`}>
              <label className="mb-2 flex items-baseline gap-1 text-sm font-semibold text-ink">
                {hasLabel ? resolved.label : <span className="italic text-ink-faint">Untitled field</span>}
                {field.required && <span className="text-fail">*</span>}
              </label>
              {field.help && <p className="mb-2 text-xs text-ink-faint">{field.help}</p>}
              {isEmptySelect ? (
                <p className="text-xs text-ink-faint">Add options to see them here.</p>
              ) : (
                <FieldRenderer
                  field={resolved}
                  value={value}
                  setValue={(v) => setValues((current) => ({ ...current, [field.name]: v }))}
                  toggle={(option) =>
                    setValues((current) => {
                      const existing = Array.isArray(current[field.name])
                        ? (current[field.name] as string[])
                        : [];
                      const next = existing.includes(option)
                        ? existing.filter((o) => o !== option)
                        : [...existing, option];
                      return { ...current, [field.name]: next };
                    })
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
