# tracelabel

**Local-first, zero-config labeling for agent traces — keyboard-fast, no accounts, no server.**

One `pip install`. One command. Your browser opens on a keyboard-driven labeling UI over your
own traces. No sign-up, no cloud, no Node, no database to stand up. It's a single Python wheel
that bundles a FastAPI server, a prebuilt React app, and SQLite — one `.db` file per project.

```bash
uvx tracelabel demo
```

![demo](docs/demo.gif)
<!-- GIF placeholder: `uvx tracelabel demo` → browser opens → press `j` `1` `Enter` → a label is saved. -->

Press `j` to jump to the first labelable turn, `1` to mark it **pass**, `Enter` to commit and
advance. That's the whole loop.

## Quickstart

```bash
pip install tracelabel                # or: uvx tracelabel ...
tracelabel serve traces.jsonl         # opens http://127.0.0.1:8377 in your browser
tracelabel export                     # → <task>-annotations.jsonl
```

Your traces are a UTF-8 [JSONL](docs/trace-format.md) file, one trace per line. No config needed
— tracelabel defaults to a turn-level pass/fail task. Point it at a file and start labeling.

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

## Export → pandas

Export is a pure database read with a stable column contract. Long format (one row per
annotation) by default; `--joined` folds in the turn/trace content so you never join back to the
source.

```python
import pandas as pd
df = pd.read_json("empathy-annotations.jsonl", lines=True)
df.groupby("task")["values"].apply(lambda v: (pd.json_normalize(v)["verdict"] == "pass").mean())
```

See [`docs/pandas.md`](docs/pandas.md) for a groupby recipe per field type.

## When to use something else

tracelabel is deliberately small. Reach for a full platform when you need what it doesn't do:

- **[Label Studio](https://labelstud.io/) / [Argilla](https://argilla.io/)** — hosted
  multi-annotator platforms with accounts, projects, review workflows, and rich media (images,
  audio, bounding boxes). tracelabel is single-player, text/JSON/HTML only, and runs on your
  laptop.
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
