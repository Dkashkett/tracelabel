import { Button } from "@/components/ui/button";
import { FIELD_PRESETS } from "@/lib/fieldPresets";
import type { FieldDef } from "@/api/types";
import { FieldEditor } from "./FieldEditor";

export interface RubricBuilderProps {
  fields: FieldDef[];
  onChange: (fields: FieldDef[]) => void;
  onApplyPreset?: (fields: FieldDef[]) => void;
}

// The rubric form builder: preset gallery + editable field list. Shared by the
// new-task wizard and the rubric editor so both stay in sync.
export function RubricBuilder({ fields, onChange, onApplyPreset }: RubricBuilderProps) {
  function updateField(index: number, field: FieldDef) {
    onChange(fields.map((f, i) => (i === index ? field : f)));
  }

  function removeField(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  function addField() {
    onChange([...fields, { name: "", label: "", type: "text", required: false }]);
  }

  function applyPreset(presetFields: FieldDef[]) {
    const cloned = structuredClone(presetFields);
    if (onApplyPreset) onApplyPreset(cloned);
    else onChange(cloned);
  }

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Start from
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {FIELD_PRESETS.map((preset) => (
          <Button key={preset.label} variant="outline" onClick={() => applyPreset(preset.fields)}>
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {fields.map((field, index) => (
          <FieldEditor
            key={index}
            field={field}
            onChange={(next) => updateField(index, next)}
            onRemove={() => removeField(index)}
          />
        ))}
      </div>

      <Button variant="outline" className="mt-3" onClick={addField}>
        Add field
      </Button>
    </div>
  );
}
