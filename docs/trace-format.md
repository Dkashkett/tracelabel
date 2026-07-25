# The tracelabel Trace Format (CTF v2)

This is the input contract for tracelabel. If your data is in this shape, `tracelabel serve
traces.jsonl` just works. **The format is the API** — it is stable, versioned, and everything
(the renderer, exports, and structural fields like span/agent/timing) is defined against it.

If your traces come from a known source, an adapter probably already produces this shape for you
(Google ADK sessions, Datadog LLM-observability spans, OpenTelemetry GenAI spans). This document
describes the target that adapters emit and that you can write by hand.

## 1. File shape

A dataset is a UTF-8 **JSONL** file: one JSON object per line. Each line is **either** a
conversation trace (§2, has `messages`) **or** a document (§5, has `content` and no `messages`).

## 2. Trace object

```jsonc
{
  "format_version": 2,            // OPTIONAL int, assumed 1 if absent. Accepts 1 or 2.
  "id": "conv_8842",              // OPTIONAL string. See identity rules (§6).
  "source": "adk",                // OPTIONAL string, set by adapters ("adk", "datadog", "otel", "jsonl", ...)
  "metadata": { "env": "prod" },  // OPTIONAL object, arbitrary user metadata. Shown in the UI drawer.
  "messages": [ ... ],            // REQUIRED non-empty array of Message objects (§3)
  "raw": { ... }                  // OPTIONAL object. Adapter passthrough of unmapped source fields.
}
```

Unknown top-level keys are preserved into `raw` on import, warned once per file, and never fatal.

## 3. Message object

Modeled on the OpenAI chat-completions message shape, plus tracelabel extensions. The base shape
below (v1) is a complete, valid message on its own — everything past it (v2) is optional and
additive, for traces with agent/span structure worth showing.

```jsonc
{
  "role": "assistant",            // REQUIRED: "system" | "user" | "assistant" | "tool" | "event"
  "content": <Content>,           // REQUIRED (may be "" only for assistant msgs with tool_calls, or any event row)
  "tool_calls": [                 // OPTIONAL, assistant role only
    {
      "id": "call_abc",
      "type": "function",
      "function": { "name": "search", "arguments": "{\"q\": \"...\"}" }  // arguments: raw string, never reparsed
    }
  ],
  "tool_call_id": "call_abc",     // OPTIONAL, tool role only; links a result to its call
  "name": "search",               // OPTIONAL display name (tool name, agent name, event name)
  "metadata": { },                // OPTIONAL per-turn metadata (model, tokens_in, tokens_out, cost, ...)
  "raw": { }                      // OPTIONAL adapter passthrough
}
```

Unknown message-level keys are handled the same way as unknown top-level keys: preserved into that
message's `raw`, warned once per file, never fatal.

### Role semantics

| Role | Meaning | Labelable by default |
|------|---------|----------------------|
| `system` | System prompt | no |
| `user` | Human/user input | no |
| `assistant` | Agent output (may carry `tool_calls`) | **yes** |
| `tool` | Tool result; set `tool_call_id` when known | no |
| `event` | Structural span with no conversational content (§3.1) | **never** |

Tool calls are represented **inline on the assistant turn** (`tool_calls`), with each result as a
separate `tool` turn — never as synthetic assistant turns. This is the modeling decision agent
traces live or die on.

### 3.1 Structural fields (optional, all default to absent)

Span-shaped things that aren't conversational content — handoffs between agents, retrieval
spans, agent-invocation boundaries, guardrail checks — become `role: "event"` rows instead of
being force-fit into a chat role. Any row (event or otherwise) may also carry:

| Field | Type | Meaning |
|---|---|---|
| `span_id` | str | Source span/event id |
| `parent_id` | str | Parent span id (presentation-only, not queried) |
| `agent` | str | Which agent/sub-agent produced this row |
| `kind` | str | **Required** on `event` rows, forbidden elsewhere: `handoff` \| `retrieval` \| `agent` \| `guardrail` \| `span` |
| `started_at` | str | ISO-8601 start time |
| `duration_ms` | float | Duration in milliseconds |
| `status` | `"ok"` \| `"error"` | Outcome |
| `status_message` | str | Error detail |

`kind: "handoff"` renders as a divider between agent sections in the UI; the rest surface as
compact, expandable event rows. None of this is required — `{"messages":[{"role":"user",...}]}`
is a complete trace either way, and a plain chat export never needs any of it.

## 4. Content

`content` is **either** a plain string **or** an array of parts:

```jsonc
// Option A: string
"content": "Here is the answer..."

// Option B: parts array (mixed / multimodal-ready)
"content": [
  { "type": "text", "text": "I found this record:" },
  { "type": "json", "json_string": "{\"user\": 42}" },   // raw string, stored verbatim
  { "type": "html", "html": "<table>...</table>" }
]
```

Part types: `text`, `json`, `html`. `json` carries `json_string` (a string, not a parsed object)
so content is never reformatted. Images are out of scope; the parts array is the extension point.

### Content-type detection (string content only)

tracelabel *tags* the type of string content at import; it never rewrites it. The stored
`content_type` is set by:

```
def detect_content_type(s):
    t = s.strip()
    if t.startswith(("{", "[")) and parses_as_json(t): return "json"
    if t[:15].lower().startswith(("<!doctype html", "<html")): return "html"
    return "text"
```

Adapters may override detection explicitly. Parts arrays store `content_type = "parts"`.

## 5. Documents (freeform text / JSON / HTML / Markdown)

A document is its **own top-level shape**, not a message — a line with a `content` key and no
`messages` key:

```jsonc
{
  "id": "notes.md",                        // OPTIONAL
  "content": "# Title\n\nBody text.",      // REQUIRED string, verbatim
  "content_type": "markdown"               // OPTIONAL: "text" | "json" | "html" | "markdown"; defaults to "text"
}
```

`tracelabel import` also accepts a bare string per line (`"Just a plain line of text."`, defaults
to `content_type: "text"`) or a directory of `.md`/`.txt`/`.html` files, one document per file.
A document has zero turns and labels at the trace level — there's nothing to break into turns.

## 6. Identity & hashing

- **`trace.id`**: if the source provides `id`, it is used **verbatim**. Otherwise it is derived:
  `id = "t_" + sha256(canonical_json(messages))[:32]`.
- **`content_hash`** (stored per trace, not part of the file): `sha256_hex(canonical_json(messages))`.
  Structural fields (§3.1) participate like any other field — an adapter upgrade that adds them
  changes the hash, so a re-import under the same id hits the ordinary content-conflict path
  rather than silently changing what existing annotations reference.
- **`canonical_json(x)`**: `json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
  applied to the messages array after adapter mapping, before any storage.
- **Turn id**: `"{trace_id}#{index}"` where `index` is the 0-based position in `messages`. This is
  the annotation target for turn-level tasks. It is deterministic and survives re-import and merges.

Because identity is derived from content, importing the same file twice is idempotent — the same
input always yields the same ids.

## 7. Validation rules

The importer enforces these; a bad line is rejected with the file/line, the failing rule, and a
shown-fixed example. Default is fail-fast; `--skip-invalid` imports the valid lines and prints a
summary.

1. `messages` present, non-empty; every element has a valid `role` and a `content` key.
2. `tool_calls` only on `assistant`; `tool_call_id` only on `tool`.
3. `kind` is required iff `role == "event"`; `kind`/`status`, if present, must be one of their
   valid values (§3.1).
4. `content` may be `""` only when `tool_calls` is present and non-empty, or on any `event` row.
5. `format_version`, if present, must be 1 or 2.
6. A duplicate `id` **within one file** is a hard error (it names both line numbers).

## 8. Examples

### Agent trace with tool use

```json
{"id":"conv_1","metadata":{"model":"gpt-4o"},"messages":[
  {"role":"user","content":"What's AAPL trading at?"},
  {"role":"assistant","content":"","tool_calls":[{"id":"c1","type":"function","function":{"name":"quote","arguments":"{\"ticker\":\"AAPL\"}"}}]},
  {"role":"tool","tool_call_id":"c1","name":"quote","content":"{\"price\": 212.4}"},
  {"role":"assistant","content":"AAPL is trading at $212.40."}
]}
```

### Multi-agent trace with a handoff and a failed tool call

```json
{"id":"conv_2","format_version":2,"messages":[
  {"role":"user","content":"Research fusion energy and summarize it."},
  {"role":"assistant","agent":"Researcher","content":"","tool_calls":[{"id":"c1","type":"function","function":{"name":"web_search","arguments":"{\"query\":\"fusion energy\"}"}}]},
  {"role":"tool","tool_call_id":"c1","name":"web_search","agent":"Researcher","duration_ms":812.0,"status":"error","status_message":"search backend timeout","content":"timeout after 5s"},
  {"role":"event","kind":"handoff","content":"","agent":"Researcher","metadata":{"from":"Researcher","to":"Writer"}},
  {"role":"assistant","agent":"Writer","content":"Fusion energy research continues to progress steadily."}
]}
```

### Freeform HTML document

```json
{"id":"page_17","content":"<html><body><h1>Refund policy</h1>...</body></html>","content_type":"html"}
```

## 9. Versioning policy

`format_version` bumps only on breaking changes. Additive optional fields do not bump it — v2's
eight structural fields didn't; v2 bumped because it adds a new *role* (`event`) that a v1-only
reader wouldn't know how to handle. The importer rejects versions greater than it knows with a
"please upgrade tracelabel" message.
