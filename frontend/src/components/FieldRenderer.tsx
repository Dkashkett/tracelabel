import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { OptionChips } from "./OptionChips";
import { OptionRow } from "./OptionRow";
import type { ResolvedField } from "@/api/types";

export interface FieldRendererProps {
  field: ResolvedField;
  value: string | string[] | undefined;
  setValue: (value: string | string[]) => void;
  toggle: (option: string) => void;
}

// The single switch of 06 §6. New field types = a new case, nothing else. The frontend
// has zero knowledge of defaults, presets, or level semantics — it renders session.fields.
export function FieldRenderer({ field, value, setValue, toggle }: FieldRendererProps) {
  switch (field.type) {
    case "single_select":
      return (
        <OptionRow field={field} value={value as string | undefined} onSelect={(v) => setValue(v)} />
      );
    case "multi_select":
      return (
        <OptionChips
          field={field}
          value={Array.isArray(value) ? value : []}
          onToggle={toggle}
        />
      );
    case "text":
      return (
        <AutoGrowTextarea
          field={field}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => setValue(v)}
        />
      );
  }
}
