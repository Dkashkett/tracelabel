import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FieldRenderer } from "@/components/FieldRenderer";
import { useSchema, usePatchSchema } from "@/api/queries/schema";
import { useCreateTask } from "@/api/queries/tasks";
import { SchemaImpactError } from "@/api/client/schema";
import type { FieldDef, ResolvedField, SchemaImpactOut } from "@/api/types";
import { FieldEditor } from "./FieldEditor";
import { BreakingChangeDialog } from "./BreakingChangeDialog";
import { FIELD_PRESETS } from "./fieldPresets";

// FieldRenderer (not AnnotationPane) is the right reuse target for a live preview:
// AnnotationPane needs a real active labeling session (NavContext's useController —
// activeTarget, trace, commit machinery), which doesn't exist while editing a rubric
// with no traces loaded. FieldRenderer's own doc comment says it "renders
// session.fields" with zero knowledge of anything else, which is exactly right here.
function toResolvedField(field: FieldDef): ResolvedField {
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

export default function RubricEditor() {
  const { project, task } = useParams<{ project: string; task: string }>();
  const navigate = useNavigate();
  const { data: schema, isLoading, isError } = useSchema(project, task);
  const patchSchema = usePatchSchema(project ?? "", task ?? "");
  const createTask = useCreateTask(project ?? "");

  const [draftFields, setDraftFields] = useState<FieldDef[] | null>(null);
  const [previewValues, setPreviewValues] = useState<Record<string, string | string[]>>({});
  const [impact, setImpact] = useState<SchemaImpactOut | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (schema && draftFields === null) setDraftFields(schema.fields);
  }, [schema, draftFields]);

  if (isLoading || draftFields === null) {
    return <div className="p-8 text-sm text-ink-muted">Loading…</div>;
  }
  if (isError || !schema) {
    return <div className="p-8 text-sm text-ink-muted">Rubric not found.</div>;
  }

  function updateField(index: number, field: FieldDef) {
    setDraftFields((current) => (current ?? []).map((f, i) => (i === index ? field : f)));
  }

  function removeField(index: number) {
    setDraftFields((current) => (current ?? []).filter((_, i) => i !== index));
  }

  function addField() {
    setDraftFields((current) => [
      ...(current ?? []),
      { name: "", label: "", type: "text", required: false },
    ]);
  }

  function applyPreset(fields: FieldDef[]) {
    if (!window.confirm("Replace current fields with this preset? Unsaved edits will be lost.")) return;
    setDraftFields(fields);
  }

  function save(confirm: boolean) {
    setSaved(false);
    patchSchema.mutate(
      { patch: { fields: draftFields ?? [] }, confirm },
      {
        onSuccess: () => {
          setImpact(null);
          setSaved(true);
        },
        onError: (error) => {
          if (error instanceof SchemaImpactError) {
            setImpact(error.impact);
          }
        },
      },
    );
  }

  function forkToNewTask() {
    if (!project || !task) return;
    const newName = window.prompt("Name for the forked task", `${task}-v2`);
    if (!newName) return;
    createTask.mutate(
      { name: newName, level: "turn", fields: draftFields ?? [] },
      {
        onSuccess: (created) => {
          setImpact(null);
          navigate(`/p/${project}/t/${created.name}/schema`);
        },
      },
    );
  }

  return (
    <div className="grid grid-cols-2 gap-8 p-8">
      <div>
        <h1 className="text-lg font-semibold text-ink">
          Rubric: {project} / {task}
        </h1>

        <div className="mt-4 flex flex-wrap gap-2">
          {FIELD_PRESETS.map((preset) => (
            <Button key={preset.label} variant="outline" onClick={() => applyPreset(preset.fields)}>
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {draftFields.map((field, index) => (
            <FieldEditor
              key={index}
              field={field}
              onChange={(next) => updateField(index, next)}
              onRemove={() => removeField(index)}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" onClick={addField}>
            Add field
          </Button>
          <Button onClick={() => save(false)} disabled={patchSchema.isPending}>
            {patchSchema.isPending ? "Saving…" : "Save"}
          </Button>
          {saved && <span className="text-xs text-ink-muted">Saved</span>}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-ink">Live preview</h2>
        <div className="mt-3 flex flex-col gap-4">
          {draftFields.map((field) => {
            const resolved = toResolvedField(field);
            const value = previewValues[field.name];
            return (
              <div key={field.name || Math.random()}>
                <p className="mb-1 text-xs font-medium text-ink-muted">{resolved.label}</p>
                <FieldRenderer
                  field={resolved}
                  value={value}
                  setValue={(v) => setPreviewValues((current) => ({ ...current, [field.name]: v }))}
                  toggle={(option) =>
                    setPreviewValues((current) => {
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
              </div>
            );
          })}
        </div>
      </div>

      {impact && (
        <BreakingChangeDialog
          impact={impact}
          onCancel={() => setImpact(null)}
          onRemoveAnyway={() => save(true)}
          onForkToNewTask={forkToNewTask}
        />
      )}
    </div>
  );
}
