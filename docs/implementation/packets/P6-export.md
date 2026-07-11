# P6 — Export

**Phase:** 3 · **Depends on:** P3 · **Unblocks:** P8

**Owned files:** `src/tracelabel/export.py`, `tests/test_export.py`.

## Objective

Pure-db export to JSONL/CSV in the stable long format, with `--joined` denormalization so a
pandas user never joins back to the source. Never requires a running server (invariant #10).

## Required reading

- `docs/design/04-cli.md` §5 — **normative: columns, defaults, formats**
- `docs/design/07-import-export.md` §8 (restated contract + the pandas snippet)
- `01-interfaces.md` §8 (frozen signature + column order)

## Implementation notes

- Column order per `01-interfaces.md` §8 is a **stable API** — snapshot-test it (EXP-01).
  `value.<field>` columns follow the task's resolved-schema field order (read
  `tasks.resolved_schema`, not the annotation's `values` keys).
- `turn_index`: parsed from the target id (`"{trace}#{idx}"`) for turn-level; `None`/empty
  for trace-level. `trace_id` for turn-level rows is the prefix of the target id.
- **JSONL:** one object per row, `values` nested as an object (07 §8's pandas snippet must
  work against it). **CSV:** `value.<name>` flattened; multi-select cells are JSON-array
  strings (`'["a","b"]'` — `json.dumps`, not str()); stdlib `csv` module,
  `newline=""` on open (Windows).
- Skipped rows appear with empty values unless `--status labeled` (04 §5). `--status`
  filters on the annotation `status` column; `all` is the default.
- `--joined` per 04 §5: turn-level adds `role, content, content_type` from the turn row;
  trace-level adds the full serialized `messages` (reconstruct as a JSON array of the
  stored turn rows' verbatim fields — content strings pass through untouched) and trace
  `metadata` as `trace_metadata`.
- Output: `out=None` → `Path.cwd()/f"{task}-annotations.{fmt}"`; `Path("-")` → stdout
  (`sys.stdout`, no file writes). Unknown task → UserError listing existing tasks
  (`db.list_tasks`). Print the row count + output path to **stderr** so `--out -` stays
  clean data-on-stdout (04 §9).
- Read the `suggestions` table never — EXP-07 pins that only `annotations` is exported (08 §1).

## Tests

Matrix rows **EXP-01 … EXP-07**. Build the db in-test via `db` functions (no CLI): import
2 traces, create a turn-level task with a multi-select field, commit 3 annotations (one
skipped, one with prefill_model), one suggestion row that must not appear.

## Verification

```
pytest tests/test_export.py -q
```

## Out of scope

CLI flag parsing (P8 calls in with parsed args), any HTTP surface, agreement metrics or
summaries (non-goal, 00 §6).
