import { RubricBuilder } from "@/components/rubric/RubricBuilder";
import { RubricPreview } from "@/components/rubric/RubricPreview";
import type { FieldDef } from "@/api/types";

export interface RubricStepProps {
  fields: FieldDef[];
  onChange: (fields: FieldDef[]) => void;
}

export function RubricStep({ fields, onChange }: RubricStepProps) {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="min-w-0">
        <RubricBuilder fields={fields} onChange={onChange} />
      </div>
      <div className="min-w-0">
        <RubricPreview fields={fields} />
      </div>
    </div>
  );
}
