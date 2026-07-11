# 07 — Import & Export

Core rule: **the core is coupled to nothing but CTF v1** (doc 01). Every source goes through
a thin adapter that emits CTF; the importer (02 §4) only ever sees CTF. Be liberal in what we
accept, strict in what we store.

```
source file ─▶ detect/route ─▶ adapter.to_ctf() ─▶ validate CTF ─▶ idempotent insert
```

## 1. Adapter interface

```python
class Adapter(Protocol):
    name: str                                   # "ctf" | "adk" | "datadog" | ...
    def sniff(self, first_lines: list[dict]) -> bool: ...     # cheap detection for --from auto
    def to_ctf(self, obj: dict) -> Iterator[dict]: ...        # one source obj → ≥1 CTF traces
```

Adapters must: map every field they understand, dump everything else into `raw` (trace- and
turn-level), set `source`, and **never reformat content strings** (invariant #1).

## 2. `--from auto` detection (default)

Ordered sniff over the first 5 parsed lines; first match wins; ties never happen because the
order is priority:

```python
def detect(first_lines) -> Adapter:
    for adapter in [CtfAdapter, AdkAdapter, DatadogAdapter, LooseAdapter]:
        if adapter.sniff(first_lines): return adapter
    die_with_format_help()          # §5

# Sniff rules (normative):
# Ctf:      has "messages": list of dicts with "role"
# Adk:      has "events" list with "author"/"invocation_id" keys, or ADK session envelope
# Datadog:  has "spans" (or is a span) with "meta" containing "input.messages"/"output.messages"
# Loose:    handles common near-misses (§3)
```

## 3. LooseAdapter — the bounce-risk killer

Most users arrive with *almost*-CTF data. Accept it:

| Input shape | Mapping |
|---|---|
| bare list of message dicts (`[{"role":..,"content":..}, ...]`) — i.e. a raw OpenAI messages array per line | wrap as `{"messages": [...]}` |
| `{"conversation": [...]}` / `{"turns": [...]}` / `{"chat": [...]}` | rename key to `messages`; note in summary |
| a plain string per line | single-turn `document` trace |
| message dicts with `"speaker"`/`"from"` instead of `"role"` | rename; map `human→user`, `ai/bot/agent→assistant` |
| LangSmith-style run exports with `inputs.messages` / `outputs` | best-effort map to messages; extras → `raw` |

Anything mapped by LooseAdapter prints one summary line so the user knows what happened
(`interpreted "turns" as "messages" on 412 lines`). Ambiguous beyond these rules → §5 error.

## 4. Documents (`--as-documents`)

Explicit wrapper for freeform corpora, bypassing detection:

```python
def as_documents(path) -> Iterator[dict]:
    if path.suffix == ".jsonl":
        for line in lines: yield doc(line if is_string(line) else raw_line_text(line))
    else:                                    # .txt/.html/.json: whole file = one document
        yield doc(path.read_text())

def doc(s): return {"messages": [{"role": "document", "content": s}]}   # content verbatim
```

Content-type detection (01 §4) then tags text/json/html for rendering.

## 5. Import error UX (normative — this is an adoption feature)

Every rejected line reports the location, the rule, and a **shown-fixed example**:

```
traces.jsonl:47 — message[2] has role "function", which is not a valid role.
Valid roles: system, user, assistant, tool, document.
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

Mapping (one ADK session → one CTF trace):

```python
def to_ctf(session):
    msgs = []
    for ev in session["events"]:
        role = "user" if ev["author"] == "user" else "assistant"
        parts = ev.get("content", {}).get("parts", [])
        text  = "".join(p["text"] for p in parts if "text" in p)
        calls = [{"id": p["function_call"].get("id") or synth_id(p),
                  "type": "function",
                  "function": {"name": p["function_call"]["name"],
                               "arguments": raw_json_string(p["function_call"]["args"])}}
                 for p in parts if "function_call" in p]
        resps = [p["function_response"] for p in parts if "function_response" in p]
        if text or calls:
            msgs.append({"role": role, "content": text,
                         **({"tool_calls": calls} if calls else {}),
                         "name": ev["author"] if role == "assistant" else None,
                         "metadata": {"invocation_id": ev.get("invocationId")},
                         "raw": unmapped(ev)})
        for r in resps:
            msgs.append({"role": "tool", "tool_call_id": r.get("id") or match_call_id(r, msgs),
                         "name": r["name"], "content": raw_json_string(r["response"])})
    return [{"id": session.get("id"), "source": "adk",
             "metadata": {"app_name": session.get("appName"), "user_id": session.get("userId")},
             "messages": msgs, "raw": unmapped(session)}]
```

Multi-agent sessions: each agent's events map to `assistant` turns with `name` = agent name
(role colors + name chip make this legible in the UI). ADK also emits OTel spans; since CTF's
tool-call shape follows OTel GenAI semantic conventions closely, a future OTLP-file path
reuses most of this mapping.

## 7. Datadog LLM Observability adapter

Feasibility: **good for files; live API deferred.** MVP ingests an **exported JSON/JSONL of
spans** from Datadog LLM Observability (their spans carry `meta.input.messages` /
`meta.output.messages` on LLM spans, plus workflow/agent/tool span kinds). Live API sync is
explicitly post-MVP: auth + pagination is real work and a file keeps the trust story clean.

Mapping strategy: group spans by `trace_id`; order by `start_ns`; LLM-span input/output
messages become `user`/`assistant` turns (dedupe repeated history by content hash); tool spans
become `tool_calls` + `tool` turns; span ids/timings go to turn `metadata`; everything
unmapped → `raw`. One Datadog trace → one CTF trace, `source: "datadog"`.

Both adapters live behind the same interface, so `tracelabel import --from adk sessions.json`
and `--from datadog spans.jsonl` are the whole story.

## 8. Export

Specified in 04 §5 (long format + `--joined`). Restated contract: export is a pure db
operation, columns are stable API, and multi-select CSV cells are JSON-array strings. Add
one file: `docs/pandas.md` in the repo showing the three-line load:

```python
import pandas as pd
df = pd.read_json("empathy-annotations.jsonl", lines=True)
df.groupby("task")["values"].apply(lambda v: (pd.json_normalize(v)["verdict"] == "pass").mean())
```
