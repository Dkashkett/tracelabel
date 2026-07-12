# tracelabel [![Release](https://github.com/Dkashkett/tracelabel/actions/workflows/release.yml/badge.svg)](https://github.com/Dkashkett/tracelabel/actions/workflows/release.yml)

**Local-first, zero-config labeling for agent traces — keyboard-fast, no accounts, no server.**

One `pip install`. One command. Your browser opens on a keyboard-driven labeling UI over your
own traces. No sign-up, no cloud, no Node, no database to stand up. It's a single Python wheel
that bundles a FastAPI server, a prebuilt React app, and SQLite — one `.db` file per project.

```bash
uvx tracelabel demo
```

![demo](https://raw.githubusercontent.com/Dkashkett/tracelabel/main/docs/demo.gif)

Press `j` to jump to the first labelable turn, `1` to mark it **pass**, `Enter` to commit and
advance. That's the whole loop.

## Install

```bash
pip install tracelabel          # from PyPI
uvx tracelabel demo             # run without installing (via uv)
python -m tracelabel serve …    # module entry point
```

Requires **Python ≥ 3.10**; runs on macOS, Linux, and Windows. LLM-assisted prefill
(`tracelabel suggest`) needs the optional extra:

```bash
pip install "tracelabel[ai]"
```

## Quickstart

```bash
pip install tracelabel
tracelabel serve traces.jsonl     # imports the file + opens http://127.0.0.1:8377
tracelabel export                 # → <task>-annotations.jsonl
```

Your traces are a UTF-8 JSONL file, one trace per line — see [Data formats](#data-formats). **No
config needed**: tracelabel defaults to a turn-level pass/fail task, so you can point it at a
file and start labeling. The file you serve *is* the queue — `tracelabel serve week-28.jsonl`
labels only week 28's traces (see [One db, many files](#one-db-many-files)).

## Data formats

Everything you import is normalized to one internal shape — **the tracelabel trace format** (full
spec: [`docs/trace-format.md`](docs/trace-format.md)). You rarely need to produce it by hand:
`--from auto` (the default) sniffs the first few lines and routes your data through the right
adapter, in priority order:

```
ctf  →  adk  →  datadog  →  documents  →  loose
```

Force a specific one with `--from ctf|adk|datadog|documents|loose`. Input can be a `.jsonl` file
(one JSON value per line), a single JSON object, a top-level JSON array, or — for documents — a
folder.

### Native traces (JSONL)

One trace per line: an object with an optional `id` and a required `messages` array. This is the
tracelabel trace format itself — what every other adapter converts *into*. Roles are
`system | user | assistant | tool` (plus `document` for single-message document traces).
Assistant turns may carry `tool_calls`; `tool` turns carry a `tool_call_id`:

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
tracelabel serve ./docs     # every .md / .markdown / .txt / .text / .html / .htm file
```

The `id` is the filename, the extension sets `content_type`, and the real path is stored in
`metadata.path`. Other file types (`.json`, `.jsonl`, hidden files, unknown extensions) are
skipped with a summary note.

### ADK sessions

An exported **Google ADK session envelope** — `{"events": […], "appName"?, "userId"?, "id"?}` —
maps to one trace. Each event's `author` becomes a `user` or `assistant` turn (with the author
name as a chip, so multi-agent sessions stay legible), and `function_call` / `function_response`
parts become `tool_calls` + `tool` turns. See [Exporting from ADK](#exporting-from-adk) for how
to produce this file.

### Datadog LLM-Observability spans

An exported **JSON/JSONL of Datadog LLM-Observability spans** — each span carrying `trace_id`,
`span_id`, `start_ns`, `duration`, and a `meta` object with a `kind`. Spans are grouped by
`trace_id` and ordered by `start_ns` into one trace each: `llm` spans' input/output messages
become turns, `tool` spans become `tool_calls` + `tool` turns. See
[Exporting from Datadog](#exporting-from-datadog) for how to produce this file. (File import
only — there is no live Datadog API sync.)

## Commands

| Command | What it does | When to reach for it |
|---|---|---|
| `serve [file\|dir]` | **Import + create/open a task + build the labeling queue + open the browser UI.** The interactive entry point. | Normal labeling. Point it at your data and go. |
| `import <file\|dir>` | **Load data into the db only** — no task, no queue, no server. | Bulk ingest, or when you need format knobs `serve` doesn't expose. Follow with `serve --all`. |
| `export` | Read the db and write annotations to JSONL/CSV. Pure read — no server needed. | Get labels out for analysis. |
| `suggest [file]` | Optional LLM prefill of label suggestions (needs `[ai]` extra). | Warm-start labeling with a model's guesses. |
| `demo` | Copy bundled sample traces to a temp dir and serve them. | Try tracelabel with zero setup. |
| `tasks list` | Print a progress table across the whole db. | Check how far along each task is. |

**`import` vs `serve`** — both ingest through the same importer, but:

- **`import`** loads data and exits. It exposes the full ingest surface: `--from
  auto|ctf|adk|datadog|documents`, `--on-conflict fail|skip`, `--skip-invalid` (skip malformed
  lines instead of failing), `--as-documents`. It does **not** create a task or start a server.
- **`serve`** loads data *and* opens/creates a task, builds the labeling queue, and starts the
  web UI. It fixes `on-conflict=fail` and doesn't expose `--from`/`--skip-invalid` — so when your
  data isn't already in the native format, `import` it first, then `serve --all` to label everything in the db.

Useful `serve` flags: `--task NAME`, `--level turn|trace`, `--all` (label the whole db, not just
the file you served), `--port` (default `8377`), `--no-browser`, `--shuffle/--no-shuffle`. The
server binds `127.0.0.1` only.

## Common workflows

**1 · Just try it**

```bash
tracelabel demo
```

**2 · Label your own traces**

```bash
tracelabel serve traces.jsonl     # label in the browser
tracelabel export                 # → traces-annotations.jsonl (or <task>-annotations.jsonl)
```

**3 · Ingest a messy/odd format first, then label all of it**

```bash
tracelabel import dump.jsonl --from adk --skip-invalid
tracelabel serve --all            # queue = every trace in the db
```

**4 · Scoped weekly queues over one shared db**

```bash
tracelabel serve week-28.jsonl --task empathy   # only week 28; resumes where you left off
```

**5 · LLM-assisted prefill, then review**

```bash
pip install "tracelabel[ai]"
export OPENAI_API_KEY=…           # or your provider's key
tracelabel suggest traces.jsonl   # writes suggestions; you still confirm each label
tracelabel serve traces.jsonl
```

**6 · Check progress and export for analysis**

```bash
tracelabel tasks list
tracelabel export --joined --status labeled --out labels.jsonl
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
tracelabel serve adk-sessions.jsonl        # or: tracelabel import … --from adk
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

## Configuring the task

Drop a `config.yaml` next to your data (or pass `--config`). Everything not specified falls back
to sensible defaults; unknown keys are hard errors with a pointed message.

```yaml
name: empathy
level: turn                 # label per-turn (default) or per-trace
label_roles: [assistant]    # which roles are labelable
fields:
  - name: verdict
    type: single_select
    options: [pass, fail]
    required: true
  - name: failure_modes
    type: multi_select
    options: [hallucination, refused, wrong_tool, formatting]
  - name: notes
    type: text
```

Field types map one-to-one to UI controls and to export columns. Add a field, get a new keyboard
target and a new column — no redesign. With a `config.yaml` present you can run `tracelabel serve`
(no file argument) and it uses the `data:` path from the config.

## One db, many files

tracelabel stores one shared pool of traces per project (`.tracelabel/tracelabel.db`) — traces
are deduped by id/content hash and accumulate across every file you've ever served or imported.
But the *file you serve is a lens over that pool*, not the pool itself: `tracelabel serve
week-28.jsonl --task empathy` scopes the labeling queue and progress bar to exactly the traces in
`week-28.jsonl`, even if the db already contains traces from `week-27.jsonl` or other tasks.
Re-serving an old file resumes exactly where you left off — nothing is re-scrambled or
un-completed by importing something new.

- Each file is imported idempotently, so re-serving the same file (or one with overlapping
  traces) is always safe.
- `tracelabel export` and `tracelabel tasks list` are **db-wide** — they report on the whole pool,
  across every file and session, not just the last one served.
- `tracelabel serve <file> --all` opts back into whole-db behavior: it still imports `<file>`
  (idempotent, as always), but the queue is every trace in the db, not just that file's.

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

## License

[Apache-2.0](LICENSE).
