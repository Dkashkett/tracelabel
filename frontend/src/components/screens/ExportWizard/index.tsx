import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useExportTask } from "@/api/queries/exports";
import { useProject } from "@/api/queries/projects";
import type { ExportQuery } from "@/api/client/exports";
import { Button } from "@/components/ui/button";
import { RadioCard } from "@/components/ui/radio-card";
import { cn } from "@/lib/utils";

type ExportFormat = NonNullable<ExportQuery["format"]>;
type ExportStatus = NonNullable<ExportQuery["status"]>;

const STEPS = ["Format", "Data", "Review"] as const;

const STATUS_OPTIONS: {
  value: ExportStatus;
  label: string;
  description: string;
}[] = [
  {
    value: "all",
    label: "All annotations",
    description: "Labeled and intentionally skipped records",
  },
  {
    value: "labeled",
    label: "Labeled only",
    description: "Only records with completed rubric values",
  },
  {
    value: "skipped",
    label: "Skipped only",
    description: "Only records marked as skipped",
  },
];

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 20h14" />
    </svg>
  );
}

function FileIcon({ format }: { format: ExportFormat }) {
  return (
    <div className="relative grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line bg-surface-inset text-ink-muted">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
        aria-hidden
      >
        <path d="M6 2.75h7l5 5V21.25H6z" />
        <path d="M13 2.75v5h5" />
      </svg>
      <span className="absolute -bottom-1.5 -right-1.5 rounded-md bg-accent px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase leading-none text-accent-fg">
        {format}
      </span>
    </div>
  );
}

function Stepper({ step, onStepClick }: { step: number; onStepClick: (step: number) => void }) {
  return (
    <ol className="mt-8 flex max-w-xl items-center" aria-label="Export progress">
      {STEPS.map((label, index) => {
        const complete = index < step;
        const current = index === step;
        return (
          <li key={label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              disabled={!complete}
              onClick={() => onStepClick(index)}
              aria-current={current ? "step" : undefined}
              className={cn(
                "group flex items-center gap-2 text-xs font-medium outline-none",
                complete ? "cursor-pointer text-ink-muted hover:text-ink" : "cursor-default",
                current && "text-ink",
                !complete && !current && "text-ink-faint",
              )}
            >
              <span
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors",
                  complete && "border-accent bg-accent text-accent-fg",
                  current && "border-accent bg-accent/10 text-accent-strong shadow-glow",
                  !complete && !current && "border-line bg-surface text-ink-faint",
                )}
              >
                {complete ? "✓" : index + 1}
              </span>
              {label}
            </button>
            {index < STEPS.length - 1 && (
              <span
                className={cn("mx-3 h-px flex-1", complete ? "bg-accent" : "bg-line")}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SectionHeading({ children, detail }: { children: ReactNode; detail: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold tracking-tight text-ink">{children}</h2>
      <p className="mt-1 text-sm leading-6 text-ink-muted">{detail}</p>
    </div>
  );
}

function FormatStep({
  format,
  onChange,
}: {
  format: ExportFormat;
  onChange: (format: ExportFormat) => void;
}) {
  return (
    <div>
      <SectionHeading detail="Choose the file type that fits where your annotations are going next.">
        Choose a format
      </SectionHeading>
      <div className="mt-5 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="File format">
        <RadioCard
          checked={format === "jsonl"}
          onSelect={() => onChange("jsonl")}
          className="relative min-h-48 overflow-hidden p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <FileIcon format="jsonl" />
            <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-accent-strong">
              Recommended
            </span>
          </div>
          <h3 className="mt-5 text-sm font-semibold text-ink">JSON Lines</h3>
          <p className="mt-1.5 text-xs leading-5 text-ink-muted">
            One complete JSON object per line. Best for pipelines, scripts, and nested values.
          </p>
          <code className="mt-4 block truncate rounded-md bg-surface-inset px-2.5 py-2 font-mono text-[10px] text-ink-faint">
            {`{"target_id":"trace_01","status":"labeled"}`}
          </code>
        </RadioCard>

        <RadioCard
          checked={format === "csv"}
          onSelect={() => onChange("csv")}
          className="min-h-48 p-5"
        >
          <FileIcon format="csv" />
          <h3 className="mt-5 text-sm font-semibold text-ink">CSV</h3>
          <p className="mt-1.5 text-xs leading-5 text-ink-muted">
            A familiar flat table. Best for spreadsheets, quick analysis, and sharing.
          </p>
          <code className="mt-4 block truncate rounded-md bg-surface-inset px-2.5 py-2 font-mono text-[10px] text-ink-faint">
            target_id,status,verdict
          </code>
        </RadioCard>
      </div>
    </div>
  );
}

function DataStep({
  status,
  joined,
  onStatusChange,
  onJoinedChange,
}: {
  status: ExportStatus;
  joined: boolean;
  onStatusChange: (status: ExportStatus) => void;
  onJoinedChange: (joined: boolean) => void;
}) {
  return (
    <div>
      <SectionHeading detail="Control which annotation rows are included in the export.">
        Select your data
      </SectionHeading>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Records</p>
        <div
          className="mt-2 grid rounded-xl border border-line bg-surface-inset p-1 sm:grid-cols-3"
          role="radiogroup"
          aria-label="Annotation status"
        >
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={status === option.value}
              onClick={() => onStatusChange(option.value)}
              className={cn(
                "rounded-lg px-3 py-3 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent/50",
                status === option.value
                  ? "bg-surface-raised text-ink shadow-card"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              <span className="block text-xs font-semibold">{option.label}</span>
              <span className="mt-1 block text-[10px] leading-4 text-ink-faint">
                {option.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Source data</p>
        <button
          type="button"
          role="switch"
          aria-checked={joined}
          onClick={() => onJoinedChange(!joined)}
          className={cn(
            "mt-2 flex w-full items-center gap-4 rounded-xl border p-4 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent/50",
            joined
              ? "border-accent bg-accent/5 ring-1 ring-accent/20"
              : "border-line bg-surface-raised hover:border-line-strong",
          )}
        >
          <span
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors",
              joined ? "bg-accent" : "bg-surface-inset",
            )}
            aria-hidden
          >
            <span
              className={cn(
                "absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                joined ? "translate-x-6" : "translate-x-1",
              )}
            />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">Include original source data</span>
            <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
              Join trace content and metadata to each annotation for a self-contained dataset.
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

function ReviewStep({
  format,
  status,
  joined,
  taskName,
  addressed,
}: {
  format: ExportFormat;
  status: ExportStatus;
  joined: boolean;
  taskName: string;
  addressed: number;
}) {
  const statusLabel = STATUS_OPTIONS.find((option) => option.value === status)?.label;
  return (
    <div>
      <SectionHeading detail="Everything looks ready. Your download will start as soon as the export is built.">
        Review your export
      </SectionHeading>

      <div className="mt-5 overflow-hidden rounded-xl border border-line bg-surface-raised">
        <div className="flex items-center gap-4 border-b border-line p-5">
          <FileIcon format={format} />
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-medium text-ink">
              {taskName}-annotations.{format}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {status === "all" ? `${addressed.toLocaleString()} addressed records` : statusLabel}
            </p>
          </div>
        </div>
        <dl className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-4">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Format
            </dt>
            <dd className="mt-1.5 text-xs font-medium text-ink">
              {format === "jsonl" ? "JSON Lines" : "CSV"}
            </dd>
          </div>
          <div className="p-4">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Records
            </dt>
            <dd className="mt-1.5 text-xs font-medium text-ink">{statusLabel}</dd>
          </div>
          <div className="p-4">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Source data
            </dt>
            <dd className="mt-1.5 text-xs font-medium text-ink">
              {joined ? "Included" : "Annotations only"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 flex gap-3 rounded-lg border border-line bg-surface-inset/60 p-3.5">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10v6M12 7h.01" />
        </svg>
        <p className="text-xs leading-5 text-ink-muted">
          Exports are generated locally from this project. No data is sent to another service.
        </p>
      </div>
    </div>
  );
}

function ExportSummary({
  taskName,
  format,
  status,
  joined,
}: {
  taskName: string;
  format: ExportFormat;
  status: ExportStatus;
  joined: boolean;
}) {
  const statusLabel = STATUS_OPTIONS.find((option) => option.value === status)?.label;
  return (
    <aside className="rounded-xl border border-line bg-surface/70 p-5 shadow-card lg:sticky lg:top-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Export summary</p>
      <div className="mt-4 flex items-center gap-3">
        <FileIcon format={format} />
        <p className="min-w-0 truncate font-mono text-xs text-ink">
          {taskName}-annotations.{format}
        </p>
      </div>
      <dl className="mt-5 divide-y divide-line text-xs">
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="text-ink-faint">Format</dt>
          <dd className="font-medium text-ink">{format === "jsonl" ? "JSON Lines" : "CSV"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="text-ink-faint">Records</dt>
          <dd className="font-medium text-ink">{statusLabel}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-3">
          <dt className="text-ink-faint">Source data</dt>
          <dd className="font-medium text-ink">{joined ? "Included" : "Not included"}</dd>
        </div>
      </dl>
    </aside>
  );
}

function startDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function ExportWizard() {
  const { project: projectSlug = "", task: taskName = "" } = useParams<{
    project: string;
    task: string;
  }>();
  const navigate = useNavigate();
  const { data: project, isLoading, isError } = useProject(projectSlug);
  const exportTask = useExportTask(projectSlug, taskName);
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<ExportFormat>("jsonl");
  const [status, setStatus] = useState<ExportStatus>("all");
  const [joined, setJoined] = useState(false);

  if (isLoading) {
    return <div className="p-8 text-sm text-ink-muted">Loading export options…</div>;
  }

  const task = project?.tasks.find((candidate) => candidate.name === taskName);
  if (isError || !project || !task) {
    return <div className="p-8 text-sm text-ink-muted">Task not found.</div>;
  }

  function handleExport() {
    exportTask.mutate(
      { format, status, joined },
      {
        onSuccess: (blob) => {
          startDownload(blob, `${taskName}-annotations.${format}`);
        },
      },
    );
  }

  const onNext = () => {
    if (step < STEPS.length - 1) {
      setStep((current) => current + 1);
      return;
    }
    handleExport();
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <Link
        to={`/p/${projectSlug}`}
        className="inline-flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
      >
        <span aria-hidden>←</span>
        Back to {project.name}
      </Link>

      <header className="mt-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-accent-strong">
            <DownloadIcon className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">Export annotations</h1>
            <p className="mt-0.5 text-sm text-ink-muted">
              From <span className="font-mono text-xs text-ink">{taskName}</span>
            </p>
          </div>
        </div>
        <Stepper
          step={step}
          onStepClick={(nextStep) => {
            setStep(nextStep);
            exportTask.reset();
          }}
        />
      </header>

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-7">
          <div className="min-h-[22rem]">
            {step === 0 && <FormatStep format={format} onChange={setFormat} />}
            {step === 1 && (
              <DataStep
                status={status}
                joined={joined}
                onStatusChange={setStatus}
                onJoinedChange={setJoined}
              />
            )}
            {step === 2 && (
              <ReviewStep
                format={format}
                status={status}
                joined={joined}
                taskName={taskName}
                addressed={task.addressed}
              />
            )}
          </div>

          {exportTask.isError && (
            <p role="alert" className="mt-4 text-xs text-fail">
              Export failed: {(exportTask.error as Error).message}
            </p>
          )}
          {exportTask.isSuccess && (
            <p role="status" className="mt-4 text-xs text-pass">
              Download started. You can export again with the same settings.
            </p>
          )}

          <footer className="mt-6 flex items-center justify-between border-t border-line pt-5">
            <Button variant="ghost" onClick={() => navigate(`/p/${projectSlug}`)}>
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              {step > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep((current) => current - 1);
                    exportTask.reset();
                  }}
                >
                  Back
                </Button>
              )}
              <Button onClick={onNext} disabled={exportTask.isPending}>
                {step === STEPS.length - 1 ? (
                  <>
                    <DownloadIcon className="mr-1.5 h-4 w-4" />
                    {exportTask.isPending
                      ? "Preparing…"
                      : exportTask.isSuccess
                        ? "Download again"
                        : "Export & download"}
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </div>
          </footer>
        </section>

        <ExportSummary taskName={taskName} format={format} status={status} joined={joined} />
      </div>
    </main>
  );
}
