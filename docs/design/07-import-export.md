# 07 — Import & Export

Core rule: **the core is coupled to nothing but CTF** (doc 01, now v2). Every source goes through
a thin adapter that emits CTF; the importer (02 §4) only ever sees CTF. Be liberal in what we
accept, strict in what we store.

```
source file ─▶ detect/route ─▶ adapter.to_ctf() ─▶ validate CTF ─▶ idempotent insert
```

## 1. Adapter interface

```python
class Adapter(Protocol):
    name: str                                   # "ctf" | "otel" | "adk" | "datadog" | "documents" | "loose"
    # True when to_ctf() must receive every line of the file aggregated into one value
    # (e.g. an OTLP envelope's `{"resourceSpans": [...]}` or Datadog's `{"spans": [...]}`),
    # instead of being called once per line. Set by both otel and datadog; false elsewhere.
    aggregates_input: bool
    def sniff(self, first_values: list[Any]) -> bool: ...     # cheap detection for --from auto
    def to_ctf(self, value: Any) -> Iterator[dict]: ...       # one source value → ≥1 CTF traces/documents
```

Adapters must: map every field they understand, dump everything else into `raw` (trace- and
turn-level), set `source`, and **never reformat content strings** (invariant #1).

## 2. `--from auto` detection (default)

Ordered sniff over the first 5 parsed values; first match wins; ties never happen because the
order is priority:

```python
def detect(first_values) -> Adapter:
    for adapter in [CtfAdapter, OtelAdapter, AdkAdapter, DatadogAdapter, DocumentsAdapter, LooseAdapter]:
        if adapter.sniff(first_values): return adapter
    die_with_format_help()          # §5

# Sniff rules (normative):
# Ctf:        has "messages": list of dicts with "role"
# Otel:       an OTLP/JSON envelope ("resourceSpans" → "scopeSpans" → "spans"), or a bare span
#             list/object with a 32-hex traceId + 16-hex spanId + startTimeUnixNano and NO "meta"
#             key — the no-"meta" guard is what keeps this from ever shadowing Datadog spans,
#             which always carry "meta" and use decimal (not hex) ids
# Adk:        has "events" list with "author"/"invocation_id" keys, or ADK session envelope
# Datadog:    has "spans" (or is a span) with "meta" containing "input.messages"/"output.messages"
# Documents:  a bare string, or a dict with a string "content" and NO "messages"/"role" key
#             (the no-"messages"/"role" guard means a CTF trace or a Loose near-miss is never
#             swallowed as a document — this ordering is why Documents sits before Loose)
# Loose:      handles common near-misses (§3)
```

## 3. LooseAdapter — the bounce-risk killer

Most users arrive with *almost*-CTF data. Accept it:

| Input shape | Mapping |
|---|---|
| bare list of message dicts (`[{"role":..,"content":..}, ...]`) — i.e. a raw OpenAI messages array per line | wrap as `{"messages": [...]}` |
| `{"conversation": [...]}` / `{"turns": [...]}` / `{"chat": [...]}` | rename key to `messages`; note in summary |
| message dicts with `"speaker"`/`"from"` instead of `"role"` | rename; map `human→user`, `ai/bot/agent→assistant` |
| LangSmith-style run exports with `inputs.messages` / `outputs` | best-effort map to messages; extras → `raw` |

A bare string per line, or an object shaped like a document, never reaches LooseAdapter — the
`documents` adapter (§4) sniffs those first.

Anything mapped by LooseAdapter prints one summary line so the user knows what happened
(`interpreted "turns" as "messages" on 412 lines`). Ambiguous beyond these rules → §5 error.

## 4. Documents

Two ways to get freeform text/JSON/HTML/Markdown into a project, both producing `DocumentIn`
(01 §5) rather than a conversation trace.

**JSONL of documents.** Each line is either a bare string, or an object with a required string
`content` and optional `id`/`metadata`/`content_type`:

```jsonl
"Just a plain line of text."
{"content": "# md heading", "content_type": "markdown", "id": "d1"}
```

A bare string defaults `content_type` to `"text"`. An object may set `content_type` explicitly;
one that's shaped like a document (has `content`, no `messages`/`role`) but is missing a string
`content` field is a loud `CtfError` with a fixed example — there is **no** silent
keep-raw-line-verbatim fallback (an earlier version had one; it mislabeled malformed lines
without telling anyone, so it's gone pre-release).

`DocumentsAdapter.sniff` matches a bare string, or a dict with a string `content` and no
`messages`/`role` key — the guard against `messages`/`role` is what keeps CTF traces and Loose
near-misses from ever being swallowed as documents (§2).

**Directory of files** — the folder-of-docs quick start (`tracelabel serve ./docs`,
`tracelabel import ./docs`): a non-recursive scan of `sorted(path.iterdir())`. Files with a
mapped extension import as one document each; hidden files, `.json`/`.jsonl`/`.db`, and unknown
extensions are skipped with a summary note (`"skipped N unsupported files"`); zero importable
files is a `UserError`.

```python
DOCUMENT_EXTENSIONS = {
    ".md": "markdown", ".markdown": "markdown",
    ".txt": "text",    ".text": "text",
    ".html": "html",   ".htm": "html",
}
```

Extension is both the "is this a document" signal for directory scans and the `content_type`
source — no sniffing needed there. Document id = the filename (`notes.md`), with `#`
sanitized to `_` (turn ids use `{trace_id}#{idx}`, so `#` in a trace id would collide with that
scheme); the real path goes in `metadata.path`. Filename ids are stable across content edits and
keep the queue UI (which renders `trace_id`) showing readable names with no frontend change; two
identical files under different names stay distinct since ids are path-derived, not content-hash
derived.

A single bare document file (`tracelabel import notes.md`) is **not** a supported target — it
has no use case distinct from a one-line JSONL or a one-file directory, and it's ambiguous
whether the user meant "this file is a document" or "this file lists documents". Rejected with
a message pointing at a JSONL of documents or a directory of files (loader-level, before any
adapter runs).

`--as-documents` is an alias for `--from documents` on JSONL/JSON input: force every line
through the documents adapter (loud `CtfError` on lines that don't fit the shape) even if
detection would otherwise pick something else. It has no effect on a directory target — a
directory is always documents, and `--from` may not be combined with one at all.

**Conflict note:** because a directory document's id is its filename and its hash covers
content, editing `docs/a.md` and re-serving hits the ordinary content-conflict path (§ "content
differs from the stored copy") — the same as editing a JSONL line and re-importing under the
same explicit `id`. This is content-immutability working as designed (existing annotations
reference the stored copy), but it surprises people who expect "just re-serve after editing" to
silently pick up the change. `--on-conflict skip` keeps the stored version instead of failing.

## 5. Import error UX (normative — this is an adoption feature)

Every rejected line reports the location, the rule, and a **shown-fixed example**:

```
traces.jsonl:47 — message[2] has role "function", which is not a valid role.
Valid roles: system, user, assistant, tool.
It looks like an OpenAI legacy function message. Fixed, it would be:

  {"role": "tool", "tool_call_id": "call_abc", "content": "{...}"}

Run with --skip-invalid to import the other lines anyway.
```

The importer maintains a small table of known-mistake patterns (legacy `function` role,
stringified-JSON `messages`, missing `content`) each with a targeted fix example. Unknown
failures show the generic CTF snippet from doc 01 §8.

## 6. ADK adapter

Feasibility: **good.** ADK sessions serialize to JSON (a session envelope containing an
`events` list); each event has an `author`, content parts, and optional function calls/responses.

Mapping (one ADK session → one CTF trace), CTF v2 structural fields included:

```python
def to_ctf(session):
    msgs = []
    for ev in session["events"]:
        role = "user" if ev["author"] == "user" else "assistant"
        agent = ev["author"] if role == "assistant" else None
        status, status_message = error_status(ev)               # errorCode/errorMessage -> status
        parts = ev.get("content", {}).get("parts", [])
        text  = "".join(p["text"] for p in parts if "text" in p)
        calls = [p["function_call"] for p in parts if "function_call" in p]
        resps = [p["function_response"] for p in parts if "function_response" in p]

        for call in calls:
            if call["name"] == "transfer_to_agent":               # ADK's handoff signal
                target = call["args"].get("agent_name")
                msgs.append({"role": "event", "kind": "handoff", "content": "",
                             "agent": agent, "name": f"{agent} → {target}",
                             "metadata": {"from": agent, "to": target},
                             **({"status": status, "status_message": status_message} if status else {})})

        tool_calls = [{"id": c.get("id") or synth_id(c), "type": "function",
                        "function": {"name": c["name"], "arguments": raw_json_string(c["args"])}}
                       for c in calls if c["name"] != "transfer_to_agent"]
        if text or tool_calls:
            msgs.append({"role": role, "content": text,
                         **({"tool_calls": tool_calls} if tool_calls else {}),
                         "agent": agent, "span_id": ev.get("id"), "parent_id": ev.get("invocationId"),
                         "started_at": iso_from(ev.get("timestamp")),
                         **({"status": status, "status_message": status_message} if status else {}),
                         "raw": unmapped(ev)})
        for r in resps:
            msgs.append({"role": "tool", "tool_call_id": r.get("id") or match_call_id(r, msgs),
                         "name": r["name"], "content": raw_json_string(r["response"]), "agent": agent})
    return [{"id": session.get("id"), "source": "adk", "format_version": 2,
             "metadata": {"app_name": session.get("appName"), "user_id": session.get("userId")},
             "messages": msgs, "raw": unmapped(session)}]
```

Multi-agent sessions: each agent's events carry `agent` = the ADK event's `author` (the outline
navigator and agent-section headers, 06 §4.1, key off this field). `span_id` comes from the ADK
event id, `parent_id` anchors to the enclosing `invocationId`, and `started_at` from the event
timestamp. ADK also emits OTel spans natively; since CTF's tool-call shape already followed OTel
GenAI semantic conventions closely, most of this mapping's *shape* — not its code, ADK sessions
and raw OTLP are different wire formats — was reused when building the OTEL adapter (§6.1).

## 6.1 OTEL adapter (`OtelAdapter`, `source: "otel"`)

Feasibility: **good**, and the most future-proof of the three — anything that exports OpenTelemetry
GenAI semantic-convention spans (which growing numbers of agent frameworks do, including recent
ADK and most agent SDKs behind an OTel exporter) gets a real import path without a
framework-specific adapter. Semconv is pre-stable, so the adapter supports both the current
attribute-based content capture and the older span-event style, plus lossless `raw` for anything
neither recognizes.

**Sniff** — accepts both shapes, and is careful never to shadow `DatadogAdapter`:

- an OTLP/JSON envelope: `resourceSpans → scopeSpans → spans`
- a bare span or span list: a 32-hex `traceId` + 16-hex `spanId` + `startTimeUnixNano`, and
  critically **no `meta` key** — Datadog spans always carry `meta` and use decimal ids, so the
  two sniffs never collide (verified by an explicit sniff-priority test).

**Assembly** — group spans by `traceId`; build a parent map from `parentSpanId`; order rows
depth-first by the span tree, chronological (`startTimeUnixNano`) within siblings — matching how
Braintrust/Langfuse render span trees, even though CTF itself stays a flat list (01 §1).

**GenAI semconv mapping**, by `gen_ai.operation.name` / span name:

| Span kind | CTF output |
|---|---|
| `chat` / `generate_content` / `text_completion` | conversational messages from `gen_ai.input.messages`/`gen_ai.output.messages` attributes, or legacy span events (`gen_ai.user.message`, `gen_ai.choice`, `gen_ai.content.prompt`/`completion`) if attributes are absent; repeated input prefixes are deduped by role+content, same idea as the Datadog adapter (§7); `gen_ai.request.model` and usage tokens land in the last output message's `metadata` (`model`, `tokens_in`, `tokens_out`) |
| `execute_tool` | an assistant row with a synthesized `tool_calls` entry + a `role:"tool"` result row; `span_id`, `started_at`, `duration_ms` from span times; `status:"error"` (+ `status_message`) when OTLP `status.code == 2` |
| `invoke_agent` | a `role:"event", kind:"agent"` boundary row; `agent` (from `gen_ai.agent.name`) propagates onto every descendant row via the parent-span walk |
| `embeddings` / `retrieve` / any span with `db.system` set | `kind:"retrieval"` events |
| anything else | `kind:"span"` under `--include-all-spans` (01 §3.2); otherwise folded into trace `raw` under `otel_spans`, never dropped silently |

Unmapped attributes on any span always land in that row's own `raw`, on top of the trace-level
fold above.

**Wiring** — registered in `imports/adapters/base.py::AdapterRegistry.default` right after
`CtfAdapter` and before `AdkAdapter`/`DatadogAdapter` (§2); `--from otel` in
`cli/options.py::FromChoice`; `--include-all-spans` on both `import` and `serve`, threaded
through to `OtelAdapter(include_all_spans=...)` (and to `DatadogAdapter`, which honors the same
flag for its own generic-span fold, §7). `OtelAdapter.aggregates_input = True` — like Datadog, it
needs the whole file's spans grouped before it can assemble trees, so `imports/parsing.py`'s
"aggregate all lines before grouping" path (originally Datadog-only) is driven by that flag on
either adapter, not a name check.

## 7. Datadog LLM Observability adapter

Feasibility: **good for files; live API deferred.** MVP ingests an **exported JSON/JSONL of
spans** from Datadog LLM Observability (their spans carry `meta.input.messages` /
`meta.output.messages` on LLM spans, plus workflow/agent/tool span kinds). Live API sync is
explicitly post-MVP: auth + pagination is real work and a file keeps the trust story clean.

Mapping strategy: group spans by `trace_id`; order by `start_ns`; LLM-span input/output
messages become `user`/`assistant` turns (dedupe repeated history by content hash); tool spans
become `tool_calls` + `tool` turns, with `span_id`/`parent_id` from the span's own ids,
`started_at` from `start_ns`, and `duration_ms` from `duration` — those two (duration/status)
land on the *result* turn, which is where the frontend's tool-call duration/error chips read
from (06 §4). `workflow`/`agent` span kinds mark an agent/orchestration boundary: their `name`
becomes the `agent` value inherited by every descendant span (via the same parent-walk pattern
as OTEL's `invoke_agent`, §6.1); `retrieval`/`embedding` kinds map to `kind:"retrieval"` events
instead of being dumped to `raw` as they were pre-v2. Everything still unmapped → `raw`. One
Datadog trace → one CTF trace, `source: "datadog"`.

All three adapters live behind the same interface, so `tracelabel import --from otel spans.json`,
`--from adk sessions.json`, and `--from datadog spans.jsonl` are the whole story.

## 7.1 Re-import after an adapter upgrade

Upgrading `adk`/`datadog` (or adding `otel`) to emit richer structure changes their output for
the *same source file* — new fields participate in `content_hash` like any other field (01 §6),
so a previously-imported trace re-imported through the upgraded adapter now has different
content under the same `id`. That's `import_trace`'s ordinary conflict path (02 §4): with the
default `--on-conflict fail` it stops and asks you to pick, and `skip` keeps the stored
(pre-upgrade, structure-poor) version rather than losing existing annotations. To see the new
structure, re-import the file under a **new trace id** (or a fresh db) — the CLI's summary flags
this explicitly whenever a conflict fires:

```
imported traces.jsonl: 4 inserted, 0 skipped (duplicate), 6 conflicts, 0 invalid lines skipped
  some traces were imported with an older adapter; re-import under a new id
  to see structure (span/agent/handoff fields).
```

## 8. Export

Specified in 04 §5 (long format + `--joined`). Restated contract: export is a pure db
operation, columns are stable API, and multi-select CSV cells are JSON-array strings. A
trace-level joined row for a document trace emits `content` + `content_type` instead of
reconstructing `messages` from turns (there are none); a pandas user just reads whichever
column is non-null for a given row. Add one file: `docs/pandas.md` in the repo showing the
three-line load:

```python
import pandas as pd
df = pd.read_json("empathy-annotations.jsonl", lines=True)
df.groupby("task")["values"].apply(lambda v: (pd.json_normalize(v)["verdict"] == "pass").mean())
```

## 9. Suggest and documents

`tracelabel suggest` builds its transcript context from turns for a conversation trace, and
from the document body for a document trace (no turns to render) — the prompt names the target
"The document below" instead of a turn number or "the entire conversation." See 08.

## 10. Future work

Progress is reported in the task's native unit — "turns" or "traces" (02 §7). A project made
entirely of documents technically reports "N/M traces," which reads oddly for a folder of
files; a "documents" unit is deferred rather than adding a third unit for one input shape.
