# tracelabel — Implementation Plan (parallel-agent edition)

**Companion to:** [`refactor-report.md`](./refactor-report.md) · **Date:** 2026-07-26

Structured as **20 work packets across 5 waves**, each packet owning a disjoint set of files so agents can run concurrently without merge conflicts. Peak useful concurrency is **5–6 agents**.

**Approved decisions carried in from the report:** general labeling foundation first, eval screens after · `~/.tracelabel/` workspace with `--dir PATH` override · one front-door command plus a separately-documented automation set.

---

## 1. The parallelism model

Three structural moves make this parallelizable at all. They are not cosmetic — without them, ~15 of the 20 packets serialize behind two files.

| Move | Turns | Into |
|---|---|---|
| **Wave 0 writes every shared contract** — API models, TS types, DDL, route wiring, mock fixtures | a rolling merge conflict | a frozen interface nobody edits again |
| **Split `api/routes.py` → `api/routes/*.py`** | 1 contended file | 8 independently-owned files |
| **Split `frontend/src/api/{client,queries}.ts` → per-domain modules + barrel** | 2 contended files | 12 independently-owned files |

The fourth move is the biggest: **Wave 0 extends `frontend/src/mocks/fixtures.ts` to cover every new endpoint.** The repo already has a full mock API behind `VITE_MOCK=1` (`api/client.ts:47-49`, `mocks/fixtures.ts`, 376 lines). Once the mocks cover the new routes, **the entire frontend track runs to completion without a working backend.**

```
                    Wave 0 — contracts (2 agents, parallel)
                    W0-BE: schema, models, wiring
                    W0-FE: TS types, client/queries split, mocks
                                    │
             ┌──────────────────────┴──────────────────────┐
      BACKEND TRACK                                 FRONTEND TRACK
      Wave 1 (4 agents)                             Wave F1 (1 agent — router shell)
      workspace · impact · tasks · sources                  │
             │                                      Wave F2 (5 agents — screens)
      Wave 2 (5 agents)                             list · import · rubric · home · settings
      route modules + labeling service
             └──────────────────────┬──────────────────────┘
                                    │
                    Wave 3 — integration (3 agents)
                    CLI · docs · e2e
```

**Run each packet in its own git worktree** (`isolation: "worktree"` on the Agent tool). Frontend packets need `npm --prefix frontend ci` per worktree — budget for it, or reuse one worktree for a sequential pair of frontend packets.

**Only the integration wave runs `npm --prefix frontend run build`.** It writes to the gitignored `src/tracelabel/static/`, and per `CLAUDE.md` that directory is never edited or committed.

---

## 2. Contention map

Every file that more than one packet would otherwise touch, and how it is defused.

| File | Contended because | Resolution |
|---|---|---|
| `src/tracelabel/api/models.py` | every route adds request/response models | **W0-BE writes all of them.** Frozen afterward |
| `src/tracelabel/api/app.py` | every route registers itself | **W0-BE writes the wiring** importing stub modules |
| `src/tracelabel/api/routes.py` | one module, eight domains | **Split into `api/routes/*.py`**, one owner each |
| `src/tracelabel/db/migrations.py` | stepper + v3 DDL | **W0-BE only.** Single owner, forever |
| `src/tracelabel/db/tasks.py` | schema hash *and* config resolution both land here | **W1-C only** |
| `tests/helpers.py` | every test packet wants a fixture | W0-BE writes `temp_workspace()`/`make_task_spec()`; **append-only** after, and only at end of file |
| `frontend/src/api/types.ts` | every screen needs types | **W0-FE writes all of them.** Hand-synced to §3, frozen |
| `frontend/src/api/client.ts` | one `Api` interface, one object literal | **Split into `api/client/{domain}.ts` + barrel** |
| `frontend/src/api/queries.ts` | one `qk` object, all hooks | **Split into `api/queries/{domain}.ts` + barrel** |
| `frontend/src/mocks/fixtures.ts` | one `mockApi` matching `Api` | **W0-FE splits it per domain** alongside the client |
| `frontend/package.json`, `pyproject.toml` | dependency adds | **Wave 0 only.** No later packet adds a dependency |
| `README.md`, `docs/design/*` | many packets have doc implications | **W3-DOCS only**, last, after everything merges |
| `src/tracelabel/static/` | generated SPA output | **Never touched.** Integration wave builds it |

**Rule for every agent brief:** *"You may READ any file. You may WRITE only the files in your OWNS list. If you believe you need to write outside it, stop and report instead."*

---

## 3. The API contract

**Authoritative.** W0-BE and W0-FE both implement from this table, in parallel, which is what lets Wave 0 be two agents instead of one.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/settings` | — | `Settings` |
| PATCH | `/api/settings` | `SettingsPatch` | `Settings` |
| GET | `/api/projects` | — | `list[ProjectSummary]` |
| POST | `/api/projects` | `ProjectCreate` | `ProjectSummary` |
| GET | `/api/projects/{p}` | — | `ProjectDetail` |
| DELETE | `/api/projects/{p}` | — | `204` |
| GET | `/api/projects/{p}/sources` | — | `list[SourceOut]` |
| POST | `/api/projects/{p}/imports/preview` | `ImportPreviewIn` | `ImportPreview` |
| POST | `/api/projects/{p}/imports` | `ImportIn` | `JobRef` |
| GET | `/api/projects/{p}/tasks` | — | `list[TaskSummary]` |
| POST | `/api/projects/{p}/tasks` | `TaskCreate` | `TaskDetail` |
| GET | `/api/projects/{p}/tasks/{t}` | — | `TaskDetail` |
| PATCH | `/api/projects/{p}/tasks/{t}` | `TaskPatch` | `TaskDetail` |
| GET | `/api/projects/{p}/tasks/{t}/schema` | — | `SchemaOut` |
| PATCH | `/api/projects/{p}/tasks/{t}/schema?confirm=` | `SchemaPatch` | `SchemaOut` · **409 `SchemaImpactOut`** |
| GET | `/api/projects/{p}/tasks/{t}/session` | — | `SessionInfo` *(existing shape)* |
| GET | `/api/projects/{p}/tasks/{t}/queue` | — | `list[QueueEntry]` *(existing)* |
| GET | `/api/projects/{p}/tasks/{t}/traces/{id}` | — | `TraceDetail` *(existing)* |
| PUT | `/api/projects/{p}/tasks/{t}/annotations` | `AnnotationIn` | `AnnotationOut` *(existing)* |
| GET | `/api/projects/{p}/tasks/{t}/progress` | — | `Progress` *(existing)* |
| GET | `/api/projects/{p}/tasks/{t}/export` | query | streaming file |
| GET | `/api/projects/{p}/tasks/{t}/items` | query | `ItemPage` *(Phase 2)* |
| GET | `/api/projects/{p}/tasks/{t}/stats` | — | `TaskStats` *(Phase 3)* |
| POST | `/api/projects/{p}/tasks/{t}/suggestions` | `SuggestIn` | `JobRef` *(Phase 3)* |
| GET | `/api/jobs/{job_id}` | — | `JobStatus` |

The five `SessionInfo` / `QueueEntry` / `TraceDetail` / `AnnotationIn`/`Out` / `Progress` models keep their current field lists (`api/models.py:9-105`) — only their **paths** change. That is what keeps the labeling view untouched.

Errors keep the existing mapping: `NotFoundError → 404`, `UserError → 422` (`api/app.py:30-36`), plus the new `409` carrying `SchemaImpactOut`.

---

## 4. Packets

### Wave 0 — Contracts · 2 agents · blocks everything

#### `W0-BE` — backend contracts & schema

**OWNS**
```
src/tracelabel/db/migrations.py          rewrite: stepper + v3 DDL
src/tracelabel/config/resolver.py        add compat_hash()
src/tracelabel/config/impact.py          NEW — types only, NotImplementedError bodies
src/tracelabel/config/models.py          drop data_path; add TaskSpec
src/tracelabel/workspace/{__init__,models,workspace}.py   NEW — signatures only
src/tracelabel/jobs.py                   NEW — full implementation (small, blocks others)
src/tracelabel/api/models.py             ALL models from §3, final
src/tracelabel/api/deps.py               NEW — TaskContext + FastAPI dependencies
src/tracelabel/api/app.py                rewrite: create_app(workspace)
src/tracelabel/api/routes/*.py           NEW — 8 stub modules, empty routers, registered
tests/helpers.py                         add temp_workspace(), make_task_spec()
```

Migration stepper — callables, not SQL strings, because the v3 backfill needs Python:

```python
Migration = Callable[[sqlite3.Connection], None]
SCHEMA_VERSION = 3
MIGRATIONS: list[tuple[int, Migration]] = [(2, _to_v2), (3, _to_v3)]

def upgrade(connection: sqlite3.Connection) -> None:
    version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if version > SCHEMA_VERSION:
        raise EnvError(f"Database schema v{version} is newer than this tracelabel "
                       f"({SCHEMA_VERSION}). Upgrade: pip install -U tracelabel")
    for target, step in MIGRATIONS:
        if version < target:
            with connection:
                step(connection)
                connection.execute(f"PRAGMA user_version = {target}")
```

`_to_v2` executes the existing `_DDL_002` unchanged so v2 databases upgrade in place. `_to_v3`:

```sql
CREATE TABLE sources (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    path        TEXT,
    adapter     TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    trace_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE trace_sources (
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    trace_id  TEXT    NOT NULL REFERENCES traces(id)  ON DELETE CASCADE,
    PRIMARY KEY (source_id, trace_id)
);
CREATE INDEX idx_trace_sources_trace ON trace_sources(trace_id);

ALTER TABLE tasks ADD COLUMN compat_hash          TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN queue_scope          TEXT NOT NULL DEFAULT '{"type":"all"}';
ALTER TABLE tasks ADD COLUMN annotator            TEXT;
ALTER TABLE tasks ADD COLUMN llm_model            TEXT;
ALTER TABLE tasks ADD COLUMN llm_temperature      REAL;
ALTER TABLE tasks ADD COLUMN llm_max_tokens       INTEGER;
ALTER TABLE tasks ADD COLUMN suggest_instructions TEXT;
ALTER TABLE tasks ADD COLUMN review_of            TEXT;
ALTER TABLE tasks ADD COLUMN review_labels_from   TEXT NOT NULL DEFAULT 'judge';
```

…then backfill `compat_hash` in Python from each row's stored `resolved_schema`.

The hash split — the single most important correctness change in the plan (report §3):

```python
def compat_hash(fields: list[dict[str, Any]]) -> str:
    """Hash only what can invalidate an existing annotation: field names and types.

    Cosmetic edits (label, help, placeholder, order) and additive edits
    (a new optional field, a new option on a select) leave this unchanged.
    """
    return sha256_hex(canonical_json(
        sorted(({"name": f["name"], "type": f["type"]} for f in fields),
               key=lambda f: f["name"])
    ))
```

Keep writing the full `schema_hash` onto every annotation — it is part of the documented export column contract (`README.md:247`), so nothing downstream breaks. `compat_hash` is only the *gate*.

`api/deps.py` resolves a `TaskContext` per request and constructs `LabelingService` (cheap — it only stores references). **Make the queue a `functools.cached_property`** so `PUT /annotations`, which fires on every commit, never builds it.

**DONE:** `uv run pytest -q` green (old tests may be marked xfail with a linked packet ID), `uv run mypy src/tracelabel` clean, every §3 route returns 501 from a registered stub.

#### `W0-FE` — frontend contracts

**OWNS**
```
frontend/src/api/types.ts                all §3 types, hand-synced
frontend/src/api/client/{settings,projects,sources,imports,tasks,schema,labeling,exports,jobs}.ts
frontend/src/api/client/index.ts         barrel + VITE_MOCK swap
frontend/src/api/queries/{same domains}.ts + index.ts
frontend/src/mocks/{settings,projects,imports,tasks,labeling}.ts + index.ts
frontend/package.json                    + react-router-dom@^6, @tanstack/react-table@^8
```

Each client module exports its own narrow interface and both an HTTP and a mock implementation; the barrel picks per `VITE_MOCK`. Preserve the existing `json<T>()` error helper (`client.ts:19-30`) — move it to `client/http.ts`.

**Delete `staleTime: Infinity` from `useSession`** (`queries.ts:16`) — the schema is no longer fixed for the process lifetime, and that line would make the rubric editor silently not work.

**DONE:** `npm --prefix frontend run typecheck` clean, existing tests pass, `VITE_MOCK=1 npm run dev` renders the current labeling UI against the new mock modules.

---

### Wave 1 — Backend core · 4 agents in parallel

| Packet | OWNS | Notes |
|---|---|---|
| **W1-WORKSPACE** | `src/tracelabel/workspace/*` (implement) · `db/locking.py` · `db/database.py` | Layout below. Move `ProjectLock` to the workspace root — keep its PID-probe logic (`locking.py:13-66`) intact. **Add a `threading.RLock` around `Database.transaction()`** (`database.py:70`): `check_same_thread=False` is already set (`database.py:37`), which permits sharing but does not make it safe once imports run in a background thread. |
| **W1-IMPACT** | `src/tracelabel/config/impact.py` (implement) · `tests/test_schema_impact.py` | `SchemaImpactAnalyzer.analyze(task, old, new) -> SchemaImpact` with `removed_fields`, `retyped_fields`, `removed_options`, `affected_annotations`, `breaking`. Check option removal against **stored values**, not the schema — dropping an unused option is non-breaking. Good hypothesis target. |
| **W1-TASKS** | `src/tracelabel/db/tasks.py` · `tests/test_db_tasks.py` | Delete the stdin `confirm` seam (`tasks.py:31-32, 51-58`); split `open()` into `create(spec)` and `update_schema(name, fields, *, confirmed)`. Add `resolve(name) -> ResolvedTaskConfig` built from the row. `build_queue` reads `queue_scope`, still applying `shuffle_seed`. |
| **W1-SOURCES** | `src/tracelabel/db/sources.py` (NEW) · `src/tracelabel/imports/service.py` · `tests/test_import_preview.py` | `SourceRepository` + `ImportService.preview(source, from_=None, limit=3) -> ImportPreview` returning detected adapter, first N converted traces, and validation errors — **writing nothing**. `AdapterRegistry.detect` already sniffs only the first 5 values (`imports/parsing.py:171`), so this is cheap. **Do not modify `imports/adapters/`.** |

Workspace layout (W1-WORKSPACE):

```
~/.tracelabel/                 # or <--dir>/.tracelabel/
  settings.json                # annotator, default llm model, theme
  lock                         # one workspace lock
  projects/
    support-triage/
      project.json             # {name, slug, created_at, notes}
      tracelabel.db
```

`--dir PATH` sets the root to `PATH/.tracelabel` — **one concept, one code path**, and a `--dir .` workspace can still hold several projects. `TRACELABEL_HOME` exists so tests never touch the real home directory. Slugs: lowercase, non-alphanumerics → `-`, collapsed and trimmed, `^[a-z0-9][a-z0-9-]*$`, collisions get `-2`.

`ResolvedTaskConfig` (`config/models.py:97`) **stays** — `LabelingService`, `AnnotationValidator`, `SuggestionService` and `ExportService` all consume it and none need to change. Only its *source* moves from YAML to the database.

---

### Wave 2 — API · 5 agents in parallel · after Wave 1 merges

One agent per route module. All write against `api/models.py` and `api/deps.py`, which are frozen.

| Packet | OWNS |
|---|---|
| **W2-PROJECTS** | `api/routes/{projects,settings}.py` · `tests/test_api_projects.py` |
| **W2-TASKS** | `api/routes/tasks.py` (incl. `PATCH /schema` → 409 `SchemaImpactOut`) · `tests/test_api_tasks.py` |
| **W2-IMPORTS** | `api/routes/{imports,jobs}.py` · `tests/test_api_imports.py` |
| **W2-LABELING** | `api/labeling.py` (drop frozen `config`/`queue`) · `api/routes/labeling.py` · `tests/test_api_labeling.py` |
| **W2-EXPORT** | `api/routes/exports.py` · `tests/test_api_export.py` — thin wrapper over the **unchanged** `ExportService` (`exporting/service.py:36`); the CLI path stays server-free |

---

### Frontend track — runs concurrently with backend Waves 1–2

Everything here works against `VITE_MOCK=1`. No backend dependency.

#### `F1-SHELL` · 1 agent · after W0-FE

**OWNS** `frontend/src/App.tsx` · `main.tsx` · `frontend/src/routes/*` · `frontend/src/components/AppShell/*`

```
/                                  ProjectList
/p/:project                        ProjectHome        — tasks + sources
/p/:project/import                 ImportWizard
/p/:project/t/:task/schema         RubricEditor
/p/:project/t/:task/label[/:trace] LabelView          — today's App.tsx, extracted
/p/:project/t/:task/items          DataManager        — Phase 2
/p/:project/t/:task/results        Results            — Phase 3
/settings                          Settings
```

Extracts the current `NavProvider > Workspace` tree (`App.tsx:35-41`) into `LabelView`, taking `project`/`task` from route params. **Creates placeholder screen components** so F2 agents each fill in one without touching the router.

**Everything under `components/renderers/`, `presentation/`, `keyboard/` and the labeling components stays untouched** — ~2,300 lines of the best code in the repo.

#### `F2-*` · 5 agents in parallel · after F1-SHELL

Each owns exactly one directory under `frontend/src/components/screens/`.

| Packet | OWNS | Notes |
|---|---|---|
| **F2-PROJECTS** | `screens/ProjectList/*` | Cards, New-project dialog, **Start from demo data** button routing through the normal import path — `demo` stops being a special CLI code path |
| **F2-IMPORT** | `screens/ImportWizard/*` | Drop zone / paste / path → *"Detected: Google ADK sessions · 412 traces"* → **first 3 traces rendered with the real `TracePane` components** → Import. `--from`/`--skip-invalid`/`--include-all-spans`/`--on-conflict` become labeled options under "Advanced" |
| **F2-RUBRIC** | `screens/RubricEditor/*` | Form builder over the three field types; preset gallery; **live preview renders the real `AnnotationPane`/`FieldRenderer`** — `FieldRenderer.tsx:13-14` already documents that it just renders `session.fields`, which is what makes this work. Breaking-change dialog: *"Removing `failure_modes` affects 47 annotations — Fork to a new task / Remove anyway / Cancel"* |
| **F2-HOME** | `screens/ProjectHome/*` | Task list, source list, new-task dialog (name, level, queue scope, starting preset) |
| **F2-SETTINGS** | `screens/Settings/*` | Annotator name, default LLM model, theme. **No API key field** — env vars only, per invariant #9 |

---

### Wave 3 — Integration · 3 agents · after both tracks merge

| Packet | OWNS |
|---|---|
| **W3-CLI** | `cli/app.py` · `cli/commands.py` · `tests/test_cli.py` |
| **W3-DOCS** | `README.md` · `CLAUDE.md` · `docs/design/*` |
| **W3-E2E** | `e2e/*` |

**W3-CLI** — the final surface:

```bash
tracelabel [TARGET]      --port --no-browser --dir
tracelabel demo          --port --no-browser
tracelabel import FILE   --project --dir
tracelabel suggest       --project --task --dir --limit --overwrite
tracelabel export        --project --task --dir --format --out --status --joined
```

Root callback becomes the launcher (`invoke_without_command=True`). **Delete `serve` and `tasks list`.** `ServeCommand` → `AppCommand`. **Give `ImportCommand`, `ExportCommand`, `SuggestCommand` real `__init__` constructor DI** — they currently hardcode collaborators (`cli/commands.py:144, 170, 205`), violating `CLAUDE.md` rule 3. Keep `ServerRunner` (`commands.py:53`) as-is; it is already the house pattern.

**W3-DOCS** — rewrite `README.md` around one command; delete the `serve`/`import` comparison, the flag inventory, and the `config.yaml` section from the front page. Fix report §9 bugs 1–4, 8, 9 — most evaporate with the YAML docs. Retire `docs/design/03-config.md`, `04-cli.md`, `05-http-api.md`, `06-frontend.md`; amend `00-overview.md` with the three revocations from report §8. Update the `CLAUDE.md` Commands table.

**W3-E2E** — boot `tracelabel --dir <tmp> --no-browser --port 8399`, drive create → import → rubric → label.

---

## 5. Packet brief template

Every agent starts cold. Each brief must contain all seven fields, or it will invent an incompatible interface.

```
PACKET: W1-TASKS
REPO:   /Users/danielkashkett/Code/tracelabel  (read CLAUDE.md first — house rules are enforced)

OWNS (write only these):
  src/tracelabel/db/tasks.py
  tests/test_db_tasks.py

READ FOR CONTEXT (do not write):
  src/tracelabel/config/models.py      — ResolvedTaskConfig you must return
  src/tracelabel/config/resolver.py    — compat_hash() you must call
  src/tracelabel/db/migrations.py      — the v3 columns you read
  docs/refactor-plan.md §4 Wave 1

CONTRACT: the signatures already exist in the repo from Wave 0. Implement them
  exactly. Do not change any signature — other packets are compiling against them.

TASK: <the packet's Notes column, verbatim>

CONSTRAINTS:
  - Class-based OOP, constructor DI with real defaults (CLAUDE.md rule 3)
  - Stdlib first; readability over cleverness
  - Typed errors from src/tracelabel/errors.py, never bare SystemExit
  - Never touch src/tracelabel/static/

DONE WHEN:
  uv run pytest -q tests/test_db_tasks.py   passes
  uv run mypy src/tracelabel                clean
  uv run ruff check src tests               clean

IF BLOCKED: if you need to write a file outside OWNS, stop and report which file
  and why. Do not edit it.
```

---

## 6. Later phases

Both run as their own wave pairs (backend packets + frontend packets in parallel), using the same ownership discipline.

**Phase 2 · Data manager** — `GET .../items` with paginate/sort/search/filter (status, field value, annotator, source, has-suggestion, agreement). New `db/items.py`; the JSON1 extension is already in use (`db/tasks.py:159`), so filtering on annotation values needs no new dependency. Extend `queue_scope` to accept `{"type":"filter", ...}` — the mechanism behind "label just the failures". Frontend: `@tanstack/react-table`, filter bar, bulk actions, row-click into the label view. `TraceDrawer.tsx` — the unfiltered chip strip — is deleted or reduced to a position indicator.

**Phase 3 · Eval loop** — (a) `POST .../suggestions` runs `SuggestionService` (`suggestions/service.py:56`, already bounded-concurrency async with retry) through the Wave 0 `JobRunner`, with a model picker and live progress; (b) `GET .../stats` → judge-vs-human agreement and confusion, with a **"show only disagreements"** filter handing off to the data manager, and review mode becoming a task setting rather than the `--review-of` flag; (c) **error analysis** — freeform notes → *"Cluster my notes into failure modes"* → review the proposed taxonomy → accept as a `multi_select` field, non-destructive thanks to the hash split; (d) cleanup of report §9 bugs 5, 6, 7, 10, 11.

---

## 7. Integration & verification

**At each wave boundary**, merge all packets, then run the full suite and fix seams before launching the next wave. Do not start a wave with the previous one unmerged — the contract files are only frozen if everyone shares the same copy.

```bash
uv run pytest -q
uv run mypy src/tracelabel
uv run ruff check src tests && uv run ruff format --check
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build          # integration wave only → src/tracelabel/static/index.html
cd e2e && npx playwright test
```

**Order dependencies that are not negotiable.** W0-BE's hash split must land before F2-RUBRIC — shipping a rubric editor on the current all-inclusive hash would silently orphan annotations on every cosmetic edit. W1-WORKSPACE before W2-*. F1-SHELL before every F2-*.

**Non-negotiables that survive intact.** Loopback-only bind, no auth, no telemetry. API keys from env only. Content immutable and never reformatted. Suggestions never write to `annotations`. Export works with no server. No `dangerouslySetInnerHTML`; untrusted HTML stays in the sandboxed iframe. Never edit `src/tracelabel/static/`.

**Cold start — the north-star walkthrough.** `uvx tracelabel` in a clean environment → project list → create a project → drag in a JSONL → preview shows parsed traces → import → build a rubric in the UI → label 5 items → add an option to a select → **confirm all 5 labels survive** → export from the browser. Zero terminal commands after the first.

**Regression.** `tracelabel ./traces.jsonl` still lands directly in the labeling view · `tracelabel demo` still works · `tracelabel export --project X --task Y` still works with no server running · a v2 database upgrades to v3 in place without data loss.
