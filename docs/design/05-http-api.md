# 05 — HTTP API

FastAPI, JSON only, served from the same process/port as the SPA. Because one `serve` process
is bound to exactly one task + annotator, the API carries **no task or annotator parameters**;
the server injects them. Static SPA served at `/`; API under `/api`. No auth (loopback only).

## 1. Endpoints

```
GET  /api/session                → SessionInfo        (task, schema, settings — fetched once at boot)
GET  /api/queue                  → QueueEntry[]        (ordered trace list + per-trace status)
GET  /api/traces/{trace_id}      → TraceDetail         (turns + my annotations + suggestions)
PUT  /api/annotations            → AnnotationOut       (upsert; the ONLY write endpoint)
GET  /api/progress               → Progress
```

Deliberately minimal: no DELETE (re-label or re-skip to change), no export endpoint
(export is CLI-only, invariant #10), no task CRUD.

## 2. Schemas (Pydantic / TypeScript-equivalent)

```typescript
// GET /api/session
interface SessionInfo {
  task: string;
  level: "turn" | "trace";
  fields: ResolvedField[];        // canonical dicts from 03 §6, IN ORDER (order drives hotkeys)
  label_roles: string[];
  annotator: string;
  schema_hash: string;
  shuffle: boolean;
}
interface ResolvedField {
  name: string; label: string;
  type: "single_select" | "multi_select" | "text";
  required: boolean;
  options?: string[];             // selects; order = hotkey numbering 1..9
  placeholder?: string; help?: string;
}

// GET /api/queue  (drives the progress drawer and n/p navigation)
interface QueueEntry {
  trace_id: string;
  position: number;               // 0-based position in task order (post-shuffle)
  n_targets: number;              // labelable turns (turn level) or 1 (trace level)
  n_labeled: number;
  n_skipped: number;              // done ⇔ n_labeled + n_skipped == n_targets
}

// GET /api/traces/{id}
interface TraceDetail {
  trace: { id: string; source?: string; metadata: object };
  turns: Turn[];                  // ALL turns incl. non-labelable (context), ordered by idx
  document?: DocumentDetail;      // set iff the trace is a document (content non-null); turns is [] then
  annotations: Record<string, AnnotationOut>;   // keyed by target_id, this task+annotator only
  suggestions: Record<string, SuggestionOut>;   // keyed by target_id
}
interface DocumentDetail {
  content: string;
  content_type: "text" | "json" | "html" | "markdown";
}
interface Turn {
  id: string;                     // "{trace_id}#{idx}"
  idx: number;
  role: "system" | "user" | "assistant" | "tool";
  content: string;                // verbatim; if content_type=="parts", JSON-serialized parts
  content_type: "text" | "json" | "html" | "parts";
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  labelable: boolean;             // server-computed: role ∈ label_roles && level == "turn"
  metadata: object;
}

// PUT /api/annotations
interface AnnotationIn {
  target_type: "turn" | "trace";
  target_id: string;
  status: "labeled" | "skipped";
  values: Record<string, string | string[]>;    // keyed by field name
  prefill_model?: string | null;                // set when the form was seeded from a suggestion
}
interface AnnotationOut extends AnnotationIn {
  schema_hash: string; annotator: string;
  created_at: string; updated_at: string;
}

interface SuggestionOut {
  target_id: string;
  values: Record<string, string | string[]>;
  model: string;
  created_at: string;
}

// GET /api/progress
interface Progress {
  unit: "turns" | "traces";
  total: number; labeled: number; skipped: number;
}
```

`total`/`labeled`/`skipped` are scoped to the traces in *this session's queue* (the file just
served, per 04 §2/10 §3) — not the whole db pool. Two sessions serving different files against
the same task report different progress even though annotations accumulate in one shared table;
`serve --all` reports against the whole db instead. `GET /api/queue` was already scoped this way
(it iterates the server's in-memory queue); `/api/progress` matches it for consistency. Only
`/api/traces/{id}` and `PUT /api/annotations` stay unscoped — any known trace id remains a valid
target regardless of the current queue.

## 3. Write-path validation (server is the enforcer)

`PUT /api/annotations` validates against the task's resolved schema before writing
(the frontend also validates, but the server is authoritative):

```python
def validate(ann: AnnotationIn, schema, level, conn):
    field = {f["name"]: f for f in schema}
    if ann.target_type != level: raise 422("target_type must match task level")
    assert_target_exists_and_labelable(conn, ann)          # 404 / 422
    if ann.status == "skipped":
        if ann.values: raise 422("skipped annotations carry no values")
        return
    for name, val in ann.values.items():
        f = field.get(name) or raise_422(f"unknown field '{name}'")
        match f["type"]:
            case "single_select":
                if val not in f["options"]: raise 422(f"'{val}' not an option of {name}")
            case "multi_select":
                if not isinstance(val, list) or not set(val) <= set(f["options"]) \
                   or len(val) != len(set(val)): raise 422(...)
            case "text":
                if not isinstance(val, str): raise 422(...)
    for f in schema:
        if f["required"] and not truthy(ann.values.get(f["name"])):
            raise 422(f"required field '{f['name']}' missing")
```

On success the server performs the upsert (02 §6) with the task's current `schema_hash`
and returns the stored row. Writes are synchronous — the UI's "saved" indicator reflects
the actual db state.

## 4. Errors

Standard FastAPI problem shape: `{"detail": "<human-readable, actionable message>"}` with
correct status codes (404 unknown trace/target, 422 validation, 409 reserved for future
concurrent-writer conflicts). No stack traces to the client.

## 5. Static serving

`GET /` and unknown non-`/api` paths → `index.html` (SPA routing). Assets served from the
package's bundled `static/` dir with immutable cache headers (hashed filenames from Vite).
