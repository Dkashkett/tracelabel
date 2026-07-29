# tracelabel — UX Investigation & Refactor Report

**Date:** 2026-07-26 · **Status:** Findings for review · **Next step (if agreed):** detailed implementation plan

---

## Context

tracelabel's goal is that a single developer can **import their data, label, iterate, and repeat**. The concern raised: there are too many CLI commands to remember, and the user experience has suffered. The benchmark is Label Studio — one command to start, add data through the GUI.

Nobody is using tracelabel yet, so sweeping changes to backend, UI, and docs are on the table. This report measures the current surface, diagnoses the real problem, benchmarks against Label Studio, and proposes a target shape with feasibility estimates.

**Decisions already taken** (from the pre-report questions):

| Fork | Decision |
|---|---|
| Positioning | **Both, sequenced** — general labeling foundation first, eval-specific screens layered on top |
| Storage | **`~/.tracelabel/projects/<slug>/` workspace, with opt-in `--dir .`** for a project rooted in the current directory |
| CLI surface | **One command + a small, separately-documented automation set** (`import` / `suggest` / `export` for CI) |

---

## 1. The diagnosis

> **The problem is not that there are too many commands. It's that the commands sit inside the iteration loop.**

Command count alone is not fatal — `git` has hundreds. What matters is *which* operations live on the CLI. The labeling loop is:

```
import  →  define rubric  →  label  →  read results  →  refine rubric  →  re-label
```

Steps 2, 4, 5 and 6 are **inherently iterative** — you do them dozens of times in an afternoon. In tracelabel today, every one of them requires leaving the browser:

| Loop step | What it costs today |
|---|---|
| Refine the rubric | Ctrl-C the server → edit YAML in another app → re-launch → reload the browser → **lose your position** (no URL state; `traceIdx` resets to 0, `navReducer.ts:40`) → answer a `[y/N]` stdin schema-drift prompt (`db/tasks.py:72`) |
| Read results | `tracelabel export` in a second terminal → open pandas in a third window |
| Add more data | Ctrl-C → `tracelabel import` → re-launch with `--all` |
| Check progress across tasks | Ctrl-C → `tracelabel tasks list` |

**The iteration loop crosses a process boundary.** That is the UX failure, and it is why the tool feels heavy despite being small and fast at the thing it does well (the labeling keystroke loop is genuinely excellent).

Fixing this makes the command-count problem largely dissolve on its own: `--task`, `--level`, `--annotator`, `--shuffle`, `--all`, `--review-of`, `--labels-from`, `--yes`, `--from`, `--on-conflict`, `--skip-invalid`, `--as-documents` and `--include-all-spans` are all **UI state wearing a flag costume**.

---

## 2. The current surface, measured

### CLI

**7 invocable commands · 32 flag slots · 23 unique flag names · 5 enum choice sets.**

| Command | Flags | Source |
|---|---:|---|
| `serve [target]` | 1 arg + 12 options | `cli/app.py:47-85` |
| `import <target>` | 1 arg + 6 options | `cli/app.py:88-109` |
| `export` | 6 options | `cli/app.py:112-128` |
| `suggest [target]` | 1 arg + 5 options | `cli/app.py:136-159` |
| `tasks list` | 1 option | `cli/app.py:131-133` |
| `demo` | 2 options | `cli/app.py:162-167` |

### HTTP API — **5 routes, exactly 1 of which writes**

`api/routes.py:17-33`: `GET /api/session`, `GET /api/queue`, `GET /api/traces/{id}`, **`PUT /api/annotations`**, `GET /api/progress`.

That single `PUT` is the entire write surface of the browser app. It is not a frontend omission — `docs/design/05-http-api.md:17` states the intent outright: *"Deliberately minimal: no DELETE, no export endpoint (export is CLI-only, invariant #10), no task CRUD."*

### What the UI cannot do

| Action | Today |
|---|---|
| Import data | **CLI only.** Zero `<input type="file">`, `FileReader`, `onDrop`, or `FormData` anywhere in `frontend/src` |
| Create/edit a label schema | **YAML file only**, and requires a server restart |
| Create or switch a project | **Does not exist as a concept** in the API |
| Export | **CLI only** |
| Trigger LLM suggestions | **CLI only** — the UI displays them but cannot request one |
| Enter review mode | **CLI flag only** (`--review-of`) |
| Change any setting | **Nothing is editable.** `Header.tsx:70-86` has exactly two controls: `← Back` and `?` |
| Deep-link to an item | **No router at all** — no routing library in `frontend/package.json`, nothing reads `window.location` |

### Codebase size (the good news)

| Area | Files | Lines |
|---|---:|---:|
| `src/tracelabel/` | 51 | **5,047** |
| `frontend/src/` (prod, excl. ~1,788 test lines) | 47 | **~3,470** |
| `tests/` | 12 | 4,119 |

~8,500 lines of production code. **Small enough to refactor aggressively.** The constraint is not size — it's one architectural decision, below.

---

## 3. The architectural root cause

Everything the UI needs to do is blocked by a single design choice: **one server process = one immutable `(project, task, annotator, schema, queue)`**, bound at startup and frozen thereafter.

```python
# api/app.py:15 — the config and the queue are constructor arguments
def create_app(database: Database, config: ResolvedTaskConfig, queue: list[str],
               static_dir: Path | None = None) -> FastAPI:
```

- `ResolvedTaskConfig` is `@dataclass(frozen=True)` (`config/models.py:97`)
- `LabelingService` holds `self._config` and `self._queue` as frozen instance state (`labeling.py:36-40`)
- The queue is a plain in-memory `list[str]` computed once in `ServeCommand.execute` (`cli/commands.py:134`)
- The frontend caches the schema with `staleTime: Infinity` (`api/queries.ts:16`), so even a server-side change never reaches an open tab
- `ProjectLock` (`db/locking.py:36`) hard-blocks a second process on the same directory

Four more constraints fall out of this:

1. **No project entity anywhere.** A "project" is just *the directory your JSONL happens to live in* (`cli/app.py:75`). There is no `projects` table. A browser cannot list, create, or switch something that has no representation.
2. **Queue scope is ephemeral.** The "file you serve is the queue" behaviour works by passing `ImportSummary.trace_ids` straight into `build_queue` (`commands.py:123`). Nothing durable records *which batch* a trace arrived in — so a UI has no way to offer "label the batch I just imported" after a restart.
3. **Schema drift is a stdin prompt.** `TaskRepository.open` calls `input()` (`db/tasks.py:31-32`) — unusable over HTTP without refactoring the injected `confirm` seam.
4. **No migration machinery.** `db/migrations.py:88-105` supports **only `0 → 2`**. Any other version raises *"Start a new project directory and re-import your traces."* Adding a table today means breaking every existing database. With zero users, this is a free moment to fix it — and it will not be free later.

**One more, subtle but load-bearing for the stated goal:** `schema_hash` is a sha256 over the *full* canonical field dicts, including cosmetic keys (`config/resolver.py:14-31`). Adding a `help:` string, renaming a label, or appending one option to a select **invalidates the hash and orphans every existing annotation**. Today that is tolerable because editing the rubric means editing a file. The moment the UI makes rubric editing a two-second action, users will do it constantly — and silently detach their work each time. **This must be fixed before schema editing ships, not after.**

---

## 4. Benchmark: Label Studio

Verified against current docs ([quick start](https://labelstud.io/guide/quick_start), [data manager](https://labelstud.io/guide/manage_data), [template gallery](https://labelstud.io/templates/)). Their path is: `pip install label-studio` → `label-studio start` → **sign up with an email and password** → Create project → Data Import (upload files) → Labeling Setup (choose a template, customise label names) → Save → label.

### Gaps tracelabel should close

| # | Label Studio capability | tracelabel today | Need it? | Cost |
|---|---|---|:--:|:--:|
| 1 | Starts with no arguments | Requires a file argument or a `./config.yaml` | ✅ | S |
| 2 | Project create/list/switch in the GUI | No project concept in the API | ✅ | M |
| 3 | Data import in the GUI (upload, cloud, paste) | CLI only | ✅ | M |
| 4 | **Template gallery + config editor with live preview** | YAML file + restart | ✅ **biggest** | M |
| 5 | **Data Manager** — table of items with filter, sort, search, saved views, bulk actions | `TraceDrawer.tsx:26-48` renders *every* trace as an unfiltered chip. Unworkable past ~200 items | ✅ | M–L |
| 6 | Export from the GUI (format picker + download) | CLI only, by explicit invariant | ✅ | S |
| 7 | Pre-annotations / ML backend for model predictions | `suggest` CLI batch only | ✅ (simpler) | M |
| 8 | Review workflow | `--review-of`, buried behind two flags and a magic JSONL key | ✅ | M |
| 9 | Project settings screen | None | ✅ | S |
| 10 | Deep links / URL state | None at all | ✅ | S |
| 11 | Sample data inside the product | `demo` is a separate command that makes a temp dir | ✅ | S |

### What tracelabel should **not** copy

Cloud-storage connectors · multi-user, roles, and inter-annotator agreement · images, audio, video, bounding boxes · webhooks and API tokens · an ML-backend HTTP service contract · **and above all, the signup wall.** Label Studio makes you create an email/password account to label your own data on your own laptop. tracelabel's zero-auth loopback posture is a genuine advantage and should be advertised, not quietly enjoyed.

---

## 5. Where tracelabel can beat Label Studio

Matching Label Studio is not "world class" — Label Studio is mediocre at precisely what tracelabel is for. Five differentiators, all of which the codebase is already partway toward:

**1 · Error analysis as a first-class screen.** The de-facto standard workflow for LLM eval development is: read traces → write freeform notes (*open coding*) → cluster those notes into a taxonomy (*axial coding*) → turn the taxonomy into a `multi_select` field → re-label against it. Label Studio cannot do this at all. tracelabel already has a `notes` text field and an LLM client; the missing piece is a **"cluster my notes into failure modes" action that proposes a `multi_select` field you accept into the schema.** This is the single most differentiated feature available, and it *is* the "iterate and repeat" the goal asks for.

**2 · Judge-alignment scoreboard.** tracelabel already stores an LLM judge as its own annotator, preserving its prediction alongside the human correction (`README.md:400-411`). What's missing is the number: agreement rate, per-class confusion, and a **"show me only the disagreements"** filter, live in the UI. For eval work the number *is* the product.

**3 · Non-destructive schema evolution.** Splitting the hash (§7) so that adding an option or a help string keeps every existing annotation, while genuinely breaking edits show *"this will orphan 47 annotations — migrate / fork to a new task / cancel."* No labeling tool does this well. It is what makes "iterate on the rubric" safe instead of terrifying.

**4 · Import preview instead of format flags.** The six adapters (`imports/adapters/`, 1,578 lines) are the hard-won part of this codebase and they keep working untouched. A UI that **parses the first few lines and shows you the resulting traces rendered, before anything is written**, is strictly better than remembering `--from adk --skip-invalid --as-documents --include-all-spans`. Auto-detect already only sniffs the first 5 values (`imports/parsing.py:171`), so a `preview()` path is cheap.

**5 · One-click prefill.** Label Studio makes you stand up an ML backend as an HTTP service. tracelabel can offer a "Prefill with GPT-4o" button that runs `SuggestionService` as a background job with a progress bar. Dramatically better, and mostly already written (`suggestions/service.py:56-91` already does bounded-concurrency async with retry).

---

## 6. Recommended target shape

### 6.1 CLI — 7 commands / 32 flags → 5 commands / ~11 flags

```bash
# Front door — the entire README quickstart
tracelabel                    # opens the app at http://127.0.0.1:8377
tracelabel ./traces.jsonl     # ...and imports this file into a project
tracelabel demo               # the 15-second pitch

# Automation — separate docs page, for CI and scripts
tracelabel import <file> [--project NAME]
tracelabel suggest --project NAME --task NAME
tracelabel export  --project NAME --task NAME [--format jsonl|csv] [--out PATH]
```

Surviving flags: `--port`, `--no-browser`, `--dir`, `--project`, `--task`, `--format`, `--out`, `--status`, `--joined`, `--limit`, `--overwrite`. **Happy path: one command, zero flags, zero YAML files.**

Deleted from the CLI (each becomes a UI action + an HTTP endpoint): `serve`'s `--task/--level/--annotator/--shuffle/--yes/--all/--review-of/--labels-from/--include-all-spans`, `import`'s `--from/--on-conflict/--skip-invalid/--as-documents`, and the `tasks list` command entirely.

**Keep `export` CLI-only-capable.** Design invariant #10 ("export never requires a running server") is genuinely good for CI. Add the HTTP route *in addition*, don't replace.

### 6.2 Storage

```
~/.tracelabel/
  lock                              # one workspace lock, replaces the per-directory lock
  projects/
    support-triage/
      project.json                  # name, created_at, notes
      tracelabel.db                 # unchanged per-project SQLite
    week-28-eval/
      ...
```

The project list is **a directory scan plus one small JSON read per project** — no index database to keep in sync, no new source of truth. `tracelabel --dir .` roots a project at the current directory instead, preserving today's "labels live next to my traces in git" workflow as an explicit opt-in.

### 6.3 Data model additions

- **`sources`** table — one row per import (filename, adapter used, timestamp, trace count) plus a `trace_sources` join. This gives batches a durable name, so "label the batch I imported on Tuesday" survives a restart. *(Requires revoking the `docs/design/00-overview.md:108` non-goal "a dataset entity" — that non-goal only made sense while the JSONL file *was* the queue.)*
- **`tasks.queue_scope`** — persist what the queue is scoped to (all traces / a source / a saved filter), replacing the ephemeral in-memory `list[str]`.
- **Real incremental migrations** — replace the `0 → 2`-only `upgrade()` with a numbered step list. Non-negotiable if the schema is going to move again.

### 6.4 API shape

`create_app(database, config, queue)` → **`create_app(workspace)`**, with `LabelingService` resolving `(project, task)` per request rather than holding frozen state. Routes become explicitly scoped and therefore deep-linkable:

```
GET    /api/projects                              POST   /api/projects
GET    /api/projects/{p}/sources                  POST   /api/projects/{p}/imports        (+ preview)
GET    /api/projects/{p}/tasks                    POST   /api/projects/{p}/tasks
PATCH  /api/projects/{p}/tasks/{t}/schema         ← the rubric editor, with an impact check
GET    /api/projects/{p}/tasks/{t}/items          ← the data manager: filter/sort/search/paginate
GET    /api/projects/{p}/tasks/{t}/queue          GET  .../traces/{id}
PUT    /api/projects/{p}/tasks/{t}/annotations    ← today's single write, rehomed
POST   /api/projects/{p}/tasks/{t}/suggestions    ← background job + progress
GET    /api/projects/{p}/tasks/{t}/export         GET  .../stats   ← judge-vs-human scoreboard
GET    /api/settings                              PATCH /api/settings
```

### 6.5 Screens (frontend gets a router — it has none today)

1. **Project list / new project** — plus "start from demo data" as a button, not a command
2. **Import wizard** — drop a file *or* paste JSON *or* pick a local path; auto-detect the adapter and **render the first 3 parsed traces before committing**; the `--from`/`--skip-invalid`/`--include-all-spans` knobs appear as visible options with explanations
3. **Rubric editor** — a form builder over the three existing field types (`single_select`, `multi_select`, `text`), a preset gallery, live preview of the annotation pane, and an impact check before saving a breaking change
4. **Data manager** — sortable/filterable/searchable table: id, status, field values, judge-vs-human, source batch. Click a row to label it. *This is the bridge screen: general-purpose labeling infrastructure that also happens to be exactly where error analysis happens.*
5. **Labeling view** — **keep as-is.** It is the good part: keyboard model, teleprompter scroll, activity cascade, agent colouring, sandboxed HTML. Do not touch beyond rehoming its data fetches.
6. **Results / disagreement** — per-field distribution, judge-vs-human agreement and confusion, "show only disagreements"
7. **Settings** — annotator name, LLM model, theme

Plus **URL state on every screen**, so refresh doesn't dump you back to item 0.

---

## 7. Feasibility

### Backend — net roughly flat

| Package | Now | After | Δ | Notes |
|---|---:|---:|---:|---|
| `imports/` | 1,578 | ~1,700 | +122 | **Adapters untouched.** Add a `preview()` path and upload handling |
| `db/` | 894 | ~1,250 | +356 | `projects`/`sources` tables, incremental migrations, filtered item queries |
| `api/` | 451 | ~1,100 | +649 | The bulk of the work: rewrite + grow |
| `cli/` | 526 | ~180 | **−346** | Five command classes collapse to two |
| `config/` | 428 | ~300 | −128 | YAML becomes optional import/export of a schema; `FieldDef` survives intact |
| `suggestions/` | 402 | ~560 | +158 | Background job runner + progress |
| `exporting/` | 262 | ~300 | +38 | HTTP route wrapper over the existing service |
| **Total** | **5,047** | **~5,400** | **+350** | |

**The backend barely grows — complexity *moves* rather than accumulating.** That is the strongest feasibility signal in this report.

### Frontend — roughly 2×

~3,470 production lines → **~6,000**. Router + five new screens + a real table component. The existing labeling view, presentation pipeline, renderers, and keyboard system (~2,300 lines of the best code in the repo) survive essentially unchanged.

### Tests — expect heavy churn

`tests/` is 4,119 lines and most of it constructs `ServeCommand` / `create_app` / `LabelingService` directly via constructor DI. **Budget 50–60% rewritten.** The e2e suite (`e2e/`, two Playwright specs driving two real `serve` backends on ports 8399/8409) needs restructuring around the new entry point.

### Sequencing — four phases, app usable at the end of each

| Phase | Delivers | Rough size |
|---|---|---|
| **0 · Foundation** | Workspace layout, `projects`/`sources` tables, incremental migrations, split `schema_hash`, `create_app(workspace)`, project/task-scoped routes. *No visible UI change; unblocks everything.* | Largest backend chunk |
| **1 · One command** | `tracelabel` boots bare · router + project list · import wizard · rubric editor · export button · settings · CLI shrinks to 5 commands · README rewritten | Largest frontend chunk |
| **2 · Data manager** | Filterable/sortable item table, bulk actions, deep links | Medium |
| **3 · Eval loop** | In-UI suggestion runs with progress · judge-alignment scoreboard · error-analysis notes → cluster → promote-to-field · re-label after rubric change | Medium |

Estimate: **3–5 focused engineer-weeks**, or roughly 10–15 well-scoped agent sessions.

### Real risks

- **Concurrency becomes real.** One long-lived server over many projects means two tabs, or an import running while you label. SQLite WAL plus the existing re-entrant `transaction()` (`db/database.py:70`) covers most of it, but **imports must be background jobs with progress, not blocking requests** — a 500 MB JSONL will otherwise hang the UI.
- **Where the database lives changes.** Free today; painful the moment someone depends on it.
- **`ProjectLock` semantics move** from per-directory to per-workspace. Simpler, but the current behaviour is covered by tests that will need rewriting.
- **The stdin `confirm` seam** in `TaskRepository.open` must become a return value the API can surface, not a prompt.

---

## 8. Decisions this forces on the design docs

`docs/design/` is described as authoritative. Three of its commitments must be **explicitly revoked**, in writing, or they will keep pulling the implementation backwards:

| Item | Where | Verdict |
|---|---|---|
| Non-goal: *"A 'dataset' entity. The JSONL file is the dataset"* | `00-overview.md:108` | **Revoke.** Made sense when the served file *was* the queue. Once import happens in a browser, batches need durable names. |
| Invariant #7: *"No dashboards in the labeling UI. Analysis happens in pandas via export."* | `00-overview.md:94` | **Revoke, narrowly.** Keep it for the *labeling* screen — that focus is a feature. But for eval work the agreement number is the product; forcing a pandas round-trip to see it breaks the loop. |
| *"Deliberately minimal: no task CRUD"* | `05-http-api.md:17` | **Revoke.** It is the direct cause of §3. |

**Keep** invariants #1 (content immutable), #2 (suggestions never write annotations), #6 (loopback only, no auth), #8 (everything resumes), #9 (API keys from env only), and #10 (export needs no server). These are load-bearing and good.

Docs `03-config.md`, `04-cli.md`, `05-http-api.md` and `06-frontend.md` become substantially obsolete and should be rewritten rather than patched.

---

## 9. Bugs and broken promises found along the way

Independent of any refactor — these are credibility problems in a repo whose README is its shopfront.

| # | Issue | Evidence |
|---|---|---|
| 1 | **README advertises an outline navigator (`o`) that does not exist.** No `o` handler, no `OutlinePane`, no `deriveOutline` — the whole feature is specced in `06-frontend.md:160-186` and unbuilt | `README.md:18` |
| 2 | **README's config example uses an invalid key.** Shows `name: empathy`; `RawConfig` has `task:` and `extra="forbid"`, so that exact snippet is a hard error | `README.md:361` vs `config/models.py:70-73` |
| 3 | **README documents a `--config` flag that doesn't exist.** The config path is the positional argument | `README.md:357` vs `cli/app.py:47-62` |
| 4 | **README says the default level is turn; the code says trace** (twice) | `README.md:47,362` vs `config/models.py:75` |
| 5 | **`--from loose` is advertised in an error message but rejected by the enum** — `FromChoice` has no `loose` member, so Typer refuses it before the registry is consulted | `imports/adapters/base.py:63` vs `cli/options.py:9-15` |
| 6 | **`suggest` and `serve` compute the project directory differently.** `serve` uses `path if path.is_dir() else path.parent`; `suggest` unconditionally uses `path.parent` — so for a directory target they use *different databases* | `cli/app.py:75` vs `cli/app.py:156` |
| 7 | **`export` and `tasks list` default to `cwd`**, not the data file's project directory — so `tracelabel export` silently finds nothing unless you `cd` first | `cli/commands.py:181,200` |
| 8 | **`config.yml` is never auto-discovered** — the fallback hardcodes `config.yaml`, though `.yml` works as an explicit target | `cli/app.py:41` vs `config/loader.py:39` |
| 9 | **Version mismatch:** `__version__ = "0.1.0"` vs `pyproject.toml` `version = "0.3.0"` | `src/tracelabel/__init__.py` vs `pyproject.toml:7` |
| 10 | **Dead code:** all four vendored shadcn primitives have zero imports; `GET /api/progress` is fetched and re-invalidated after *every* annotation but read by no component (`Header.tsx:46` derives counts locally); the `tracelabel.autoAdvance` localStorage key is written only by a test | `components/ui/*`, `NavContext.tsx:240,446` |
| 11 | **Error states are dead ends.** `retry: false` is set globally and the error branch renders a bare string with no retry button — a transient blip requires a page reload | `main.tsx:8`, `NavContext.tsx:428-435` |

Items 1–4 are the ones a first-time user hits. Most disappear when the YAML documentation does.

---

## 10. What to deliberately not build

The discipline that keeps this a tool rather than a platform:

- **No accounts, no auth, no signup.** Loopback-only, forever. This beats Label Studio outright.
- **No multi-user, roles, or live collaboration.** The `annotator` column and task-scoped uniqueness already leave the door open for an offline `merge`.
- **No cloud-storage connectors.** Local files and paths only.
- **No images, audio, video, or bounding boxes.** Text, JSON, HTML, Markdown — the formats agent traces actually come in.
- **No plugin system, no webhooks, no API tokens.**
- **No general query language for the data manager.** Half a dozen typed filters (status, field value, annotator, source batch, agreement) covers the real work; a query builder does not.
- **No telemetry.** Unchanged.

---

## 11. Open questions for the implementation plan

1. **Migration of the `tasks` table to be project-scoped.** Today `tasks.name` is a global primary key within a db. If each project keeps its own db file, the current shape works unchanged — worth confirming that's the intent rather than one db holding many projects.
2. **What happens to `config.yaml`.** Recommendation: keep the loader as an *import/export* format for schemas (so rubrics stay diffable and shareable in git), but delete it from the primary onboarding path. Confirm this rather than removing YAML entirely.
3. **Where the `--dir .` local-project mode stores `project.json`** — inside `.tracelabel/` alongside the db, presumably.
4. **Whether the data manager ships in Phase 2 or gets pulled into Phase 1.** It is the highest-value screen after the rubric editor, and it is what makes >200-item projects usable at all.

---

## Verification (once implemented)

- `uv run pytest -q` and `npm --prefix frontend test` green; `uv run mypy src/tracelabel` clean under `strict`
- `npm --prefix frontend run build` produces `src/tracelabel/static/index.html`
- **Cold-start walkthrough:** `uvx tracelabel` in an empty environment → project list appears → create a project → drag a JSONL in → preview shows parsed traces → accept → build a rubric in the UI → label 5 items → edit the rubric (add an option) → confirm existing labels survive → export from the UI → all without touching a terminal
- **Regression walkthrough:** `tracelabel ./traces.jsonl` still lands directly in the labeling view; `tracelabel demo` still works; `tracelabel export --project X --task Y` still works with no server running
- `e2e/` Playwright specs updated to drive the new entry point end-to-end

---

**Report location:** `/Users/danielkashkett/.claude/plans/you-are-an-expert-majestic-origami.md` (plan mode restricts writes to this path). Happy to copy it into the repo as `docs/refactor-report.md` on approval.
