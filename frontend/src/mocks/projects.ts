// Mock backing store for projects and their sources. Kept independent of
// mocks/tasks.ts (no cross-import) so the two mock domains never form a cycle;
// api/client/projects.ts composes ProjectDetail from both when VITE_MOCK=1.
import type { ProjectCreate, ProjectSummary, SourceOut } from "@/api/types";

interface ProjectRecord extends ProjectSummary {
  sources: SourceOut[];
}

const NOW = "2026-07-01T12:00:00Z";

const projects = new Map<string, ProjectRecord>([
  [
    "support-triage",
    {
      slug: "support-triage",
      name: "Support Triage",
      created_at: NOW,
      notes: "Customer support transcripts, escalation labeling.",
      task_count: 2,
      source_count: 2,
      sources: [
        {
          id: 1,
          name: "zendesk-export-2026-06.jsonl",
          path: "/Users/dan/data/zendesk-export-2026-06.jsonl",
          adapter: "ctf",
          imported_at: "2026-06-30T09:00:00Z",
          trace_count: 412,
        },
        {
          id: 2,
          name: "zendesk-export-2026-07.jsonl",
          path: "/Users/dan/data/zendesk-export-2026-07.jsonl",
          adapter: "ctf",
          imported_at: NOW,
          trace_count: 189,
        },
      ],
    },
  ],
  [
    "eval-harness",
    {
      slug: "eval-harness",
      name: "Eval Harness",
      created_at: "2026-06-15T08:00:00Z",
      notes: null,
      task_count: 1,
      source_count: 1,
      sources: [
        {
          id: 3,
          name: "adk-sessions",
          path: "/Users/dan/data/adk-sessions/",
          adapter: "adk",
          imported_at: "2026-06-15T08:05:00Z",
          trace_count: 58,
        },
      ],
    },
  ],
  [
    "new-project",
    {
      slug: "new-project",
      name: "New Project",
      created_at: "2026-07-20T00:00:00Z",
      notes: null,
      task_count: 0,
      source_count: 0,
      sources: [],
    },
  ],
]);

let nextSourceId = 4;

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let slug = base || "project";
  let n = 2;
  while (projects.has(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

export function listProjects(): ProjectSummary[] {
  return [...projects.values()].map(({ sources: _sources, ...summary }) => summary);
}

export function getProject(slug: string): ProjectRecord | undefined {
  return projects.get(slug);
}

export function createProject(input: ProjectCreate): ProjectSummary {
  const slug = slugify(input.name);
  const record: ProjectRecord = {
    slug,
    name: input.name,
    created_at: new Date().toISOString(),
    notes: input.notes ?? null,
    task_count: 0,
    source_count: 0,
    sources: [],
  };
  projects.set(slug, record);
  const { sources: _sources, ...summary } = record;
  return summary;
}

export function deleteProject(slug: string): void {
  projects.delete(slug);
}

export function listSources(slug: string): SourceOut[] {
  return getProject(slug)?.sources ?? [];
}

export function addSource(slug: string, source: Omit<SourceOut, "id">): SourceOut {
  const project = getProject(slug);
  if (!project) throw new Error(`unknown project '${slug}'`);
  const out: SourceOut = { ...source, id: nextSourceId++ };
  project.sources.push(out);
  project.source_count = project.sources.length;
  return out;
}

// Called by mocks/tasks.ts when a task is created, so project.task_count stays in sync
// without the two mock modules importing each other's stores.
export function bumpTaskCount(slug: string, delta: number): void {
  const project = getProject(slug);
  if (project) project.task_count += delta;
}
