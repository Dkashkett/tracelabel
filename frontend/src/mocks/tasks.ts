// Mock backing store for tasks, their rubric (schema), item pages, stats, and
// suggestion runs. Depends on mocks/projects.ts (one-directional: tasks know about
// projects, projects don't know about tasks) and mocks/imports.ts for the shared
// job store that suggestion runs also use.
import type {
  FieldDef,
  ItemPage,
  ItemSummary,
  JobRef,
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
    progress: { unit: "turns", total: 0, labeled: 0, skipped: 0 },
    fields: PASS_FAIL_FIELDS,
    label_roles: ["assistant"],
    shuffle: false,
    schema_hash: "sha256:demo0000",
    compat_hash: "sha256:compat0000",
    queue_scope: { type: "all" },
    llm: null,
    suggest_instructions: null,
    review_of: null,
    review_labels_from: "judge",
    ...overrides,
  };
}

const tasks = new Map<string, Map<string, TaskDetail>>([
  [
    "support-triage",
    new Map([
      [
        "escalation-risk",
        makeTask({
          name: "escalation-risk",
          progress: { unit: "turns", total: 412, labeled: 260, skipped: 12 },
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
          progress: { unit: "traces", total: 189, labeled: 40, skipped: 0 },
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
          progress: { unit: "turns", total: 58, labeled: 58, skipped: 0 },
          review_of: "gpt-4o",
          review_labels_from: "judge",
        }),
      ],
    ]),
  ],
]);

function taskMap(projectSlug: string): Map<string, TaskDetail> {
  let m = tasks.get(projectSlug);
  if (!m) {
    m = new Map();
    tasks.set(projectSlug, m);
  }
  return m;
}

function toSummary(task: TaskDetail): TaskSummary {
  const { name, level, annotator, created_at, progress } = task;
  return { name, level, annotator, created_at, progress };
}

export function listTasks(projectSlug: string): TaskSummary[] {
  return [...taskMap(projectSlug).values()].map(toSummary);
}

export function getTask(projectSlug: string, name: string): TaskDetail | undefined {
  return taskMap(projectSlug).get(name);
}

export function createTask(projectSlug: string, input: TaskCreate): TaskDetail {
  if (!getProject(projectSlug)) throw new Error(`unknown project '${projectSlug}'`);
  const task = makeTask({
    name: input.name,
    level: input.level,
    fields: input.fields,
    label_roles: input.label_roles ?? ["assistant"],
    shuffle: input.shuffle ?? false,
    annotator: input.annotator ?? "dan",
    queue_scope: input.queue_scope ?? { type: "all" },
    llm: input.llm ?? null,
    suggest_instructions: input.suggest_instructions ?? null,
    review_of: input.review_of ?? null,
    review_labels_from: input.review_labels_from ?? "judge",
  });
  taskMap(projectSlug).set(task.name, task);
  bumpTaskCount(projectSlug, 1);
  return task;
}

export function patchTask(projectSlug: string, name: string, patch: TaskPatch): TaskDetail {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  Object.assign(task, patch);
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
  const retypedFields = task.fields
    .filter((f) => newByName.has(f.name) && newByName.get(f.name)!.type !== f.type)
    .map((f) => f.name);
  const removedOptions: { field: string; option: string }[] = [];
  for (const oldField of task.fields) {
    const newField = newByName.get(oldField.name);
    if (!newField || !oldField.options) continue;
    for (const option of oldField.options) {
      if (!newField.options?.includes(option)) removedOptions.push({ field: oldField.name, option });
    }
  }
  const breaking = removedFields.length > 0 || retypedFields.length > 0 || removedOptions.length > 0;
  return {
    removed_fields: removedFields,
    retyped_fields: retypedFields,
    removed_options: removedOptions,
    affected_annotations: breaking ? Math.round(task.progress.labeled * 0.6) : 0,
    breaking,
  };
}

export function patchSchema(projectSlug: string, name: string, patch: SchemaPatch): SchemaOut {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  task.fields = patch.fields;
  task.schema_hash = `sha256:${Math.random().toString(16).slice(2, 10)}`;
  task.compat_hash = `sha256:${Math.random().toString(16).slice(2, 10)}`;
  return { fields: task.fields, schema_hash: task.schema_hash, compat_hash: task.compat_hash };
}

export function getItems(projectSlug: string, name: string, page: number, pageSize: number): ItemPage {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  const items: ItemSummary[] = Array.from({ length: task.progress.total }, (_, i) => {
    const isLabeled = i < task.progress.labeled;
    const isSkipped = !isLabeled && i < task.progress.labeled + task.progress.skipped;
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
  const { total, labeled, skipped } = task.progress;
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
  const remaining = task.progress.total - task.progress.labeled - task.progress.skipped;
  return createJob(Math.max(remaining, 1), `Suggesting with ${input.model}…`);
}

export function exportTask(projectSlug: string, name: string): Blob {
  const task = getTask(projectSlug, name);
  if (!task) throw new Error(`unknown task '${projectSlug}/${name}'`);
  const header = task.fields.map((f) => f.name).join(",");
  const rows = [`target_id,status,${header}`, `demo_item_0,labeled,${task.fields.map(() => "demo").join(",")}`];
  return new Blob([rows.join("\n")], { type: "text/csv" });
}
