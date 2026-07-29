import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RubricBuilder } from "@/components/rubric/RubricBuilder";
import { RubricPreview } from "@/components/rubric/RubricPreview";
import { useSchema, usePatchSchema } from "@/api/queries/schema";
import { useCreateTask } from "@/api/queries/tasks";
import { SchemaImpactError } from "@/api/client/schema";
import type { FieldDef, SchemaImpactOut } from "@/api/types";
import { BreakingChangeDialog } from "./BreakingChangeDialog";

export default function RubricEditor() {
  const { project, task } = useParams<{ project: string; task: string }>();
  const navigate = useNavigate();
  const { data: schema, isLoading, isError } = useSchema(project, task);
  const patchSchema = usePatchSchema(project ?? "", task ?? "");
  const createTask = useCreateTask(project ?? "");

  const [draftFields, setDraftFields] = useState<FieldDef[] | null>(null);
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

  function applyPreset(fields: FieldDef[]) {
    if (!window.confirm("Replace current fields with this preset? Unsaved edits will be lost.")) return;
    setDraftFields(fields);
  }

  function save(confirm: boolean, thenReturn = false) {
    setSaved(false);
    patchSchema.mutate(
      { patch: { fields: draftFields ?? [] }, confirm },
      {
        onSuccess: () => {
          setImpact(null);
          if (thenReturn) {
            navigate(`/p/${project}`);
          } else {
            setSaved(true);
          }
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
    <div className="p-8">
      <h1 className="text-lg font-semibold text-ink">
        Rubric: {project} / {task}
      </h1>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <RubricBuilder
            fields={draftFields}
            onChange={setDraftFields}
            onApplyPreset={applyPreset}
          />

          <div className="mt-3 flex items-center gap-2">
            <Button onClick={() => save(false)} disabled={patchSchema.isPending}>
              {patchSchema.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              onClick={() => save(false, true)}
              disabled={patchSchema.isPending}
            >
              Done
            </Button>
            {saved && <span className="text-xs text-ink-muted">Saved</span>}
          </div>
        </div>

        <div className="min-w-0">
          <RubricPreview fields={draftFields} />
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
