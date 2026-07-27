# tracelabel [![Release](https://github.com/Dkashkett/tracelabel/actions/workflows/release.yml/badge.svg)](https://github.com/Dkashkett/tracelabel/actions/workflows/release.yml)

**Local-first, lightweight labeling — keyboard-fast, no accounts, no server.**

One `pip install`. One command. Your browser opens on a keyboard-driven labeling UI over your
own traces. No sign-up, no cloud, no Node, no database to stand up. It's a single Python wheel
that bundles a FastAPI server, a prebuilt React app, and SQLite — one `.db` file per project.

```bash
uvx tracelabel demo
```

![demo](https://raw.githubusercontent.com/Dkashkett/tracelabel/main/docs/demo.gif)

Press `j` to jump to the first labelable turn, `1` to mark it **pass**, `Enter` to commit and
advance. That's the whole loop.

Multi-agent traces get real structure, not a flat message list: collapsible tool-call cards with
duration and error state, agent-colored sections, and handoff dividers — imported from OTEL GenAI
spans, Google ADK sessions, or Datadog LLM-Observability spans (see [Data formats](#data-formats)).

## Install

```bash
pip install tracelabel          # from PyPI
uvx tracelabel demo             # run without installing (via uv)
python -m tracelabel            # module entry point
```

Requires **Python ≥ 3.10**; runs on macOS, Linux, and Windows. LLM-assisted prefill
(`tracelabel suggest`) needs the optional extra:

```bash
pip install "tracelabel[ai]"
```

## Quickstart

```bash
pip install tracelabel
tracelabel                        # opens http://127.0.0.1:8377 on your project list
```

Create a project in the browser, drop in a file, build a rubric, and start labeling — zero
terminal commands after the first. If you'd rather skip the browser flow for a quick one-off:

```bash
tracelabel traces.jsonl            # imports the file + opens straight into the labeling view
tracelabel export --project traces --task <name>   # → <task>-annotations.jsonl
```

Your traces are a UTF-8 JSONL file, one trace per line — see [Data formats](#data-formats).
Pointing the launcher at a file finds-or-creates a project and a default trace-level pass/fail
task for it, idempotently — running the same command again resumes where you left off instead
of creating a second copy (see [Workspace: projects and tasks](#workspace-projects-and-tasks)).

## Data formats

Everything you import is normalized to one internal shape — **the tracelabel trace format** (full
spec: [`docs/trace-format.md`](docs/trace-format.md)). You rarely need to produce it by hand:
`--from auto` (the default) sniffs the first few lines and routes your data through the right
adapter, in priority order:

```
ctf  →  otel  →  adk  →  datadog  →  documents  →  loose
```

Force a specific one with `--from ctf|otel|adk|datadog|documents`. Input can be a `.jsonl` file
(one JSON value per line), a single JSON object, a top-level JSON array, or — for documents — a
folder.

### Native traces (JSONL)

One trace per line: an object with an optional `id` and a required `messages` array. This is the
tracelabel trace format itself — what every other adapter converts *into*. Roles are
`system | user | assistant | tool`, plus `event` for non-conversational structure (agent
handoffs, retrieval spans, guardrail checks — never labelable; see
[`docs/trace-format.md`](docs/trace-format.md) §3.1). Assistant turns may carry `tool_calls`;
`tool` turns carry a `tool_call_id`:

```json
{"id": "demo_001", "metadata": {"model": "gpt-4o", "env": "prod"}, "messages": [
  {"role": "system", "content": "You are Aria, a support agent."},
  {"role": "user", "content": "Status of order #48213?"},
  {"role": "assistant", "content": "", "tool_calls": [
    {"id": "call_1", "type": "function",
     "function": {"name": "lookup_order", "arguments": "{\"order_id\": \"48213\"}"}}]},
  {"role": "tool", "tool_call_id": "call_1", "name": "lookup_order",
   "content": "{\"status\": \"shipped\", \"carrier\": \"UPS\"}"},
  {"role": "assistant", "content": "Order #48213 has shipped via UPS."}
]}
```

`content` may be a plain string or a **parts array** — `{"type": "text"|"json"|"html", …}` —
for mixed text/JSON/HTML turns. A handful of validation rules apply (`tool_calls` only on
`assistant`, `tool_call_id` only on `tool`, empty content allowed only with `tool_calls`); the
importer rejects violations with a fixed example. Full rules: [`docs/trace-format.md`](docs/trace-format.md).

### Loose inputs (almost-native)

Most people arrive with data that's *nearly* the native format. The `loose` adapter accepts common shapes and
prints a one-line summary of what it remapped (e.g. `interpreted "turns" as "messages" on 412 lines`):

| You have | tracelabel does |
|---|---|
| A bare OpenAI messages array per line: `[{"role": "user", …}, …]` | Wraps it as `{"messages": […]}` |
| `{"conversation": […]}` / `{"turns": […]}` / `{"chat": […]}` | Renames the key to `messages` |
| Messages using `speaker` / `from` instead of `role` | Renames; maps `human→user`, `ai`/`bot`/`agent→assistant` |
| LangSmith-style runs with `inputs.messages` / `outputs` | Best-effort maps to messages; extras → `raw` |

### Documents mode

Label freeform text/Markdown/HTML/JSON (notes, transcripts, policy pages) instead of agent
conversations. Documents label at the **trace level** (there's nothing to break into turns), and
Markdown/HTML render with real formatting in the UI. Two ways in:

**A JSONL of documents** — each line is a bare string, or an object with a required `content`:

```jsonl
"A plain document is just a string."
{"content": "# Report\n\nFindings go here.", "content_type": "markdown", "id": "report-1"}
```

A bare string defaults to `content_type: "text"`. `--as-documents` forces this adapter on JSONL
input even if auto-detection would pick something else.

**A folder of files** — a non-recursive scan; one document per file:

```bash
tracelabel ./docs             # every .md / .markdown / .txt / .text / .html / .htm file
```

The `id` is the filename, the extension sets `content_type`, and the real path is stored in
`metadata.path`. Other file types (`.json`, `.jsonl`, hidden files, unknown extensions) are
skipped with a summary note.

### OTEL GenAI spans

An **OpenTelemetry trace export** — either a full OTLP/JSON envelope (`resourceSpans →
scopeSpans → spans`) or a bare list of spans — following the (pre-stable) [GenAI semantic
conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/). This is the most
framework-agnostic path in: anything that exports OTel GenAI spans (a growing set of agent SDKs
and frameworks) gets tool-call, agent-handoff, and retrieval structure without a
framework-specific adapter. Spans are grouped by trace id and ordered depth-first by the span
tree; `chat`/`generate_content` spans become turns, `execute_tool` spans become `tool_calls` +
`tool` turns (with duration/error status), and `invoke_agent` spans mark agent boundaries whose
name propagates onto every descendant row. See [Exporting from OTEL](#exporting-from-otel).

### ADK sessions

An exported **Google ADK session envelope** — `{"events": […], "appName"?, "userId"?, "id"?}` —
maps to one trace. Each event's `author` becomes a `user` or `assistant` turn tagged with that
agent (agent-colored section headers + chips in the UI, so multi-agent sessions stay legible),
`function_call` / `function_response` parts become `tool_calls` + `tool` turns, and a
`transfer_to_agent` call becomes a handoff divider between agent sections. See [Exporting from
ADK](#exporting-from-adk) for how to produce this file.

### Datadog LLM-Observability spans

An exported **JSON/JSONL of Datadog LLM-Observability spans** — each span carrying `trace_id`,
`span_id`, `start_ns`, `duration`, and a `meta` object with a `kind`. Spans are grouped by
`trace_id` and ordered by `start_ns` into one trace each: `llm` spans' input/output messages
become turns, `tool` spans become `tool_calls` + `tool` turns (duration/error status attached),
and `workflow`/`agent` spans mark agent boundaries. See
[Exporting from Datadog](#exporting-from-datadog) for how to produce this file. (File import
only — there is no live Datadog API sync.)

Spans that aren't chat/tool/agent (raw `http`, `db.client`, etc.) are folded into trace metadata
by default on both the OTEL and Datadog adapters; pass `--include-all-spans` to keep them as
visible (never-labelable) event rows instead.

## Commands

| Command | What it does | When to reach for it |
|---|---|---|
| `tracelabel [file\|dir]` | **The front door.** No argument: opens the browser on your project list. With a file/dir: finds-or-creates a project + a default task for it, imports, and opens straight into the labeling view. | Normal use. Everything else — creating projects, importing other sources, building a rubric — happens in the browser from here. |
| `demo` | Launch against bundled sample traces, in a "demo" project. | Try tracelabel with zero setup. |
| `import <file\|dir> --project NAME` | Load data into an existing project's db. No task, no browser. | Automation/CI, or importing into a project you already created in the browser. |
| `suggest --project NAME --task NAME` | Optional LLM prefill of label suggestions (needs `[ai]` extra). | Warm-start labeling with a model's guesses. |
| `export --project NAME --task NAME` | Read the db and write annotations to JSONL/CSV. Pure read — no server needed. | Get labels out for analysis. |

Every command takes `--dir PATH` to point at a workspace other than the default `~/.tracelabel/`
(see [Workspace: projects and tasks](#workspace-projects-and-tasks)). `import`/`suggest`/`export`
are the automation set — CI and scripts reach for these directly instead of driving the browser.
`import` exposes the full ingest surface: `--from auto|ctf|otel|adk|datadog|documents`,
`--on-conflict fail|skip`, `--skip-invalid`, `--as-documents`, `--include-all-spans` (keep
non-chat/tool/agent spans as visible event rows instead of folding them into metadata; OTEL and
Datadog adapters only). The server binds `127.0.0.1` only, always.

## Common workflows

**1 · Just try it**

```bash
tracelabel demo
```

**2 · Label your own traces**

```bash
tracelabel traces.jsonl            # label in the browser
tracelabel export --project traces --task <name>   # → <task>-annotations.jsonl
```

**3 · Ingest a messy/odd format, then label it in the browser**

```bash
tracelabel                          # open the project list, create a project
tracelabel import dump.jsonl --from adk --skip-invalid --project my-project
# then open the project in the browser and build a rubric / start labeling
```

**4 · LLM-assisted prefill, then review**

```bash
pip install "tracelabel[ai]"
export OPENAI_API_KEY=…            # or your provider's key
tracelabel suggest --project my-project --task <name>   # writes suggestions
tracelabel                          # review them in the browser; you still confirm each label
```

**5 · Export for analysis**

```bash
tracelabel export --project my-project --task <name> --joined --status labeled --out labels.jsonl
```

## Exported data

`tracelabel export` is a pure db read with a **stable column contract** — the columns are an API.
Default format is JSONL (one row per annotation), with the label `values` nested as an object;
CSV flattens them into `value.<field>` columns.

Base columns (always present):

```
task  trace_id  target_type  target_id  turn_index  annotator
status  prefill_model  schema_hash  created_at  updated_at
```

A default **JSONL row**:

```json
{"task": "empathy", "trace_id": "conv_1", "target_type": "turn", "target_id": "conv_1#4",
 "turn_index": 4, "annotator": "me", "status": "labeled", "prefill_model": null,
 "schema_hash": "a1b2c3…", "created_at": "2026-07-12T15:04:05Z", "updated_at": "2026-07-12T15:04:05Z",
 "values": {"verdict": "pass", "failure_modes": ["formatting"], "notes": "minor wording nit"}}
```

`--joined` folds in the source content so you never join back to the original file: turn-level
rows gain `role`, `content`, `content_type`, `trace_metadata`, `source`; trace-level rows gain
the reconstructed `messages` array (or `content`/`content_type` for document traces). Other flags:
`--task`, `--format jsonl|csv`, `--status labeled|skipped|all`, `--out PATH` (`-` = stdout).

Load it in three lines:

```python
import pandas as pd
df = pd.read_json("empathy-annotations.jsonl", lines=True)
df.groupby("task")["values"].apply(lambda v: (pd.json_normalize(v)["verdict"] == "pass").mean())
```

See [`docs/pandas.md`](docs/pandas.md) for a groupby recipe per field type (`single_select`,
`multi_select`, `text`).

## Exporting from OTEL

The `otel` adapter wants an OTLP/JSON trace export with [GenAI semantic-convention
attributes](https://opentelemetry.io/docs/specs/semconv/gen-ai/) — an OTel collector's
[file exporter](https://github.com/open-telemetry/opentelemetry-collector/tree/main/exporter/fileexporter)
pointed at your agent process is the usual path, or your SDK's own OTLP/JSON writer. One trace
export (a `resourceSpans` envelope, or a bare list of spans) can contain many traces —
`tracelabel` groups spans by `traceId` for you:

```yaml
# OTel collector config.yaml — write spans to a file instead of (or alongside) a real backend
exporters:
  file:
    path: otel-spans.json
service:
  pipelines:
    traces:
      exporters: [file]
```

```bash
tracelabel otel-spans.json            # or: tracelabel import … --from otel --project NAME
```

The adapter recognizes `gen_ai.operation.name` in `chat`/`generate_content`/`text_completion`
(conversation turns, from `gen_ai.input.messages`/`gen_ai.output.messages` attributes or the
older span-event style), `execute_tool` (tool calls + results), `invoke_agent` (agent
boundaries, named by `gen_ai.agent.name`), and retrieval/embedding spans. Everything else is
kept in `raw` unless you pass `--include-all-spans`.

## Exporting from ADK

The `adk` adapter wants the **session envelope JSON**. ADK `Session`/`Event` objects are Pydantic
models, so you serialize them with `model_dump()` / `model_dump_json()`. Illustrative helper
(one session per line — adapt to your session service and ids):

```python
# pip install google-adk
import json

session = await session_service.get_session(app_name=APP, user_id=UID, session_id=SID)
with open("adk-sessions.jsonl", "w") as f:
    f.write(json.dumps(session.model_dump(mode="json")) + "\n")
```

Then:

```bash
tracelabel adk-sessions.jsonl        # or: tracelabel import … --from adk --project NAME
```

The adapter needs, per session: `events[].author`, and `events[].content.parts[]` where a part is
`{"text": …}`, `{"function_call": {"name", "args", "id"?}}`, or
`{"function_response": {"name", "response", "id"?}}`. Top-level `appName` / `userId` / `id` are
optional and land in trace metadata. Because each event's `author` becomes the assistant `name`,
multi-agent sessions render with a per-agent chip.

## Exporting from Datadog

The `datadog` adapter wants an **exported JSON/JSONL of LLM-Observability spans** (file import
only — no live sync). Pull them from Datadog's Export API and write each span as one JSONL line.
Illustrative helper:

```bash
curl -s \
  -H "DD-API-KEY: $DD_API_KEY" -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  "https://api.datadoghq.com/api/v2/llm-obs/v1/spans/events?filter[from]=now-1d&filter[to]=now" \
  | jq -c '.data[].attributes' > datadog-spans.jsonl

tracelabel import datadog-spans.jsonl --from datadog
```

The adapter needs, per span: `trace_id`, `span_id`, `start_ns`, `duration`, and a `meta` object
with a `kind` (`llm` / `tool` / `workflow`); LLM spans carry `meta.input.messages` /
`meta.output.messages`. Spans are grouped by `trace_id` into one trace each.

> Adjust the host for your Datadog site (e.g. `api.datadoghq.eu`), and the `.data[].attributes`
> jq path if your export nests fields differently — the requirement is only that each output line
> is a span object with the fields above.

## Building a rubric

A task's fields (`single_select`, `multi_select`, `text` — the three types the UI and export both
understand) are built and edited in the browser's rubric editor, with a live preview of exactly
how each field will render while you're labeling. Pick a starting preset or start blank, add/remove
fields, and save. Removing a field, retyping one, or dropping an option that's actually in use is
flagged before it's applied — you can fork to a new task instead of orphaning existing labels.
Cosmetic edits (relabeling, reordering, adding an optional field) never touch existing annotations.

## Reviewing an LLM judge's labels

A task can be put into review mode — stepping through targets an LLM judge already labeled instead
of unlabeled ones, seeding the form from the judge's verdict so you approve or correct it — by
setting `review_of` (the judge's annotator name) and `review_labels_from` on the task (`PATCH
/api/projects/{project}/tasks/{task}`, see `src/tracelabel/api/models.py`'s `TaskPatch`). The judge
is stored as its own annotator, and your corrections as a second one, so the original prediction is
preserved and `tracelabel export --joined` emits one row per annotator per trace — diff them to
measure how often the judge was right. A dedicated review-mode screen (rather than editing the task
via the API directly) is planned but not yet built.

## Workspace: projects and tasks

Everything tracelabel manages lives under one workspace directory — `~/.tracelabel/` by default,
or `--dir PATH` to root it elsewhere:

```
~/.tracelabel/
  settings.json               # annotator, default LLM model, theme
  projects/
    support-triage/
      project.json             # name, created_at, notes
      tracelabel.db             # this project's traces, tasks, and annotations
    week-28-eval/
      ...
```

One workspace holds any number of **projects**; one project holds any number of **tasks** (each a
named labeling pass over a level with its own field schema) and **sources** (a durable record of
each import — filename, adapter, trace count — so "label the batch I imported Tuesday" survives a
restart). Traces are deduped by id/content hash within a project and accumulate across every
source you've imported into it. `--dir .` roots a workspace at the current directory instead,
for a "labels live next to my traces in git" workflow.

## Privacy & security

**Your traces never leave your machine unless _you_ run `suggest`.**

- **Loopback only.** The server binds `127.0.0.1`; there is no `--host` flag and no auth, because
  nothing is ever exposed off your loopback interface.
- **No telemetry, ever** — not opt-in, not opt-out. The *only* outbound network call this package
  can make is a model call you explicitly trigger with `tracelabel suggest`, using your own API
  key from your own environment.
- **API keys from env only.** Putting an `api_key:` in your config is a hard error; keys are never
  logged and never written to the database.
- **Untrusted HTML is sandboxed.** HTML traces render in an iframe with an empty `sandbox`
  attribute; there is no `dangerouslySetInnerHTML` anywhere in the app.
- **Strict config.** Unknown/typo'd config keys are hard errors.
- **Tiny dependency surface.** Runtime core is `fastapi`, `uvicorn`, `pydantic`, `typer`,
  `pyyaml`; `litellm` is an optional `[ai]` extra; shadcn/ui is vendored, not a dependency.

## When to use something else

tracelabel is deliberately small. Reach for a full platform when you need what it doesn't do:

- **[Label Studio](https://labelstud.io/) / [Argilla](https://argilla.io/)** — hosted
  multi-annotator platforms with accounts, projects, review workflows, and rich media (images,
  audio, bounding boxes). tracelabel is single-player, text/JSON/HTML/Markdown only, and runs on
  your laptop.
- Use tracelabel when you want to label agent traces *right now*, keyboard-fast, without standing
  up infrastructure or sending your data anywhere.

## Teams

tracelabel is single-player today — one annotator, one db file. But the schema is already
multi-annotator ready (every annotation carries an `annotator` and a `schema_hash`), so teams
aren't a dead end. The planned answer is:

```bash
tracelabel merge alice.db bob.db      # (planned) combine independent annotators' db files
```

Each person labels locally into their own `.db`; you merge and compute agreement offline. Nothing
about the storage format needs to change to get there.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, frontend build behavior, and test
commands.

## License

[Apache-2.0](LICENSE).
