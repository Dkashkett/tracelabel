// Mock import pipeline + a generic job store. The job store is shared with
// mocks/tasks.ts (suggestions also run as background jobs) — imports.ts owns it
// since imports were the first thing in the app to need one.
import type { ImportIn, ImportPreview, ImportPreviewIn, JobRef, JobStatus } from "@/api/types";
import { addSource } from "@/mocks/projects";
import { sampleTraces } from "@/mocks/labeling";

// ── generic job store ──
//
// The backend's JobStatus only carries a 0..1 `progress` fraction and an opaque
// `result` (see jobs.py's JobSnapshot) — no step count or human-readable message.
// The mock keeps those extra bookkeeping fields (`total`/`current`/`message`)
// internally so the simulated progress bar has something to animate, and folds
// `message` into `result` once the job finishes.
interface JobRecord {
  job_id: string;
  state: JobStatus["state"];
  total: number;
  current: number;
  message: string;
  error: string | null;
}

const jobs = new Map<string, JobRecord>();
let nextJobId = 1;

function toStatus(record: JobRecord): JobStatus {
  return {
    job_id: record.job_id,
    state: record.state,
    progress: record.total > 0 ? record.current / record.total : 0,
    result: record.state === "done" ? { message: record.message } : null,
    error: record.error,
  };
}

export function createJob(total: number, message: string): JobRef {
  const job_id = `job_${nextJobId++}`;
  const record: JobRecord = { job_id, state: "pending", total, current: 0, message, error: null };
  jobs.set(job_id, record);
  runJob(job_id);
  return { job_id };
}

function runJob(job_id: string): void {
  const record = jobs.get(job_id);
  if (!record) return;
  record.state = "running";
  const step = () => {
    const current = jobs.get(job_id);
    if (!current) return;
    current.current = Math.min(
      current.total,
      current.current + Math.max(1, Math.ceil(current.total / 5)),
    );
    if (current.current >= current.total) {
      current.state = "done";
      current.current = current.total;
      return;
    }
    setTimeout(step, 200);
  };
  setTimeout(step, 150);
}

export function getJob(job_id: string): JobStatus | undefined {
  const record = jobs.get(job_id);
  return record ? toStatus(record) : undefined;
}

// ── import preview / commit ──

function detectAdapter(input: ImportPreviewIn | ImportIn): string {
  if (input.from && input.from !== "auto") return input.from;
  const hint = input.path ?? input.content ?? "";
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
    notes: [],
  };
}

export function startImport(projectSlug: string, input: ImportIn): JobRef {
  const adapter = detectAdapter(input);
  const traceCount = sampleTraces().length * 137;
  const name = input.name ?? "pasted import";
  const job = createJob(traceCount, `Importing ${name}…`);
  // The mock commits the source immediately; a real backend would do this when the job finishes.
  addSource(projectSlug, {
    name,
    path: input.path ?? null,
    adapter,
    imported_at: new Date().toISOString(),
    trace_count: traceCount,
  });
  return job;
}
