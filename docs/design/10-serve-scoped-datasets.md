# 10 — Serve-time dataset scoping (proposal)

**Status:** Implemented.

## Context

tracelabel stores one SQLite db per project directory, and today a task's labeling queue is
**every trace in the db** (`TaskRepository.build_queue` → `SELECT id FROM traces`). The data
file passed to `serve` only controls what gets *imported*, not what gets *served*. This breaks
the tool's own slogan ("the JSONL file is the dataset") and the core weekly eval workflow:

- You can't label just the most recent batch (`serve week-28.jsonl` shows all 700 traces, not 200).
- You can't run different judge dimensions over different subsets in one db (dataset-per-task,
  or overlapping-subset scenarios).
- Importing a new batch retroactively "un-completes" every finished task and re-scrambles
  shuffled queues.

**The change:** `tracelabel serve <data-file>` (and `suggest`) scopes the session's queue and
progress to the traces contained in that file. The db remains the shared pool — traces stored
once, annotations keyed by `(task, target_id, annotator)` accumulate across sessions, and
`export`/`tasks list` stay db-wide (lifetime views). The file becomes a *lens* over the pool;
nothing about it is persisted. No schema change, no migration, no new entity.

This is a deliberate behavior change: previously, serving a file surfaced the entire db. Scoping is
the default but opt-out — `serve --all` (§7) restores the whole-db queue for the rare "label the
entire pool" case.

## Implementation

### 1. Repo layer: imports report which trace ids the file contains
`src/tracelabel/db/traces.py`
- Change `import_trace` / `import_document` / `_handle_existing` to return
  `tuple[ImportResult, str]` — the result plus the trace id (user-provided or generated
  `t_<hash>`/`d_<hash>`). The id is already computed locally in each method.

`src/tracelabel/imports/service.py`
- Add `trace_ids: list[str] = field(default_factory=list)` to `ImportSummary`.
- In `import_file`, unpack `(result, trace_id)` and append every id — for `inserted`,
  `skipped_duplicate`, **and** `skipped_conflict` (the trace exists in the db under that id in
  all three cases; invalid lines contribute nothing). Dedupe while preserving file order
  (generated-id duplicates are possible; provided-id duplicates already raise).

### 2. Queue construction: scoped list, file order, shuffle on top
`src/tracelabel/db/tasks.py`
- Change `build_queue(self, task_name, trace_ids: list[str] | None = None) -> list[str]`: when
  given the session's trace ids (file order), scope to them instead of `SELECT id FROM traces`;
  when `None`, fall back to the existing db-wide `SELECT id FROM traces ORDER BY imported_at, id`
  (this is the `serve --all` path, §7). Apply the task's stored `shuffle_seed` to whichever list
  exactly as today. File order replaces `imported_at, id` as the sequential order for the scoped
  case — deterministic and matches user intent. Only caller is `ServeCommand`.

`src/tracelabel/cli/commands.py` (`ServeCommand.execute`)
- Add a `serve_all: bool` param. Pass `summary.trace_ids` into `build_queue` by default, or call
  `build_queue(config.name)` (db-wide, `trace_ids=None`) when `serve_all` is set (§7). Everything
  downstream (`create_app`, `LabelingService`) already receives the queue as a list — the queue
  flows through `/api/queue` and the SPA with no frontend change, scoped or not.

### 3. Progress: report against the session's working set
`src/tracelabel/api/labeling.py`
- `queue()` is already scoped (iterates `self._queue`). Fix `progress()`: it currently sums
  `target_counts(...)` over **all** traces in the db. Restrict the sum to trace ids in
  `self._queue` (e.g. `queue_set = set(self._queue)`; sum only `counts[tid]` for
  `tid in queue_set`). Now "137/200" means "of this file, for this task".
- `trace_detail` / `put_annotation` stay unfiltered — annotating any known trace remains valid
  (harmless, and keeps the API honest about the pool).

### 4. Suggest: same lens
`src/tracelabel/db/annotations.py`
- Add optional `trace_ids: list[str] | None = None` to `unaddressed_targets`. When given,
  filter with an `IN` clause: turn-level on `t.trace_id`, trace-level on `tr.id`.

`src/tracelabel/cli/commands.py` (`SuggestCommand.execute`) and `cli/app.py`
- Have `suggest` run the same idempotent `import_file` on the target first (it currently
  doesn't import at all), then pass `summary.trace_ids` to `unaddressed_targets`. This makes
  `suggest week-28.jsonl --task empathy` suggest only over week 28.

### 5. Provenance hardening (quality-traceback from label → dataset file)
The db never records which file a trace came from (`traces.source` is the adapter name);
traceback works by joining exported `trace_id` against the dataset file's ids, or by filtering
on user-stamped `trace_metadata`. Two small fixes make that reliable:

`src/tracelabel/exporting/service.py` (`_build_row`, turn-level branch ~line 93)
- Include `trace_metadata` (and `source`) on **turn-level** `--joined` rows too — today only
  trace-level joined rows carry it, so turn-level tasks can't see provenance metadata in export.
  Fetch the trace row alongside the turn; add the columns to `CsvSerializer.columns` for the
  turn-level joined case.

Docs: state the provenance discipline precisely.
- Provenance is **user-supplied**, not synthesized by tracelabel. The CTF input format accepts a
  `metadata: {}` object on traces, documents, **and** per-message turns (`TraceIn` / `DocumentIn` /
  `MessageIn`, all `extra="allow"`, `src/tracelabel/ctf/models.py`). Give traces explicit `id`s
  (ideally production trace ids) and stamp dataset/batch info into `metadata` when cutting a file.
- Stamp at the **trace/document level** — a dataset tag is a property of the whole trace/batch. The
  §5 fix carries trace `metadata` (+ `source`) onto turn-level `--joined` rows so turn tasks can
  filter too. Trace-level joined already carries `trace_metadata`
  (`src/tracelabel/exporting/service.py` ~line 108); documents are stored as trace rows, so
  document exports are covered already.
- Known limitation: per-message `metadata` lands in `turns.metadata` but is **not** surfaced in
  turn-level task exports today (only `role`/`content`/`content_type`, `service.py` ~line 90) — so
  it is not the provenance vector; trace-level metadata is.
- Gotcha: the per-trace `source` field is not a usable channel — `traces.source` is overwritten
  with the adapter name at import and isn't exported. Use `metadata`.

### 6. CLI output & docs
- `cli/output.py` `print_import_summary`: unchanged counts; in `serve`, echo the session scope,
  e.g. `task 'empathy' (turn-level) · 200 traces from week-28.jsonl` (scoped) or
  `task 'empathy' (turn-level) · 700 traces (whole db)` under `--all` (§7).
- Update `README.md` (Quickstart + a short "One db, many files" paragraph: pool semantics,
  file-as-lens, `--all` escape hatch, export is db-wide), `docs/design/02-database.md` §7 note,
  `docs/design/04-cli.md` serve/suggest semantics, `docs/design/05-http-api.md` progress semantics.
- Note the behavior change prominently (serving a file no longer surfaces unrelated traces
  already in the db; use `--all` to opt back into the whole-db queue).

### 7. `serve --all` escape hatch (opt out of scoping)
File-as-lens is the default; `--all` restores the old whole-db queue for the rare "label the entire
pool" case. Scoping is opt-out, not mandatory.

`src/tracelabel/cli/app.py` (`serve`)
- Add `all_: Annotated[bool, typer.Option("--all")] = False`; thread it into `ServeCommand.execute`.

`src/tracelabel/cli/commands.py` (`ServeCommand.execute`)
- Accept `serve_all: bool`. When set, call `build_queue(config.name)` (db-wide, `trace_ids=None`,
  §2); otherwise `build_queue(config.name, summary.trace_ids)`.

Semantics to document: `serve <file> --all` **still imports the named file** (idempotent, as today),
then labels the entire db pool — the file is used for import, not scoping. With no file and a
`config.yaml`, `serve --all` labels the whole pool without adding anything new.

## Files to modify
- `src/tracelabel/db/traces.py` — return ids from import methods
- `src/tracelabel/imports/service.py` — collect `trace_ids` on `ImportSummary`
- `src/tracelabel/db/tasks.py` — `build_queue(task_name, trace_ids=None)` (scoped, or db-wide when `None`)
- `src/tracelabel/db/annotations.py` — optional `trace_ids` filter in `unaddressed_targets`
- `src/tracelabel/cli/app.py` — `--all` flag on `serve`
- `src/tracelabel/cli/commands.py` — wire summary ids through serve + suggest; `serve_all` param
- `src/tracelabel/exporting/service.py` + `serializers.py` — trace_metadata/source on turn-level joined rows
- `src/tracelabel/cli/output.py` — session-scope line
- `README.md`, `docs/design/{02,04,05}-*.md`
- Tests: `tests/test_db.py` (import return tuple, build_queue), `tests/test_api.py`
  (scoped queue/progress fixtures), `tests/test_cli.py` (serve scoping end-to-end),
  `tests/test_suggest.py` (scoped targets), `tests/test_adapters.py` if it asserts on
  `ImportSummary` shape.

## Verification
1. `uv run pytest` — full suite green.
2. End-to-end in scratchpad: create `a.jsonl` (3 traces) and `b.jsonl` (2 different traces) in
   one directory. `serve a.jsonl --task empathy --no-browser` → `GET /api/queue` returns
   exactly 3 entries; `GET /api/progress` total = 3 (turn-level: labelable turns of those 3).
   Label one, stop. `serve b.jsonl --task empathy` → queue is 2, progress 0/2, db contains all
   5 traces (`sqlite3 .tracelabel/tracelabel.db 'select count(*) from traces'` → 5). Re-serve
   `a.jsonl` → 3 entries, prior annotation still present.
3. `export --task empathy` returns annotations from both sessions (db-wide union);
   `export --task empathy --joined` on a turn-level task includes `trace_metadata`, and
   filtering rows by `trace_id ∈ ids(a.jsonl)` recovers exactly session-1's labels.
4. `suggest b.jsonl --task empathy --limit 1` only targets traces from `b.jsonl`.
5. `--all` escape hatch: with all 5 traces in the db, `serve a.jsonl --all --no-browser` →
   `GET /api/queue` returns all 5 entries (not just `a.jsonl`'s 3); the scope line reads
   `… · 5 traces (whole db)`.
6. e2e Playwright smoke (`e2e/`) still passes — queue endpoint shape unchanged.

## Out of scope (explicitly)
- No dataset entity / persisted membership — rejected by design.
- No stored `source_file`/dataset column on `traces`. The pool dedups across files (a re-imported
  trace is `skipped_duplicate`), so a single column could only record *first-import origin*, not
  membership — misleading in exactly the overlapping-batch case. Provenance is user `metadata`
  (§5) + join-on-`trace_id`, not a stored field.
- Hash-stable shuffle ordering across a *growing single file* — separate, smaller follow-up;
  within a fixed served file the existing seeded shuffle is already stable.
- `tasks list` stays db-wide (lifetime view); no cohort breakdown in this change.
