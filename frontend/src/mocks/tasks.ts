// Mock backing store for tasks, their rubric (schema), item pages, stats, and
// suggestion runs. Depends on mocks/projects.ts (one-directional: tasks know about
// projects, projects don't know about tasks) and mocks/imports.ts for the shared
// job store that suggestion runs also use.
//
// The backend's TaskDetail/TaskSummary don't carry a labeled/skipped breakdown
// (TaskSummary only has `addressed`, the sum of both) — but the mock item/stats
// endpoints (Phase 2/3) want that breakdown to fabricate believable data. So each
// mock task keeps its progress counts in a side table (`progressStore`), separate
// from the public `TaskDetail` shape, rather than smuggling extra fields onto it.
import type {
  FieldDef,
  ItemPage,
  ItemSummary,
  JobRef,
  RetypedFieldOut,
  SchemaImpactOut,
  SchemaOut,
  SchemaPatch,
  SuggestIn,
  TaskCreate,
  TaskDetail,
  TaskPatch,
  TaskStats,
  TaskSummary,
} from "@/api/types";
import { bumpTaskCount, getProject } from "@/mocks/projects";
import { createJob } from "@/mocks/imports";

const NOW = "2026-07-01T12:00:00Z";

interface MockProgress {
  unit: "turns" | "traces";
  total: number;
  labeled: number;
  skipped: number;
}

const PASS_FAIL_FIELDS: FieldDef[] = [
  {
    name: "verdict",
    label: "Verdict",
    type: "single_select",
    required: true,
    options: ["pass", "fail"],
    help: "Did the turn accomplish its goal?",
  },
  {
    name: "notes",
    label: "Notes",
    type: "text",
    required: false,
    placeholder: "Optional notes…",
  },
];

function makeTask(overrides: Partial<TaskDetail> & Pick<TaskDetail, "name">): TaskDetail {
  return {
    level: "turn",
    annotator: "dan",
    created_at: NOW,
    updated_at: NOW,
    fields: PASS_FAIL_FIELDS,
    label_roles: ["assistant"],
    shuffle: false,
    schema_hash: "sha256:demo0000",
    compat_hash: "sha256:compat0000",
    queue_scope: { type: "all" },
    llm_model: null,
    llm_temperature: null,
    llm_max_tokens: null,
    suggest_instructions: null,
    review_of: null,
    review_labels_from: "judge",
    ...overrides,
  };
}

const progressStore = new Map<string, MockProgress>();

function progressKey(projectSlug: string, name: string): string {
  return `${projectSlug}/${name}`;
}

function setProgress(projectSlug: string, name: string, progress: MockProgress): void {
  progressStore.set(progressKey(projectSlug, name), progress);
}

function getProgress(projectSlug: string, name: string): MockProgress {
  return (
    progressStore.get(progressKey(projectSlug, name)) ?? {
      unit: "turns",
      total: 0,
      labeled: 0,
      skipped: 0,
    }
  );
}

const tasks = new Map<string, Map<string, TaskDetail>>([
  [
    "support-triage",
    new Map([
      [
        "escalation-risk",
        makeTask({
          name: "escalation-risk",
          fields: [
            {
              name: "verdict",
              label: "Escalation risk",
              type: "single_select",
              required: true,
              options: ["low", "medium", "high"],
            },
            {
              name: "failure_modes",
              label: "Failure modes",
              type: "multi_select",
              required: false,
              options: ["tone", "policy_violation", "missing_info", "slow_response"],
            },
          ],
        }),
      ],
      [
        "response-quality",
        makeTask({
          name: "response-quality",
          level: "trace",
          annotator: "priya",
        }),
      ],
    ]),
  ],
  [
    "eval-harness",
    new Map([
      [
        "judge-agreement",
        makeTask({
          name: "judge-agreement",
          annotator: "dan",
          review_of: "gpt-4o",
          review_labels_from: "judge",
        }),
      ],
    ]),
  ],
]);

setProgress("support-triage", "escalation-risk", { unit: "turns", total: 412, labeled: 260, skipped: 12 });
setProgress("support-triage", "response-quality", { unit: "traces", total: 189, labeled: 40, skipped: 0 });
setProgress("eval-harness", "judge-agreement", { unit: "turns", total: 58, labeled: 58, skipped: 0 });

function taskMap(projectSlug: string): Map<string, TaskDetail> {
  let m = tasks.get(projectSlug);
  if (!m) {
    m = new Map();
    tasks.set(projectSlug, m);
  }
  return m;
}

function toSummary(projectSlug: string, task: TaskDetail): TaskSummary {
  const progress = getProgress(projectSlug, task.name);
  return {
    name: task.name,
    level: task.level,
    schema_hash: task.schema_hash,
    compat_hash: task.compat_hash,
    updated_at: task.updated_at,
    total: progress.total,
    addressed: progress.labeled + progress.skipped,
    queue_scope: task.queue_scope,
  };
}

export function listTasks(projectSlug: string): TaskSummary[] {
  return [...taskMap(projectSlug).values()].map((task) => toSummary(projectSlug, task));
}

export function getTask(projectSlug: string, name: string): TaskDetail | undefined {
  return taskMap(projectSlug).get(name);
}

const DEFAULT_FIELDS: FieldDef[] = [{ name: "notes", label: "Notes", type: "text", required: true }];

export function createTask(projectSlug: string, input: TaskCreate): TaskDetail {
  if (!getProject(projectSlug)) throw new Error(`unknown project '${projectSlug}'`);
  const task = makeTask({
    name: input.name,
    level: input.level,
    fields: input.fields ?? DEFAULT_FIELDS,
    label_roles: input.label_roles ?? ["assistant"],
    shuffle: input.shuffle ?? false,
    annotator: input.annotator ?? "dan",
    queue_scope: input.queue_scope ?? { type: "all" },
  });
  taskMap(projectSlug).set(task.name, task);
  setProgress(projectSlug, task.name, { unit: "turns", total: 0, labeled: 0, skipped: 0 });
  bumpTaskCount(projectSlug, 1);
  return task;
}

export function patchTask(projectSlug: string, name: string, patch: TaskPatch): TaskDetail {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  Object.assign(task, patch, { updated_at: new Date().toISOString() });
  return task;
}

export function getSchema(projectSlug: string, name: string): SchemaOut {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  return { fields: task.fields, schema_hash: task.schema_hash, compat_hash: task.compat_hash };
}

// Mirrors the backend's compat-hash split (report §3): removing a field, or removing
// an option that's actually in use, is "breaking" — everything else is cosmetic.
export function analyzeSchemaImpact(
  projectSlug: string,
  name: string,
  patch: SchemaPatch,
): SchemaImpactOut {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  const oldNames = new Set(task.fields.map((f) => f.name));
  const newByName = new Map(patch.fields.map((f) => [f.name, f]));
  const removedFields = [...oldNames].filter((n) => !newByName.has(n));
  const retypedFields: RetypedFieldOut[] = task.fields
    .filter((f) => newByName.has(f.name) && newByName.get(f.name)!.type !== f.type)
    .map((f) => ({ name: f.name, old_type: f.type, new_type: newByName.get(f.name)!.type }));
  const removedOptions: Record<string, string[]> = {};
  for (const oldField of task.fields) {
    const newField = newByName.get(oldField.name);
    if (!newField || !oldField.options) continue;
    const removed = oldField.options.filter((option) => !newField.options?.includes(option));
    if (removed.length > 0) removedOptions[oldField.name] = removed;
  }
  const breaking = removedFields.length > 0 || retypedFields.length > 0 || Object.keys(removedOptions).length > 0;
  const progress = getProgress(projectSlug, name);
  return {
    removed_fields: removedFields,
    retyped_fields: retypedFields,
    removed_options: removedOptions,
    affected_annotations: breaking ? Math.round(progress.labeled * 0.6) : 0,
    breaking,
  };
}

export function patchSchema(projectSlug: string, name: string, patch: SchemaPatch): SchemaOut {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  task.fields = patch.fields;
  task.schema_hash = `sha256:${Math.random().toString(16).slice(2, 10)}`;
  task.compat_hash = `sha256:${Math.random().toString(16).slice(2, 10)}`;
  task.updated_at = new Date().toISOString();
  return { fields: task.fields, schema_hash: task.schema_hash, compat_hash: task.compat_hash };
}

export function getItems(projectSlug: string, name: string, page: number, pageSize: number): ItemPage {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  const progress = getProgress(projectSlug, name);
  const items: ItemSummary[] = Array.from({ length: progress.total }, (_, i) => {
    const isLabeled = i < progress.labeled;
    const isSkipped = !isLabeled && i < progress.labeled + progress.skipped;
    return {
      target_id: `${name}_item_${i}`,
      trace_id: `t_${i}`,
      status: isLabeled ? "labeled" : isSkipped ? "skipped" : "unlabeled",
      values: isLabeled ? { verdict: i % 3 === 0 ? "fail" : "pass" } : null,
      annotator: isLabeled ? task.annotator : null,
      has_suggestion: i % 4 === 0,
      source: "demo",
    };
  });
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, page_size: pageSize };
}

export function getStats(projectSlug: string, name: string): TaskStats {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  const { total, labeled, skipped } = getProgress(projectSlug, name);
  return {
    total,
    labeled,
    skipped,
    agreement: task.review_of ? 0.87 : null,
    confusion: task.review_of
      ? { pass: { pass: 40, fail: 3 }, fail: { pass: 5, fail: 12 } }
      : {},
  };
}

export function startSuggestions(projectSlug: string, name: string, input: SuggestIn): JobRef {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  const { total, labeled, skipped } = getProgress(projectSlug, name);
  const remaining = total - labeled - skipped;
  return createJob(Math.max(remaining, 1), `Suggesting with ${input.model}…`);
}

export function exportTask(projectSlug: string, name: string): Blob {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  const header = task.fields.map((f) => f.name).join(",");
  const rows = [`target_id,status,${header}`, `demo_item_0,labeled,${task.fields.map(() => "demo").join(",")}`];
  return new Blob([rows.join("\n")], { type: "text/csv" });
}
