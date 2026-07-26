// Mock import pipeline + a generic job store. The job store is shared with
// mocks/tasks.ts (suggestions also run as background jobs) — imports.ts owns it
// since imports were the first thing in the app to need one.
import type { ImportIn, ImportPreview, ImportPreviewIn, JobRef, JobStatus } from "@/api/types";
import { addSource } from "@/mocks/projects";
import { sampleTraces } from "@/mocks/labeling";

// ── generic job store ──

interface JobRecord extends JobStatus {}

const jobs = new Map<string, JobRecord>();
let nextJobId = 1;

export function createJob(total: number, message: string): JobRef {
  const job_id = `job_${nextJobId++}`;
  const record: JobRecord = { job_id, status: "pending", progress: 0, total, message, error: null };
  jobs.set(job_id, record);
  runJob(job_id);
  return { job_id };
}

function runJob(job_id: string): void {
  const record = jobs.get(job_id);
  if (!record) return;
  record.status = "running";
  const step = () => {
    const current = jobs.get(job_id);
    if (!current) return;
    current.progress = Math.min(current.total, current.progress + Math.max(1, Math.ceil(current.total / 5)));
    if (current.progress >= current.total) {
      current.status = "done";
      current.progress = current.total;
      return;
    }
    setTimeout(step, 200);
  };
  setTimeout(step, 150);
}

export function getJob(job_id: string): JobStatus | undefined {
  const record = jobs.get(job_id);
  return record ? { ...record } : undefined;
}

// ── import preview / commit ──

function detectAdapter(input: ImportPreviewIn): string {
  if (input.adapter) return input.adapter;
  const hint = input.path ?? input.paste ?? "";
  if (hint.includes("adk")) return "adk";
  if (hint.includes("datadog")) return "datadog";
  if (/\.(md|markdown|html|htm|txt)$/i.test(hint)) return "documents";
  return "ctf";
}

export function previewImport(input: ImportPreviewIn): ImportPreview {
  const traces = sampleTraces().slice(0, 3);
  return {
    adapter: detectAdapter(input),
    trace_count: traces.length * 137, // pretend the full source is bigger than the preview
    traces,
    errors: [],
  };
}

export function startImport(projectSlug: string, input: ImportIn): JobRef {
  const adapter = detectAdapter(input);
  const traceCount = sampleTraces().length * 137;
  const job = createJob(traceCount, `Importing ${input.source_name}…`);
  // The mock commits the source immediately; a real backend would do this when the job finishes.
  addSource(projectSlug, {
    name: input.source_name,
    path: input.path ?? null,
    adapter,
    imported_at: new Date().toISOString(),
    trace_count: traceCount,
  });
  return job;
}
