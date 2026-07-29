import { RubricBuilder } from "@/components/rubric/RubricBuilder";
import { RubricPreview } from "@/components/rubric/RubricPreview";
import type { FieldDef } from "@/api/types";

export interface RubricStepProps {
  fields: FieldDef[];
  onChange: (fields: FieldDef[]) => void;
}

export function RubricStep({ fields, onChange }: RubricStepProps) {
  return (
    <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
      <div className="min-w-0">
        <RubricBuilder fields={fields} onChange={onChange} />
      </div>
      <div className="min-w-0 lg:sticky lg:top-6">
        <RubricPreview fields={fields} />
      </div>
    </div>
  );
}
