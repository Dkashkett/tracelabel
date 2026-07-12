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

## Quickstart

```bash
pip install tracelabel                # or: uvx tracelabel ...
tracelabel serve traces.jsonl         # opens http://127.0.0.1:8377 in your browser
tracelabel export                     # → <task>-annotations.jsonl
```

Your traces are a UTF-8 [JSONL](https://github.com/Dkashkett/tracelabel/blob/main/docs/trace-format.md)
file, one trace per line. No config needed
— tracelabel defaults to a turn-level pass/fail task. Point it at a file and start labeling.

The file you serve is the queue: `tracelabel serve week-28.jsonl` labels *only* week 28's
traces, even if your db already holds traces from other files. See
[One db, many files](#one-db-many-files) below.

Labeling freeform documents (notes, transcripts, policy pages) instead of agent traces works
the same way — either a folder of files, or a JSONL of documents:

```bash
tracelabel serve ./docs                # every .md/.txt/.html/.htm file in the folder, one trace each
```

```jsonl
"A plain document is just a string."
{"content": "# Report\n\nFindings go here.", "content_type": "markdown", "id": "report-1"}
```

Documents label at the trace level (there's nothing to break into turns) and Markdown renders
with real formatting in the UI.

## Your traces never leave your machine

The server binds `127.0.0.1` only — there is no `--host` flag and no auth, because nothing is
ever exposed off your loopback interface. **There is no telemetry, period** — not opt-in, not
opt-out. The *only* outbound network call this package can make is a model call you explicitly
trigger by running `tracelabel suggest` (which uses your own API key from your own environment).

> **Your traces never leave your machine unless _you_ run `suggest`.**

API keys are read from environment variables only; putting an `api_key:` in your config is a
hard error, and keys are never logged and never written to the database.

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
target and a new column — no redesign.

## One db, many files

tracelabel stores one shared pool of traces per project (`.tracelabel/tracelabel.db`) — traces
are deduped by id/content hash and accumulate across every file you've ever served or imported.
But the *file you serve is a lens over that pool*, not the pool itself: `tracelabel serve
week-28.jsonl --task empathy` scopes the labeling queue and progress bar to exactly the traces
in `week-28.jsonl`, even if the db already contains traces from `week-27.jsonl` or other tasks.
Re-serving an old file resumes exactly where you left off — nothing is re-scrambled or
un-completed by importing something new.

- Each file is imported idempotently, so re-serving the same file (or one with overlapping
  traces) is always safe.
- `tracelabel export` and `tracelabel tasks list` are **db-wide** — they report on the whole
  pool, across every file and session, not just the last one served.
- `tracelabel serve <file> --all` opts back into the old whole-db behavior: it still imports
  `<file>` (idempotent, as always), but the queue is every trace in the db, not just that
  file's.

## Export → pandas

Export is a pure database read with a stable column contract. Long format (one row per
annotation) by default; `--joined` folds in the turn/trace content so you never join back to the
source.

```python
import pandas as pd
df = pd.read_json("empathy-annotations.jsonl", lines=True)
df.groupby("task")["values"].apply(lambda v: (pd.json_normalize(v)["verdict"] == "pass").mean())
```

See [`docs/pandas.md`](https://github.com/Dkashkett/tracelabel/blob/main/docs/pandas.md) for a
groupby recipe per field type.

## When to use something else

tracelabel is deliberately small. Reach for a full platform when you need what it doesn't do:

- **[Label Studio](https://labelstud.io/) / [Argilla](https://argilla.io/)** — hosted
  multi-annotator platforms with accounts, projects, review workflows, and rich media (images,
  audio, bounding boxes). tracelabel is single-player, text/JSON/HTML/Markdown only, and runs
  on your laptop.
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

## Security posture

- **Loopback only.** Binds `127.0.0.1`; no `--host` flag exists.
- **No telemetry, ever.** The only outbound calls are `suggest`'s explicit model calls.
- **Untrusted HTML is sandboxed.** HTML traces render in an iframe with an empty `sandbox`
  attribute; there is no `dangerouslySetInnerHTML` anywhere in the app.
- **Strict config.** Unknown/typo'd config keys are hard errors; `api_key:` in YAML is rejected.
- **Tiny dependency surface.** Runtime core is `fastapi`, `uvicorn`, `pydantic`, `typer`,
  `pyyaml`; `litellm` is an optional `[ai]` extra; shadcn/ui is vendored, not a dependency.

## Install methods

Works via `pip install tracelabel`, `uvx tracelabel`, and `python -m tracelabel`. Requires
Python ≥ 3.10. Runs on macOS, Linux, and Windows.

## License

[Apache-2.0](LICENSE).
