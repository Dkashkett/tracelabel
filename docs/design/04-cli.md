# 04 — CLI

Implemented with Typer. Entry point: `tracelabel` (also runnable as `uvx tracelabel …` and
`python -m tracelabel`). Export and suggest never require a running server (invariant #10).

## 1. Command surface

```
tracelabel serve   [TARGET] [--task NAME] [--level turn|trace] [--annotator NAME]
                   [--shuffle/--no-shuffle] [--db PATH] [--port N] [--no-browser] [--yes]
tracelabel import  TARGET [--from auto|ctf|adk|datadog] [--db PATH]
                   [--on-conflict fail|skip] [--skip-invalid] [--as-documents]
tracelabel export  [--task NAME] [--db PATH] [--format jsonl|csv] [--joined]
                   [--out PATH] [--status labeled|skipped|all]
tracelabel tasks   list [--db PATH]
tracelabel suggest [TARGET] [--task NAME] [--db PATH] [--limit N] [--overwrite] [--concurrency N]
tracelabel demo    [--port N]
```

`TARGET` is a `.yaml`/`.yml` config **or** a data file (`.jsonl`/`.json`). If it's a data
file, an implicit empty config is assumed (all defaults). The project directory (where
`.tracelabel/` lives) is the directory containing TARGET.

## 2. `serve` (the main verb)

```python
def serve(target, **cli_flags):
    raw   = load_yaml(target) if is_yaml(target) else RawConfig(data=target)
    cfg   = resolve(raw, cli_flags)                    # 03 §4
    conn  = open_db(cfg)                               # migrations run here (02 §3)
    port  = pick_port(cli_flags.port or 8377)          # try requested, then next 10; print choice
    acquire_lock(project_dir, port)                    # 02 §1

    n = import_file(conn, cfg.data_path, source="jsonl", on_conflict="fail")  # idempotent
    open_task(conn, cfg, assume_yes=cli_flags.yes)     # drift guard lives here (02 §5)

    queue = build_queue(conn, cfg)                     # §3
    app   = build_fastapi(conn, cfg, queue)            # 05
    if not cli_flags.no_browser: open_browser(f"http://127.0.0.1:{port}")
    print(f"tracelabel · task '{cfg.name}' ({cfg.level}-level) · http://127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port)      # 127.0.0.1 ONLY — invariant #6
```

One `serve` process = one task. Labeling a second dimension is a second invocation with a
different `--task`.

## 3. Queue ordering (shuffle)

```python
def build_queue(conn, cfg) -> list[str]:              # ordered trace ids
    ids = [r[0] for r in conn.execute("SELECT id FROM traces ORDER BY imported_at, id")]
    seed = get_task_seed(conn, cfg.name)              # stored at task creation; stable on resume
    if seed is not None:
        random.Random(seed).shuffle(ids)
    return ids
```

Turn order within a trace is always `idx` — only trace order shuffles.

## 4. `import`

Idempotent by design (02 §4); safe to re-run after appending lines to the JSONL.
`--from auto` (default) runs format detection (07 §2). `--as-documents` wraps each line/file
as a single-turn `document` trace (07 §4). Prints a summary:

```
imported traces.jsonl: 412 inserted, 88 skipped (duplicate), 0 conflicts, 2 invalid lines skipped
```

## 5. `export`

Reads the db directly. Default `--out`: `<task>-annotations.<format>` in the CWD; `-` = stdout.

**Long format (default), one row per annotation.** Columns:

```
task, trace_id, target_type, target_id, turn_index (NULL for trace-level),
annotator, status, prefill_model, schema_hash, created_at, updated_at,
value.<field_name> ...            # one column per field in the task's resolved schema
```

- JSONL: `values` nested as an object; CSV: flattened `value.verdict`, `value.reasoning`, …
- Multi-select in CSV: JSON-array string (`'["hallucination","formatting"]'`) — unambiguous
  to `json.loads` in pandas.
- Skipped rows appear with empty values unless `--status labeled`.

**`--joined`**: adds `role`, `content`, `content_type` (turn-level) or full serialized
`messages` + trace `metadata` (trace-level), so a pandas user never joins back to the source.

```python
def export(conn, task, fmt, joined, out, status):
    schema = load_task_schema(conn, task)
    rows = conn.execute(BASE_SQL + (JOIN_TURNS_SQL if joined else ""), ...)
    write(out, flatten(rows, schema.field_names, fmt))
```

## 6. `tasks list`

```
TASK        LEVEL  PROGRESS        SCHEMA    UPDATED
empathy     turn   137/482 turns   a3f2c9…   2026-07-11 18:04
escalation  trace  200/200 traces  77bd01…   2026-07-09 10:22
```

## 7. `suggest`

Batch pre-annotation (08). Requires the `[ai]` extra; if litellm is missing:
`AI assist needs the optional extra: pip install 'tracelabel[ai]'`.

## 8. `demo`

Copies bundled sample traces (packaged data: ~25 realistic agent traces incl. tool calls, a
JSON doc, an HTML doc) into a temp project and runs `serve` with the zero-config default.
This is the README GIF and the entire 15-second pitch: `uvx tracelabel demo`, browser opens,
`j` `1` `Enter` works immediately.

## 9. Exit codes & conventions

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | user/config error (bad YAML, invalid CTF, drift declined) |
| 2 | environment error (port range exhausted, locked project, db newer than app) |
| 130 | interrupted (Ctrl-C) — must still release the lock |

All prompts (`confirm(...)`) must be bypassable with `--yes` for scripting. Errors go to
stderr; data (e.g. `export --out -`) to stdout.
