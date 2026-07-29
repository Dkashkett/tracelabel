// Import wizard (docs/refactor-plan.md §4 F2-IMPORT): drop zone / paste / path ->
// preview (detected adapter + trace count + first 3 traces rendered) -> Import,
// with a "from"/"skip_invalid"/"include_all_spans"/"on_conflict"/"as_documents"
// Advanced section.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ImportIn, ImportPreviewIn } from "@/api/types";
import { usePreviewImport, useStartImport } from "@/api/queries/imports";
import { useJob } from "@/api/queries/jobs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { DropZone } from "./DropZone";
import { TracePreview } from "./TracePreview";

type SourceMode = "content" | "path";

// The backend's ImportService._resolved_path treats path/content as mutually
// exclusive (docs/refactor-plan.md F2-IMPORT note). The mode toggle below only ever
// sends the field for the active mode, so this is mostly a UI-level guarantee — but
// we still validate explicitly so a blank submission gets a clear message instead of
// a silent no-op request.
function buildSource(
  mode: SourceMode,
  content: string,
  path: string,
): { content?: string; path?: string } | null {
  if (mode === "content") {
    return content.trim() ? { content } : null;
  }
  return path.trim() ? { path } : null;
}

const POLL_INTERVAL_MS = 500;

export default function ImportWizard() {
  const { project } = useParams<{ project: string }>();
  const projectSlug = project ?? "";

  const [mode, setMode] = useState<SourceMode>("content");
  const [content, setContent] = useState("");
  const [path, setPath] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Advanced options.
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

  // useJob (api/queries/jobs.ts) deliberately leaves polling to the caller. Poll on a
  // fixed short interval while a job is in flight, and stop once it reaches a
  // terminal state so we don't keep hitting the server after the result is final.
  useEffect(() => {
    if (!jobId || jobDone) return;
    const timer = setInterval(() => {
      void job.refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, jobDone]);

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
    if (!source) {
      setValidationError(
        mode === "content"
          ? "Paste some content or drop a file first."
          : "Enter a server-local path first.",
      );
      return;
    }
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

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="text-lg font-semibold">Import into {projectSlug}</h1>

      <div className="mt-6 space-y-3">
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="source-mode"
              checked={mode === "content"}
              onChange={() => setMode("content")}
            />
            Paste or drop a file
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="source-mode"
              checked={mode === "path"}
              onChange={() => setMode("path")}
            />
            Server-local path
          </label>
        </div>

        {mode === "content" ? (
          <div className="space-y-2">
            <DropZone
              fileName={fileName}
              onFileText={(text, name) => {
                setContent(text);
                setFileName(name);
              }}
            />
            <Textarea
              placeholder="…or paste trace JSON / text here"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={6}
            />
          </div>
        ) : (
          <input
            type="text"
            placeholder="/path/to/traces.jsonl"
            value={path}
            onChange={(event) => setPath(event.target.value)}
            className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          />
        )}

        {validationError && <p className="text-sm text-fail">{validationError}</p>}

        <Button type="button" onClick={handlePreview} disabled={preview.isPending}>
          {preview.isPending ? "Previewing…" : "Preview"}
        </Button>
        {preview.isError && <p className="text-sm text-fail">{(preview.error as Error).message}</p>}
      </div>

      {preview.data && (
        <div className="mt-8 space-y-4">
          <p className="text-sm font-medium text-ink">
            Detected: {preview.data.adapter} · {preview.data.trace_count ?? "?"} traces
          </p>

          {preview.data.errors.length > 0 && (
            <ul className="list-inside list-disc text-sm text-fail">
              {preview.data.errors.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          )}
          {preview.data.notes.length > 0 && (
            <ul className="list-inside list-disc text-sm text-ink-muted">
              {preview.data.notes.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          )}

          <div className="space-y-4">
            {preview.data.traces.slice(0, 3).map((trace) => (
              <TracePreview key={trace.trace.id} trace={trace} />
            ))}
          </div>
        </div>
      )}

      <details className="mt-8 rounded-lg border border-line p-4">
        <summary className="cursor-pointer text-sm font-medium text-ink">Advanced</summary>
        <div className="mt-4 space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-ink-muted">Adapter override</span>
            <input
              type="text"
              placeholder="auto"
              value={fromOverride}
              onChange={(event) => setFromOverride(event.target.value)}
              className="flex-1 rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint"
            />
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={skipInvalid}
              onChange={(event) => setSkipInvalid(event.target.checked)}
            />
            Skip invalid traces instead of failing the import
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeAllSpans}
              onChange={(event) => setIncludeAllSpans(event.target.checked)}
            />
            Include all spans (not just labelable ones)
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={asDocuments}
              onChange={(event) => setAsDocuments(event.target.checked)}
            />
            Import as documents
          </label>

          <div className="flex items-center gap-4">
            <span className="w-40 shrink-0 text-ink-muted">On conflict</span>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="on-conflict"
                checked={onConflict === "fail"}
                onChange={() => setOnConflict("fail")}
              />
              Fail
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="on-conflict"
                checked={onConflict === "skip"}
                onChange={() => setOnConflict("skip")}
              />
              Skip
            </label>
          </div>
        </div>
      </details>

      <div className="mt-8 space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="w-40 shrink-0 text-ink-muted">Import name</span>
          <input
            type="text"
            placeholder={fileName ?? "pasted import"}
            value={importName}
            onChange={(event) => setImportName(event.target.value)}
            className="flex-1 rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint"
          />
        </label>

        <Button
          type="button"
          onClick={handleImport}
          disabled={!preview.data || startImport.isPending || (!!jobId && !jobDone)}
        >
          Import
        </Button>
        {startImport.isError && (
          <p className="text-sm text-fail">{(startImport.error as Error).message}</p>
        )}
      </div>

      {jobId && job.data && (
        <div className="mt-6 space-y-2">
          <Progress value={job.data.progress * 100} />
          {job.data.state === "done" && (
            <p className="text-sm text-pass">
              Import complete.{" "}
              <Link to={`/p/${projectSlug}`} className="underline">
                Back to project
              </Link>
            </p>
          )}
          {job.data.state === "error" && (
            <p className="text-sm text-fail">{job.data.error ?? "Import failed."}</p>
          )}
          {(job.data.state === "pending" || job.data.state === "running") && (
            <p className="text-sm text-ink-muted">Importing…</p>
          )}
        </div>
      )}
    </div>
  );
}
