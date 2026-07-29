import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ImportIn, ImportPreviewIn } from "@/api/types";
import { usePreviewImport, useStartImport } from "@/api/queries/imports";
import { useJob } from "@/api/queries/jobs";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  DatabaseIcon,
  FileIcon,
  UploadIcon,
} from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import {
  Notice,
  PageFrame,
  PageHeader,
  SectionCard,
  SectionHeading,
} from "@/components/ui/layout";
import { Progress } from "@/components/ui/progress";
import { Stepper } from "@/components/ui/stepper";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { DropZone } from "./DropZone";
import { TracePreview } from "./TracePreview";

type SourceMode = "content" | "path";

function buildSource(
  mode: SourceMode,
  content: string,
  path: string,
): { content?: string; path?: string } | null {
  if (mode === "content") return content.trim() ? { content } : null;
  return path.trim() ? { path } : null;
}

const STEPS = ["Source", "Review", "Import"] as const;
const POLL_INTERVAL_MS = 500;

export default function ImportWizard() {
  const { project } = useParams<{ project: string }>();
  const projectSlug = project ?? "";

  const [mode, setMode] = useState<SourceMode>("content");
  const [content, setContent] = useState("");
  const [path, setPath] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [fromOverride, setFromOverride] = useState("");
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [includeAllSpans, setIncludeAllSpans] = useState(false);
  const [asDocuments, setAsDocuments] = useState(false);
  const [onConflict, setOnConflict] = useState<"fail" | "skip">("fail");
  const [importName, setImportName] = useState("");

  const preview = usePreviewImport(projectSlug);
  const startImport = useStartImport(projectSlug);
  const [jobId, setJobId] = useState<string | undefined>(undefined);
  const job = useJob(jobId);
  const jobDone = job.data?.state === "done" || job.data?.state === "error";

  useEffect(() => {
    if (!jobId || jobDone) return;
    const timer = window.setInterval(() => {
      void job.refetch();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobDone]);

  const step = jobId ? 2 : preview.data ? 1 : 0;
  const sourceLabel = useMemo(
    () => fileName ?? (mode === "path" ? path.trim() : "Pasted content"),
    [fileName, mode, path],
  );

  const handlePreview = () => {
    const source = buildSource(mode, content, path);
    if (!source) {
      setValidationError(
        mode === "content"
          ? "Paste some content or drop a file first."
          : "Enter a server-local path first.",
      );
      return;
    }
    setValidationError(null);
    const input: ImportPreviewIn = {
      ...source,
      from: fromOverride.trim() || undefined,
      as_documents: asDocuments || undefined,
      include_all_spans: includeAllSpans || undefined,
    };
    preview.mutate(input);
  };

  const handleImport = () => {
    const source = buildSource(mode, content, path);
    if (!source) return;
    setValidationError(null);
    const input: ImportIn = {
      ...source,
      name: importName.trim() || fileName || "pasted import",
      from: fromOverride.trim() || undefined,
      on_conflict: onConflict,
      skip_invalid: skipInvalid || undefined,
      as_documents: asDocuments || undefined,
      include_all_spans: includeAllSpans || undefined,
    };
    startImport.mutate(input, {
      onSuccess: (ref) => setJobId(ref.job_id),
    });
  };

  function changeSource() {
    preview.reset();
    startImport.reset();
    setJobId(undefined);
    setValidationError(null);
  }

  return (
    <PageFrame width="wide">
      <Link
        to={`/p/${projectSlug}`}
        className="mb-5 inline-flex items-center gap-1.5 rounded-md text-xs text-ink-muted outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back to project
      </Link>

      <PageHeader
        eyebrow="Add source"
        title={`Import into ${projectSlug}`}
        description="Preview and validate trace data before anything is written to the project."
      />
      <Stepper steps={STEPS} current={step} className="mt-8 max-w-2xl" />

      {step === 0 && (
        <SectionCard className="mt-8 overflow-hidden">
          <div className="p-5 sm:p-7">
            <SectionHeading
              title="Choose a source"
              description="Drop a file, paste its contents, or reference a path available to the local server."
            />

            <div
              role="radiogroup"
              aria-label="Source type"
              className="mt-5 grid rounded-xl border border-line bg-surface-inset p-1 sm:grid-cols-2"
            >
              {(
                [
                  ["content", "File or pasted content", UploadIcon],
                  ["path", "Server-local path", DatabaseIcon],
                ] as const
              ).map(([value, label, ModeIcon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => {
                    setMode(value);
                    setValidationError(null);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent/60",
                    mode === value
                      ? "bg-surface-overlay text-ink shadow-card"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  <ModeIcon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            {mode === "content" ? (
              <div className="mt-5 space-y-3">
                <DropZone
                  fileName={fileName}
                  onFileText={(text, name) => {
                    setContent(text);
                    setFileName(name);
                    setValidationError(null);
                  }}
                />
                <div className="flex items-center gap-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                    or paste
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>
                <Textarea
                  placeholder="…or paste trace JSON / text here"
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setValidationError(null);
                  }}
                  rows={7}
                  className="font-mono text-xs"
                />
              </div>
            ) : (
              <div className="mt-5">
                <label htmlFor="import-path" className="text-xs font-semibold text-ink">
                  Local path
                </label>
                <Input
                  id="import-path"
                  type="text"
                  placeholder="/path/to/traces.jsonl"
                  value={path}
                  onChange={(event) => {
                    setPath(event.target.value);
                    setValidationError(null);
                  }}
                  className="mt-2 font-mono text-xs"
                />
                <p className="mt-2 text-xs leading-5 text-ink-faint">
                  The path must be readable by the tracelabel process on this machine.
                </p>
              </div>
            )}

            {validationError && (
              <Notice className="mt-4" tone="danger">
                {validationError}
              </Notice>
            )}
            {preview.isError && (
              <Notice className="mt-4" tone="danger" title="Preview failed">
                {(preview.error as Error).message}
              </Notice>
            )}
          </div>
          <footer className="flex justify-end border-t border-line bg-surface-inset/30 px-5 py-4 sm:px-7">
            <Button type="button" onClick={handlePreview} disabled={preview.isPending}>
              {preview.isPending ? "Previewing…" : "Preview"}
              {!preview.isPending && <ArrowRightIcon className="h-4 w-4" />}
            </Button>
          </footer>
        </SectionCard>
      )}

      {step === 1 && preview.data && (
        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5">
            <SectionCard className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-4 border-b border-line p-5 sm:p-6">
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-pass/25 bg-pass/10 text-pass">
                  <CheckIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-ink">
                    Detected: {preview.data.adapter} · {preview.data.trace_count ?? "?"} traces
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px] text-ink-muted">
                    {sourceLabel}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={changeSource}>
                  Change source
                </Button>
              </div>

              {(preview.data.errors.length > 0 || preview.data.notes.length > 0) && (
                <div className="space-y-3 border-b border-line p-5 sm:p-6">
                  {preview.data.errors.map((message, index) => (
                    <Notice key={`error-${index}`} tone="danger">
                      {message}
                    </Notice>
                  ))}
                  {preview.data.notes.map((message, index) => (
                    <Notice key={`note-${index}`}>{message}</Notice>
                  ))}
                </div>
              )}

              <div className="p-5 sm:p-6">
                <SectionHeading
                  eyebrow="Sample"
                  title="Trace preview"
                  description={`Showing ${Math.min(3, preview.data.traces.length)} representative ${
                    preview.data.traces.length === 1 ? "trace" : "traces"
                  } exactly as they will appear while labeling.`}
                />
                <div className="mt-5 space-y-4">
                  {preview.data.traces.slice(0, 3).map((trace, index) => (
                    <div key={trace.trace.id}>
                      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                        {String(index + 1).padStart(2, "0")} · {trace.trace.id}
                      </p>
                      <TracePreview trace={trace} />
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
          </div>

          <SectionCard className="overflow-hidden lg:sticky lg:top-6">
            <div className="p-5">
              <SectionHeading title="Import settings" description="Name this source and confirm how duplicates are handled." />

              <label className="mt-5 block">
                <span className="text-xs font-semibold text-ink">Source name</span>
                <Input
                  type="text"
                  placeholder={fileName ?? "pasted import"}
                  value={importName}
                  onChange={(event) => setImportName(event.target.value)}
                  className="mt-2"
                />
              </label>

              <details className="group mt-5 rounded-xl border border-line-strong bg-surface-inset/45">
                <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-ink outline-none marker:hidden">
                  <span className="flex items-center justify-between">
                    Advanced options
                    <span className="text-ink-faint transition-transform group-open:rotate-90">›</span>
                  </span>
                </summary>
                <div className="space-y-4 border-t border-line px-4 py-4 text-xs">
                  <label className="block">
                    <span className="font-medium text-ink-muted">Adapter override</span>
                    <Input
                      size="sm"
                      placeholder="auto"
                      value={fromOverride}
                      onChange={(event) => setFromOverride(event.target.value)}
                      className="mt-1.5 font-mono text-xs"
                    />
                  </label>
                  {[
                    ["skip-invalid", "Skip invalid traces", skipInvalid, setSkipInvalid],
                    ["all-spans", "Include all spans", includeAllSpans, setIncludeAllSpans],
                    ["documents", "Import as documents", asDocuments, setAsDocuments],
                  ].map(([id, label, checked, setter]) => (
                    <label key={String(id)} className="flex cursor-pointer items-start gap-2.5 text-ink-muted">
                      <input
                        type="checkbox"
                        checked={Boolean(checked)}
                        onChange={(event) =>
                          (setter as React.Dispatch<React.SetStateAction<boolean>>)(
                            event.target.checked,
                          )
                        }
                        className="mt-0.5"
                      />
                      {String(label)}
                    </label>
                  ))}
                  <fieldset>
                    <legend className="font-medium text-ink-muted">On duplicate trace ID</legend>
                    <div className="mt-2 grid grid-cols-2 rounded-lg border border-line bg-surface-inset p-1">
                      {(["fail", "skip"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={onConflict === value}
                          onClick={() => setOnConflict(value)}
                          className={cn(
                            "rounded-md px-2 py-1.5 capitalize outline-none",
                            onConflict === value
                              ? "bg-surface-overlay text-ink"
                              : "text-ink-muted hover:text-ink",
                          )}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </details>

              {startImport.isError && (
                <Notice className="mt-4" tone="danger">
                  {(startImport.error as Error).message}
                </Notice>
              )}
            </div>
            <div className="border-t border-line bg-surface-inset/30 p-4">
              <Button
                type="button"
                className="w-full"
                onClick={handleImport}
                disabled={startImport.isPending}
              >
                <UploadIcon className="h-4 w-4" />
                {startImport.isPending ? "Starting import…" : "Import"}
              </Button>
            </div>
          </SectionCard>
        </div>
      )}

      {step === 2 && (
        <SectionCard className="mt-8 overflow-hidden">
          <div className="grid min-h-96 place-items-center p-6 text-center">
            <div className="w-full max-w-lg">
              <span
                className={cn(
                  "mx-auto grid h-14 w-14 place-items-center rounded-2xl border",
                  job.data?.state === "done"
                    ? "border-pass/30 bg-pass/10 text-pass"
                    : job.data?.state === "error"
                      ? "border-fail/30 bg-fail/10 text-fail"
                      : "border-accent/30 bg-accent/10 text-accent-strong",
                )}
              >
                {job.data?.state === "done" ? (
                  <CheckIcon className="h-7 w-7" />
                ) : (
                  <FileIcon className="h-7 w-7" />
                )}
              </span>

              {job.data?.state === "done" ? (
                <>
                  <h2 className="mt-5 text-xl font-semibold tracking-tight text-ink">
                    Import complete.
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-ink-muted">
                    The source is ready for new or existing labeling tasks.
                  </p>
                  <Link
                    to={`/p/${projectSlug}`}
                    className={buttonClassName({ className: "mt-6" })}
                  >
                    View project
                    <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                </>
              ) : job.data?.state === "error" ? (
                <>
                  <h2 className="mt-5 text-xl font-semibold tracking-tight text-ink">
                    Import failed
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-fail">
                    {job.data.error ?? "Import failed."}
                  </p>
                  <Button variant="outline" className="mt-6" onClick={changeSource}>
                    Try another source
                  </Button>
                </>
              ) : (
                <>
                  <h2 className="mt-5 text-xl font-semibold tracking-tight text-ink">
                    Importing traces
                  </h2>
                  <p className="mt-2 text-sm text-ink-muted">
                    Validating and writing the source locally…
                  </p>
                  <Progress className="mt-6" value={(job.data?.progress ?? 0) * 100} />
                  <p className="mt-2 font-mono text-xs text-ink-faint">
                    {Math.round((job.data?.progress ?? 0) * 100)}%
                  </p>
                </>
              )}
            </div>
          </div>
        </SectionCard>
      )}
    </PageFrame>
  );
}
