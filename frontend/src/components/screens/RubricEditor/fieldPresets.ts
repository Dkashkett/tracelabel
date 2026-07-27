import type { FieldDef } from "@/api/types";

// No shared preset registry exists in this codebase yet — small, local starting
// points for the rubric editor's preset gallery.
export const FIELD_PRESETS: { label: string; fields: FieldDef[] }[] = [
  {
    label: "Pass / fail",
    fields: [
      { name: "verdict", label: "Verdict", type: "single_select", options: ["pass", "fail"], required: true },
    ],
  },
  {
    label: "Rating 1-5",
    fields: [
      {
        name: "rating",
        label: "Rating",
        type: "single_select",
        options: ["1", "2", "3", "4", "5"],
        required: true,
      },
    ],
  },
  {
    label: "Freeform notes",
    fields: [{ name: "notes", label: "Notes", type: "text", required: true }],
  },
];
