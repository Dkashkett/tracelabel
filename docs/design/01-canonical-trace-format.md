# 01 — Canonical Trace Format (CTF v1)

This is the contract of the entire tool. Import adapters produce it, the renderer assumes it,
exports reference it, and future span offsets index into it. **Change this doc before changing
any code that touches it.**

## 1. File shape

A dataset is a UTF-8 **JSONL** file: one JSON object per line, one object per **line item**.
Each line item is **either** a conversation trace (§2, has `messages`) **or** a document (§5,
has `content` and no `messages`) — two honest shapes, dispatched by key presence, not a shared
schema.

## 2. Trace object

```jsonc
{
  "format_version": 1,            // OPTIONAL int, assumed 1 if absent. Reject if > 1.
  "id": "conv_8842",              // OPTIONAL string. See identity rules (§6).
  "source": "adk",                // OPTIONAL string, set by adapters ("adk", "datadog", "jsonl", ...)
  "metadata": { "env": "prod" },  // OPTIONAL object, arbitrary user metadata. Shown in UI drawer.
  "messages": [ ... ],            // REQUIRED non-empty array of Message objects (§3)
  "raw": { ... }                  // OPTIONAL object. Adapter passthrough of unmapped source fields.
}
```

Unknown top-level keys: preserved into `raw` on import, warned once per file, never fatal.

## 3. Message object

Modeled on the OpenAI chat-completions message shape, plus TraceLabel extensions.

```jsonc
{
  "role": "assistant",            // REQUIRED: "system" | "user" | "assistant" | "tool"
  "content": <Content>,           // REQUIRED (may be "" only for assistant msgs that carry tool_calls)
  "tool_calls": [                 // OPTIONAL, assistant role only
    {
      "id": "call_abc",
      "type": "function",
      "function": { "name": "search", "arguments": "{\"q\": \"...\"}" }  // arguments: raw string, never parsed/reformatted
    }
  ],
  "tool_call_id": "call_abc",     // OPTIONAL, tool role only; links result to call
  "name": "search",               // OPTIONAL display name (tool name, agent name)
  "metadata": { },                // OPTIONAL per-turn metadata (latency_ms, model, span_id, ...)
  "raw": { }                      // OPTIONAL adapter passthrough
}
```

Unknown message-level keys are handled the same way as unknown top-level keys (§2):
preserved into that message's `raw` on import, warned once per file, never fatal.

### Role semantics

| Role | Meaning | Labelable by default |
|------|---------|----------------------|
| `system` | System prompt | no |
| `user` | Human/user input | no |
| `assistant` | Agent output (may carry `tool_calls`) | **yes** |
| `tool` | Tool result, must set `tool_call_id` when known | no |

Freeform content (text/JSON/HTML/Markdown) is not a message role — it's a **document** (§5),
a distinct top-level shape with zero turns.

Tool calls are represented **inline on the assistant turn** (`tool_calls`), with results as
separate `tool` turns — never as synthetic assistant turns. This is the decision agent traces
live or die on; adapters must conform.

## 4. Content

`content` is **either** a plain string **or** an array of parts:

```jsonc
// Option A: string
"content": "Here is the answer..."

// Option B: parts array (mixed/multimodal-ready)
"content": [
  { "type": "text", "text": "I found this record:" },
  { "type": "json", "json_string": "{\"user\": 42}" },   // raw string, stored verbatim
  { "type": "html", "html": "<table>...</table>" }
]
```

Part types in v1: `text`, `json`, `html`. `json` carries `json_string` (a string, not a parsed
object) to honor the never-reformat invariant. Images are out of scope for v1; the parts array
is the extension point.

### Content-type detection (string content only)

Detection tags; it never rewrites. Applied at import to set the turn's stored `content_type`:

```
def detect_content_type(s: str) -> str:
    t = s.strip()
    if t.startswith(("{", "[")) and parses_as_json(t): return "json"
    if t[:15].lower().startswith(("<!doctype html", "<html")):  return "html"
    return "text"
```

Adapters may override detection explicitly. Parts arrays store `content_type = "parts"`.

## 5. Documents (freeform text / JSON / HTML / Markdown)

A document is its own top-level shape, not a message:

```jsonc
{
  "format_version": 1,                  // OPTIONAL int, same rule as §2
  "id": "notes.md",                     // OPTIONAL string. See identity rules (§6).
  "source": "documents",                // OPTIONAL string, set by adapters/directory scan
  "metadata": { "path": "docs/notes.md" }, // OPTIONAL object
  "content": "# Title\n\nBody text.",   // REQUIRED string, verbatim
  "content_type": "markdown",           // OPTIONAL: "text" | "json" | "html" | "markdown"; defaults to "text"
  "raw": { ... }                        // OPTIONAL adapter passthrough
}
```

A line is parsed as a document iff it has a `content` key and **no** `messages` key (§7 rule 1).
Storage-wise a document is a trace with `content`/`content_type` set and **zero turns** — it
flows through queue, counts, and trace-level annotations exactly like a conversation trace, but
has nothing to render turn-by-turn. `content_type` adds `markdown` on top of the turn
`ContentType` set (§4) because Markdown is a document-only rendering concern; conversation
turns never carry it (assistant markdown still renders as `text`, verbatim).

`tracelabel import` also accepts a bare string per JSONL line (content_type defaults to
`"text"`) or a directory of `.md`/`.txt`/`.html` files (07 §4) as documents.

## 6. Identity & hashing (normative)

- **`trace.id`**: if the source provides `id`, it is used **verbatim**. Otherwise it is derived:
  `id = "t_" + sha256(canonical_json(messages))[:32]`.
- **`content_hash`** (stored per trace, not part of the file format):
  `sha256_hex(canonical_json(messages))` — full 64 chars.
- **`canonical_json(x)`**: `json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
  applied to the messages array **after** adapter mapping, **before** any storage.
- **Turn id**: `"{trace_id}#{index}"` where `index` is the 0-based position in `messages`.
  This string is the annotation `target_id` for turn-level tasks. It is deterministic and
  survives re-import and db merges.
- **`document.id`**: if the source provides `id`, it is used **verbatim** (the directory scan
  sets it to the filename, `#` sanitized to `_`, since turn ids use `#` as a separator).
  Otherwise derived: `id = "d_" + sha256(content)[:32]`.
- **document `content_hash`**: `sha256_hex(canonical_json({"content": content, "content_type":
  content_type}))` — content_type participates so an explicit content_type change is a
  detectable content change, not silently ignored.

## 7. Validation rules (importer MUST enforce)

1. A line with a `content` key and no `messages` key is validated as a **document**: `content`
   must be a string, and `content_type`, if present, must be one of `text`/`json`/`html`/`markdown`.
   Otherwise it's validated as a conversation trace (rules 2–4 below).
2. `messages` present, non-empty, every element has a valid `role` and a `content` key.
3. `tool_calls` only on `assistant`; `tool_call_id` only on `tool`.
4. `content` may be `""` only when `tool_calls` is present and non-empty.
5. `format_version`, if present, must equal 1.
6. Duplicate `id` **within one file** is a hard error (points at both line numbers), across
   both traces and documents.

On any line failure: report `file:line`, the failing rule, and a **shown-fixed example** of that
line (see 07 §5). Default is fail-fast; `--skip-invalid` imports valid lines and prints a summary.

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
{"id":"page_17","content":"<html><body><h1>Refund policy</h1>...</body></html>","content_type":"html"}
```

### Bare document (content_type defaults to "text")

```json
"Just a plain line of text."
```

## 9. Versioning policy

`format_version` bumps only on breaking changes to this doc. Additive optional fields do not
bump it. The importer must reject versions greater than it knows, with a "please upgrade
tracelabel" message.
