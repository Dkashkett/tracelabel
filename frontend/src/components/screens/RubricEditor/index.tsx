import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ArrowLeftIcon, CheckIcon, SparklesIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Notice, PageFrame, PageHeader } from "@/components/ui/layout";
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
  const [pendingPreset, setPendingPreset] = useState<FieldDef[] | null>(null);
  const [forkDialogOpen, setForkDialogOpen] = useState(false);
  const [forkName, setForkName] = useState("");

  useEffect(() => {
    if (schema && draftFields === null) setDraftFields(schema.fields);
  }, [schema, draftFields]);

  useEffect(() => {
    if (task && !forkName) setForkName(`${task}_v2`);
  }, [forkName, task]);

  if (isLoading || draftFields === null) {
    return (
      <PageFrame>
        <div className="h-8 w-64 animate-pulse rounded bg-surface-raised" />
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="h-[34rem] animate-pulse rounded-2xl bg-surface" />
          <div className="h-96 animate-pulse rounded-2xl bg-surface" />
        </div>
      </PageFrame>
    );
  }
  if (isError || !schema) {
    return (
      <PageFrame width="default">
        <Notice tone="danger" title="Rubric not found">
          Return to the project and choose another task.
        </Notice>
      </PageFrame>
    );
  }

  function requestPreset(fields: FieldDef[]) {
    setPendingPreset(structuredClone(fields));
  }

  function confirmPreset() {
    if (!pendingPreset) return;
    setDraftFields(pendingPreset);
    setPendingPreset(null);
    setSaved(false);
  }

  function save(confirm: boolean, thenReturn = false) {
    setSaved(false);
    patchSchema.mutate(
      { patch: { fields: draftFields ?? [] }, confirm },
      {
        onSuccess: () => {
          setImpact(null);
          if (thenReturn) navigate(`/p/${project}`);
          else setSaved(true);
        },
        onError: (error) => {
          if (error instanceof SchemaImpactError) setImpact(error.impact);
        },
      },
    );
  }

  function forkToNewTask() {
    if (!project || !forkName.trim()) return;
    createTask.mutate(
      { name: forkName.trim(), level: "turn", fields: draftFields ?? [] },
      {
        onSuccess: (created) => {
          setImpact(null);
          setForkDialogOpen(false);
          navigate(`/p/${project}/t/${created.name}/schema`);
        },
      },
    );
  }

  return (
    <PageFrame width="wide">
      <Link
        to={`/p/${project}`}
        className="mb-5 inline-flex items-center gap-1.5 rounded-md text-xs text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back to project
      </Link>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <SparklesIcon className="h-3.5 w-3.5" />
            Rubric editor
          </span>
        }
        title={task}
        description="Shape the exact fields annotators complete for each target."
        actions={
          <>
            {saved && (
              <span role="status" className="mr-1 inline-flex items-center gap-1.5 text-xs font-medium text-pass">
                <CheckIcon className="h-3.5 w-3.5" />
                Saved
              </span>
            )}
            <Button variant="outline" onClick={() => save(false)} disabled={patchSchema.isPending}>
              {patchSchema.isPending ? "Saving…" : "Save"}
            </Button>
            <Button onClick={() => save(false, true)} disabled={patchSchema.isPending}>
              Done
            </Button>
          </>
        }
      />

      {patchSchema.isError && !(patchSchema.error instanceof SchemaImpactError) && (
        <Notice className="mt-6" tone="danger" title="Rubric was not saved">
          {(patchSchema.error as Error).message}
        </Notice>
      )}

      <div className="mt-8 grid items-start gap-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <RubricBuilder
          fields={draftFields}
          onChange={(fields) => {
            setDraftFields(fields);
            setSaved(false);
          }}
          onApplyPreset={requestPreset}
        />
        <div className="lg:sticky lg:top-6">
          <RubricPreview fields={draftFields} />
        </div>
      </div>

      <Dialog
        open={Boolean(pendingPreset)}
        onOpenChange={(open) => {
          if (!open) setPendingPreset(null);
        }}
        title="Replace the current rubric?"
        description="The preset will replace every field in the current draft. Saved annotations are not changed until you save the rubric."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingPreset(null)}>
              Cancel
            </Button>
            <Button onClick={confirmPreset}>Apply preset</Button>
          </>
        }
      />

      {impact && (
        <BreakingChangeDialog
          impact={impact}
          onCancel={() => setImpact(null)}
          onRemoveAnyway={() => save(true)}
          onForkToNewTask={() => {
            setImpact(null);
            setForkDialogOpen(true);
          }}
        />
      )}

      <Dialog
        open={forkDialogOpen}
        onOpenChange={setForkDialogOpen}
        title="Fork to a new task"
        description="Keep existing annotations intact and apply this rubric to a new task."
        footer={
          <>
            <Button variant="ghost" onClick={() => setForkDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={forkToNewTask}
              disabled={!forkName.trim() || createTask.isPending}
            >
              {createTask.isPending ? "Creating…" : "Create fork"}
            </Button>
          </>
        }
      >
        <label htmlFor="fork-task-name" className="text-xs font-semibold text-ink">
          Task name
        </label>
        <Input
          id="fork-task-name"
          className="mt-2 font-mono"
          value={forkName}
          onChange={(event) => setForkName(event.target.value)}
        />
      </Dialog>
    </PageFrame>
  );
}
