// Multi-step "New task" flow: name -> sources -> label level -> rubric (build +
// live preview) -> review -> create. Replaces the old single-modal NewTaskDialog so
// each decision gets its own screen instead of one crowded form.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useProject } from "@/api/queries/projects";
import { useCreateTask } from "@/api/queries/tasks";
import { PASS_FAIL_FIELDS } from "@/lib/fieldPresets";
import type { FieldDef, Level, QueueScope } from "@/api/types";
import { WizardShell } from "./WizardShell";
import { NameStep } from "./steps/NameStep";
import { SourcesStep } from "./steps/SourcesStep";
import { LevelStep } from "./steps/LevelStep";
import { RubricStep } from "./steps/RubricStep";
import { ReviewStep } from "./steps/ReviewStep";

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const STEP_LABELS = ["Name", "Sources", "Level", "Rubric", "Review"];
const STEP_SUBTITLES = [
  "Give this task a short, unique name.",
  "Choose which imported sources this task will draw from.",
  "Decide whether one label covers a whole trace or each turn.",
  "Build the rubric annotators will fill in.",
  "Check everything before creating the task.",
];

export default function NewTask() {
  const { project: slug } = useParams<{ project: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading, isError } = useProject(slug);
  const createTask = useCreateTask(slug ?? "");

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<Level>("trace");
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<number> | null>(null);
  const [fields, setFields] = useState<FieldDef[]>(() => structuredClone(PASS_FAIL_FIELDS));
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return <div className="p-8 text-sm text-ink-muted">Loading…</div>;
  }
  if (isError || !project || !slug) {
    return <div className="p-8 text-sm text-ink-muted">Project not found.</div>;
  }

  const sources = project.sources;
  const selected = selectedSourceIds ?? new Set(sources.map((source) => source.id));

  function toggleSource(id: number) {
    setSelectedSourceIds((current) => {
      const next = new Set(current ?? sources.map((source) => source.id));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function goToStep(index: number) {
    setError(null);
    setStep(index);
  }

  function goBack() {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
  }

  function goNext() {
    if (step === 0 && !NAME_PATTERN.test(name)) {
      setError("Name must be lowercase letters, numbers, or underscores, starting with a letter.");
      return;
    }
    if (step === 1 && sources.length > 0 && selected.size === 0) {
      setError("Select at least one source.");
      return;
    }
    setError(null);
    if (step === STEP_LABELS.length - 1) {
      handleCreate();
      return;
    }
    setStep((current) => Math.min(STEP_LABELS.length - 1, current + 1));
  }

  function handleCreate() {
    const allSelected = selected.size === sources.length;
    const queue_scope: QueueScope = allSelected
      ? { type: "all" }
      : { type: "source", source_ids: [...selected] };
    createTask.mutate(
      { name, level, fields, queue_scope },
      { onSuccess: () => navigate(`/p/${slug}`) },
    );
  }

  const selectedTraceCount = sources
    .filter((source) => selected.has(source.id))
    .reduce((sum, source) => sum + source.trace_count, 0);

  return (
    <WizardShell
      step={step}
      stepLabels={STEP_LABELS}
      subtitle={STEP_SUBTITLES[step]}
      wide={step === 3}
      error={error}
      onStepClick={goToStep}
      onCancel={() => navigate(`/p/${slug}`)}
      onBack={goBack}
      onNext={goNext}
      isLastStep={step === STEP_LABELS.length - 1}
      isSubmitting={createTask.isPending}
    >
      {step === 0 && <NameStep name={name} onChange={setName} />}

      {step === 1 && (
        <SourcesStep
          sources={sources}
          selected={selected}
          onToggle={toggleSource}
          onSelectAll={() => setSelectedSourceIds(new Set(sources.map((s) => s.id)))}
          onSelectNone={() => setSelectedSourceIds(new Set())}
          selectedTraceCount={selectedTraceCount}
        />
      )}

      {step === 2 && (
        <LevelStep level={level} onChange={setLevel} selectedTraceCount={selectedTraceCount} />
      )}

      {step === 3 && <RubricStep fields={fields} onChange={setFields} />}

      {step === 4 && (
        <ReviewStep
          name={name}
          level={level}
          sources={sources}
          selected={selected}
          selectedTraceCount={selectedTraceCount}
          fields={fields}
          onEditStep={goToStep}
        />
      )}
    </WizardShell>
  );
}
