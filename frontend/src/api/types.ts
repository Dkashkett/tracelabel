// Copied verbatim from docs/design/05-http-api.md §2. This file is the frontend's only
// contract with the backend; do not edit it except to track that spec section.

// GET /api/session
export interface SessionInfo {
  task: string;
  level: "turn" | "trace";
  fields: ResolvedField[]; // canonical dicts from 03 §6, IN ORDER (order drives hotkeys)
  label_roles: string[];
  annotator: string;
  schema_hash: string;
  shuffle: boolean;
  mode: "labeling" | "review"; // "review" = correcting another annotator's existing labels
  review_of: string | null; // in review mode, the annotator (judge) whose labels are reviewed
}
export interface ResolvedField {
  name: string;
  label: string;
  type: "single_select" | "multi_select" | "text";
  required: boolean;
  options?: string[]; // selects; order = hotkey numbering 1..9
  placeholder?: string;
  help?: string;
}

// GET /api/queue  (drives the progress drawer and n/p navigation)
export interface QueueEntry {
  trace_id: string;
  position: number; // 0-based position in task order (post-shuffle)
  n_targets: number; // labelable turns (turn level) or 1 (trace level)
  n_labeled: number;
  n_skipped: number; // done ⇔ n_labeled + n_skipped == n_targets
}

// GET /api/traces/{id}
export interface TraceDetail {
  trace: { id: string; source?: string; metadata: object };
  turns: Turn[]; // ALL turns incl. non-labelable (context), ordered by idx
  document?: DocumentDetail; // set iff the trace is a document (content non-null); turns is [] then
  annotations: Record<string, AnnotationOut>; // keyed by target_id, this task+annotator only
  suggestions: Record<string, SuggestionOut>; // keyed by target_id
  review_of: Record<string, AnnotationOut>; // review mode: judge labels being reviewed, by target_id
}
export interface DocumentDetail {
  content: string;
  content_type: "text" | "json" | "html" | "markdown";
}
export interface Turn {
  id: string; // "{trace_id}#{idx}"
  idx: number;
  role: "system" | "user" | "assistant" | "tool" | "event";
  content: string; // verbatim; if content_type=="parts", JSON-serialized parts
  content_type: "text" | "json" | "html" | "parts";
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  labelable: boolean; // server-computed: role ∈ label_roles && level == "turn"
  metadata: object;
  span_id?: string | null; // source span/event id
  parent_id?: string | null; // parent span id (presentation-only hierarchy)
  agent?: string | null; // which agent/sub-agent produced this row
  kind?: "handoff" | "retrieval" | "agent" | "guardrail" | "span" | null; // only on role:"event"
  started_at?: string | null; // ISO-8601
  duration_ms?: number | null;
  status?: "ok" | "error" | null;
  status_message?: string | null;
}
export interface ToolCall {
  id?: string;
  type?: string;
  function?: { name: string; arguments: string };
  // The flattened shape remains accepted for mock/legacy API data.
  name?: string;
  arguments?: string; // raw string, stored verbatim
}

// PUT /api/annotations
export interface AnnotationIn {
  target_type: "turn" | "trace";
  target_id: string;
  status: "labeled" | "skipped";
  values: Record<string, string | string[]>; // keyed by field name
  prefill_model?: string | null; // set when the form was seeded from a suggestion
}
export interface AnnotationOut extends AnnotationIn {
  schema_hash: string;
  annotator: string;
  created_at: string;
  updated_at: string;
}

export interface SuggestionOut {
  target_id: string;
  values: Record<string, string | string[]>;
  model: string;
  created_at: string;
}

// GET /api/progress
export interface Progress {
  unit: "turns" | "traces";
  total: number;
  labeled: number;
  skipped: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Everything below is new in the v2 API contract (docs/refactor-plan.md §3).
// The five types above keep their current shapes untouched; only their
// paths move (see the plan). Field-level shapes below are the frontend's
// own hand-synced read of the contract table, since api/models.py (backend)
// is written by a parallel packet in this same wave.
// ─────────────────────────────────────────────────────────────────────────

export type Level = "turn" | "trace";
export type FieldType = "single_select" | "multi_select" | "text";

// A field definition as stored/edited by the rubric editor. Shape mirrors
// config/models.py FieldDef.
export interface FieldDef {
  name: string;
  label?: string | null;
  type: FieldType;
  options?: string[] | null;
  required: boolean;
  placeholder?: string | null;
  help?: string | null;
}

export interface LLMSettings {
  model: string;
  temperature: number;
  max_tokens: number;
}

// { type: "all" } labels everything; { type: "filter" } is Phase 2 (data manager).
export type QueueScope = { type: "all" } | { type: "filter"; [key: string]: unknown };

// ── GET/PATCH /api/settings ──
export interface Settings {
  annotator: string;
  default_llm_model: string | null;
  theme: "light" | "dark" | "system";
}
export interface SettingsPatch {
  annotator?: string;
  default_llm_model?: string | null;
  theme?: "light" | "dark" | "system";
}

// ── /api/projects ──
export interface ProjectSummary {
  slug: string;
  name: string;
  created_at: string;
  notes: string | null;
  task_count: number;
  source_count: number;
}
export interface ProjectCreate {
  name: string;
  notes?: string | null;
}
export interface ProjectDetail extends ProjectSummary {
  tasks: TaskSummary[];
  sources: SourceOut[];
}

// ── GET /api/projects/{p}/sources ──
export interface SourceOut {
  id: number;
  name: string;
  path: string | null;
  adapter: string;
  imported_at: string;
  trace_count: number;
}

// ── /api/projects/{p}/imports ──
export interface ImportPreviewIn {
  path?: string;
  paste?: string;
  adapter?: string | null;
}
export interface ImportPreview {
  adapter: string;
  trace_count: number;
  traces: TraceDetail[];
  errors: string[];
}
export interface ImportIn {
  source_name: string;
  path?: string;
  paste?: string;
  adapter?: string | null;
  from?: string | null;
  skip_invalid: boolean;
  include_all_spans: boolean;
  on_conflict: "skip" | "replace" | "error";
}

// ── GET /api/jobs/{job_id}  (also the response of long-running POSTs) ──
export interface JobRef {
  job_id: string;
}
export interface JobStatus {
  job_id: string;
  status: "pending" | "running" | "done" | "error";
  progress: number;
  total: number;
  message: string | null;
  error: string | null;
}

// ── /api/projects/{p}/tasks ──
export interface TaskSummary {
  name: string;
  level: Level;
  annotator: string;
  created_at: string;
  progress: Progress;
}
export interface TaskCreate {
  name: string;
  level: Level;
  fields: FieldDef[];
  label_roles?: string[];
  shuffle?: boolean;
  annotator?: string;
  queue_scope?: QueueScope;
  llm?: LLMSettings | null;
  suggest_instructions?: string | null;
  review_of?: string | null;
  review_labels_from?: string;
}
export interface TaskDetail extends TaskSummary {
  fields: FieldDef[];
  label_roles: string[];
  shuffle: boolean;
  schema_hash: string;
  compat_hash: string;
  queue_scope: QueueScope;
  llm: LLMSettings | null;
  suggest_instructions: string | null;
  review_of: string | null;
  review_labels_from: string;
}
export interface TaskPatch {
  level?: Level;
  label_roles?: string[];
  shuffle?: boolean;
  annotator?: string;
  queue_scope?: QueueScope;
  llm?: LLMSettings | null;
  suggest_instructions?: string | null;
}

// ── /api/projects/{p}/tasks/{t}/schema ──
export interface SchemaOut {
  fields: FieldDef[];
  schema_hash: string;
  compat_hash: string;
}
export interface SchemaPatch {
  fields: FieldDef[];
}
// 409 response when a PATCH would orphan existing annotations without ?confirm=1.
export interface SchemaImpactOut {
  removed_fields: string[];
  retyped_fields: string[];
  removed_options: { field: string; option: string }[];
  affected_annotations: number;
  breaking: boolean;
}

// ── GET /api/projects/{p}/tasks/{t}/items  (Phase 2 data manager) ──
export interface ItemSummary {
  target_id: string;
  trace_id: string;
  status: "unlabeled" | "labeled" | "skipped";
  values: Record<string, string | string[]> | null;
  annotator: string | null;
  has_suggestion: boolean;
  source: string | null;
}
export interface ItemPage {
  items: ItemSummary[];
  total: number;
  page: number;
  page_size: number;
}

// ── GET /api/projects/{p}/tasks/{t}/stats  (Phase 3 eval loop) ──
export interface TaskStats {
  total: number;
  labeled: number;
  skipped: number;
  agreement: number | null;
  confusion: Record<string, Record<string, number>>;
}

// ── POST /api/projects/{p}/tasks/{t}/suggestions  (Phase 3) ──
export interface SuggestIn {
  model: string;
  limit?: number;
  overwrite?: boolean;
}
