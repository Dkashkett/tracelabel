# The tracelabel Trace Format (CTF v1)

This is the input contract for tracelabel. If your data is in this shape, `tracelabel serve
traces.jsonl` just works. **The format is the API** — it is stable, versioned, and everything
(the renderer, exports, and future span-offset tagging) is defined against it.

If your traces come from a known source, an adapter probably already produces this shape for you
(e.g. Google ADK sessions, Datadog LLM-observability spans). This document describes the target
that adapters emit and that you can write by hand.

## 1. File shape

A dataset is a UTF-8 **JSONL** file: one JSON object per line, one object per **trace**.

## 2. Trace object

```jsonc
{
  "format_version": 1,            // OPTIONAL int, assumed 1 if absent. Rejected if > 1.
  "id": "conv_8842",              // OPTIONAL string. See identity rules (§6).
  "source": "adk",                // OPTIONAL string, set by adapters ("adk", "datadog", "jsonl", ...)
  "metadata": { "env": "prod" },  // OPTIONAL object, arbitrary user metadata. Shown in the UI drawer.
  "messages": [ ... ],            // REQUIRED non-empty array of Message objects (§3)
  "raw": { ... }                  // OPTIONAL object. Adapter passthrough of unmapped source fields.
}
```

Unknown top-level keys are preserved into `raw` on import, warned once per file, and never fatal.

## 3. Message object

Modeled on the OpenAI chat-completions message shape, plus a couple of tracelabel extensions.

```jsonc
{
  "role": "assistant",            // REQUIRED: "system" | "user" | "assistant" | "tool" | "document"
  "content": <Content>,           // REQUIRED (may be "" only for assistant msgs that carry tool_calls)
  "tool_calls": [                 // OPTIONAL, assistant role only
    {
      "id": "call_abc",
      "type": "function",
      "function": { "name": "search", "arguments": "{\"q\": \"...\"}" }  // arguments: raw string, never reparsed
    }
  ],
  "tool_call_id": "call_abc",     // OPTIONAL, tool role only; links a result to its call
  "name": "search",               // OPTIONAL display name (tool name, agent name)
  "metadata": { },                // OPTIONAL per-turn metadata (latency_ms, model, span_id, ...)
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
| `document` | Freeform text/JSON/HTML content in a single-turn trace | **yes** |

Tool calls are represented **inline on the assistant turn** (`tool_calls`), with each result as a
separate `tool` turn — never as synthetic assistant turns. This is the modeling decision agent
traces live or die on.

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

Part types in v1: `text`, `json`, `html`. `json` carries `json_string` (a string, not a parsed
object) so content is never reformatted. Images are out of scope for v1; the parts array is the
extension point.

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

## 5. Documents (freeform text / JSON / HTML)

A document is a trace with exactly one message of role `document`. `tracelabel import` also accepts
bare documents and wraps them for you. This gives documents and conversations one rendering path
and one labeling path.

## 6. Identity & hashing

- **`trace.id`**: if the source provides `id`, it is used **verbatim**. Otherwise it is derived:
  `id = "t_" + sha256(canonical_json(messages))[:32]`.
- **`content_hash`** (stored per trace, not part of the file): `sha256_hex(canonical_json(messages))`.
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
3. `content` may be `""` only when `tool_calls` is present and non-empty.
4. A `document` role may only appear in single-message traces.
5. `format_version`, if present, must equal 1.
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

### Freeform HTML document

```json
{"id":"page_17","messages":[{"role":"document","content":"<html><body><h1>Refund policy</h1>...</body></html>"}]}
```

## 9. Versioning policy

`format_version` bumps only on breaking changes. Additive optional fields do not bump it. The
importer rejects versions greater than it knows with a "please upgrade tracelabel" message.
