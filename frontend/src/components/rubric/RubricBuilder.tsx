import { Button } from "@/components/ui/button";
import { PlusIcon, SparklesIcon } from "@/components/ui/icons";
import { SectionHeading } from "@/components/ui/layout";
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
      <div className="rounded-xl border border-line bg-surface-inset/35 p-4">
        <SectionHeading
          eyebrow="Start from"
          title="Rubric preset"
          description="Replace the current fields with a proven starting point."
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {FIELD_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              size="sm"
              variant="outline"
              onClick={() => applyPreset(preset.fields)}
            >
              <SparklesIcon className="h-3.5 w-3.5" />
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        {fields.map((field, index) => (
          <FieldEditor
            key={index}
            field={field}
            index={index}
            onChange={(next) => updateField(index, next)}
            onRemove={() => removeField(index)}
          />
        ))}
      </div>

      <Button variant="outline" className="mt-4 w-full border-dashed" onClick={addField}>
        <PlusIcon className="h-4 w-4" />
        Add field
      </Button>
    </div>
  );
}
