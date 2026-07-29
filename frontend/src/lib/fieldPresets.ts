import type { FieldDef, ResolvedField } from "@/api/types";

// Mirrors src/tracelabel/config/presets.py's DEFAULT_FIELDS — keep both in sync.
// This is the one canonical "Pass / fail" definition; the new-task wizard and the
// rubric editor's preset gallery both source it from here instead of keeping their
// own copy.
export const PASS_FAIL_FIELDS: FieldDef[] = [
  { name: "verdict", label: "Verdict", type: "single_select", options: ["pass", "fail"], required: true },
  {
    name: "reasoning",
    label: "Reasoning",
    type: "text",
    placeholder: "Why is this a pass or fail?",
    required: true,
  },
];

// Shared by the new-task wizard and the rubric editor to feed a draft FieldDef into
// FieldRenderer's live preview.
export function toResolvedField(field: FieldDef): ResolvedField {
  return {
    name: field.name,
    label: field.label ?? field.name,
    type: field.type,
    required: field.required,
    options: field.options ?? undefined,
    placeholder: field.placeholder ?? undefined,
    help: field.help ?? undefined,
  };
}

// Presets offered by both the new-task wizard and the rubric editor's preset gallery.
// "Pass / fail" is the only one left — clicking it resets the draft fields back to the
// default. Callers must structuredClone(preset.fields) before mutating; this array is
// shared and must stay pristine.
export const FIELD_PRESETS: { label: string; fields: FieldDef[] }[] = [
  { label: "Pass / fail", fields: PASS_FAIL_FIELDS },
];
