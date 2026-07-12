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
}
export interface DocumentDetail {
  content: string;
  content_type: "text" | "json" | "html" | "markdown";
}
export interface Turn {
  id: string; // "{trace_id}#{idx}"
  idx: number;
  role: "system" | "user" | "assistant" | "tool";
  content: string; // verbatim; if content_type=="parts", JSON-serialized parts
  content_type: "text" | "json" | "html" | "parts";
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  labelable: boolean; // server-computed: role ∈ label_roles && level == "turn"
  metadata: object;
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
