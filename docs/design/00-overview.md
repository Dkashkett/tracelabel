# TraceLabel — System Overview

**Status:** Approved for implementation · **Spec version:** 1.0 · **Format version:** 1

## 1. What this is

TraceLabel is a local-first, zero-config data labeling tool for agent traces and documents.
One-liner: **"Local-first, zero-config labeling for agent traces — keyboard-fast, no accounts, no server setup."**

It is a *tool*, not a platform. It is deliberately single-player in the MVP, runs entirely on
the user's machine, and stores everything in one SQLite file per project.

```
pip install tracelabel
tracelabel                             # opens the browser on your project list
tracelabel traces.jsonl                # ...or: import + label this file directly
uvx tracelabel demo                    # 15-second pitch
```

## 2. North-star metric

**Minutes from `pip install` to first committed label.** Every design decision in these docs
was made in service of that number and of labeling throughput (seconds per item) thereafter.

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  tracelabel (Python package, one wheel)                      │
│                                                                │
│  ┌──────────┐   ┌────────────────┐   ┌───────────────────┐   │
│  │ CLI      │──▶│ FastAPI server │──▶│ SQLite: one db per │   │
│  │ (Typer)  │   │ 127.0.0.1 only │   │ project in the     │   │
│  └──────────┘   └───────┬────────┘   │ workspace          │   │
│       │                 │ serves     └───────────────────┘   │
│       │                 ▼                                    │
│       │         ┌───────────────┐                            │
│       │         │ React SPA     │  (prebuilt in CI, shipped   │
│       │         │ (static files)│   inside the wheel)         │
│       │         └───────────────┘                            │
│       │                                                       │
│       └──▶ import adapters (ADK, Datadog, auto-detect)        │
│       └──▶ export (JSONL/CSV)                                 │
│       └──▶ suggest (litellm, optional extra [ai])             │
└──────────────────────────────────────────────────────────────┘
```

Component stack (locked):

| Layer        | Choice                                             |
|--------------|----------------------------------------------------|
| Language     | Python ≥ 3.10                                      |
| CLI          | Typer                                              |
| Server       | FastAPI + Uvicorn, bound to `127.0.0.1` only       |
| Validation   | Pydantic v2                                        |
| DB           | SQLite (stdlib `sqlite3`), WAL mode, `PRAGMA user_version` migrations |
| Frontend     | Vite + React 18 + TypeScript + Tailwind + shadcn/ui + TanStack Query + TanStack Virtual |
| AI assist    | litellm, optional extra: `pip install tracelabel[ai]` |
| Packaging    | hatchling; Vite builds directly into package data in CI |
| License      | Apache-2.0                                         |
| Telemetry    | **None.** Not opt-in, not opt-out — none.          |

## 4. Core concepts (glossary — use these terms exactly)

| Term | Definition |
|------|------------|
| **Trace** | One unit of importable content: a multi-turn conversation *or* a freeform document. A document is a trace with `content`/`content_type` set and **zero turns** — labelable only at trace level. |
| **Turn** | One message within a conversation trace. Identified by `"{trace_id}#{index}"`. Document traces have none. |
| **Task** | A named labeling pass over a set of traces at exactly one **level** (`turn` or `trace`) with one resolved field schema. The same traces can carry many tasks (e.g. `empathy`, `escalation`). |
| **Level** | `turn` or `trace`. A property of the task, never mixed within a task. |
| **Field** | One input in the annotation form: `single_select`, `multi_select`, or `text`. |
| **Resolved schema** | The fully-expanded field list after default injection and preset expansion. The only schema the app (renderer, writer, hasher) ever sees. |
| **Annotation** | A human-committed set of field values for one target (turn or trace) in one task, by one annotator. Status `labeled` or `skipped`. |
| **Suggestion** | A model-produced set of field values. Lives in its own table. **Never** an annotation until a human confirms. |
| **Labelable turn** | A turn whose `role` is in the task's `label_roles` (default `[assistant]`). Only these are annotation targets in turn-level tasks. Documents have no turns, so they're only annotation targets in trace-level tasks. |
| **Workspace** | The root directory (`~/.tracelabel/`, or `--dir PATH`) holding workspace-wide `settings.json`, the workspace lock, and every project. One server process serves one workspace — any number of projects and tasks within it. |
| **Project** | A named subdirectory of the workspace (`projects/<slug>/`) with its own `project.json` and its own SQLite db. Created and listed via `/api/projects`, or in the browser. |
| **Source** | A durable record of one completed import into a project (filename/paste, adapter used, timestamp, trace count) — what makes "label the batch I imported Tuesday" possible after a restart. |

## 5. Cross-cutting invariants (violations are bugs)

1. **Content is immutable and never reformatted.** What was imported byte-for-byte is what is
   stored and rendered from. This keeps future span-tagging character offsets valid.
   (Detecting that a string parses as JSON and *tagging* it `content_type=json` is allowed;
   re-serializing it is not.)
2. **Suggestions never write to the `annotations` table.** A human confirm copies values into
   an annotation and records `prefill_model`.
3. **Every annotation is scoped to a task.** Uniqueness is `(task, target_type, target_id, annotator)`.
4. **Custom fields replace defaults; they never merge.** Per task. The `pass_fail` preset exists
   so re-declaring the default costs two lines.
5. **Schema drift is loud.** Reopening a task whose resolved schema hash no longer matches the
   stored one requires explicit confirmation or a new task name. Same for trace content drift
   on re-import (same id, different content hash → fail by default).
6. **The server binds to 127.0.0.1 and has no auth.** It must never bind to other interfaces
   in the MVP.
7. **No dashboards in the *labeling* screen.** Its focus is a feature — content and keyboard
   loop, nothing else competing for attention. *(Narrowed by the workspace/eval-loop revision:
   this no longer bans dashboards from the product entirely — the eval loop's judge-agreement
   scoreboard and stats screen are dashboards, deliberately. See §7 below.)*
8. **Everything resumes.** Annotations write on commit; killing the process loses nothing.
9. **API keys come from environment variables only.** Never from YAML, never stored in the db.
10. **Export never requires a running server.** It is a pure CLI/db operation.

## 6. Non-goals (MVP)

- Multi-user/live collaboration, auth, accounts. (The schema is multi-annotator *ready* —
  `annotator` column, task-scoped uniqueness — and the README should say a future
  `tracelabel merge a.db b.db` is the team answer.)
- Span/character-offset tagging (future field type; invariant #1 keeps the door open).
- Live Datadog API sync (MVP ingests exported files only).
- Revision history for annotations (last-write-wins + `updated_at` only).

## 7. Revocations (superseded commitments)

Three commitments made earlier in this doc set were explicitly revoked by the workspace/project/
task refactor (`docs/refactor-report.md` §8) — recorded here so they don't keep pulling future
work backwards:

- **Non-goal "a 'dataset' entity — the JSONL file is the dataset."** Revoked. Made sense while
  the served file *was* the queue; once import happens in a browser, batches need durable names.
  This is the **source** concept in §4 above.
- **Invariant #7, "no dashboards in the labeling UI."** Narrowed, not fully revoked — see §5 above.
  Kept for the labeling screen itself; the eval loop's agreement/confusion stats are an
  intentional exception.
- **"Deliberately minimal: no task CRUD"** (formerly `05-http-api.md`, now retired). Revoked — task
  creation, rubric editing, and listing are now full CRUD over `/api/projects/{p}/tasks`, which is
  what makes the browser-only workflow in §2 possible at all.

## 8. Document map

| Doc | Domain |
|-----|--------|
| `01-canonical-trace-format.md` | The trace/turn JSON contract everything targets |
| `02-database.md` | SQLite schema, migrations, identity & idempotency |
| `03-config.md` | **Retired** — see the file itself for what replaced it |
| `04-cli.md` | **Retired** — see the file itself; current surface in the README |
| `05-http-api.md` | **Retired** — see the file itself; current surface in `src/tracelabel/api/models.py` |
| `06-frontend.md` | **Retired** — see the file itself; current screens are largely undocumented outside their own code/tests |
| `07-import-export.md` | Adapters (auto, ADK, Datadog) and export formats |
| `08-ai-assist.md` | Batch suggestion flow, prompting, provenance |
| `09-packaging-security.md` | Wheel build, distribution, security posture, NFRs |
| `10-serve-scoped-datasets.md` | Pre-workspace per-file queue scoping — superseded by `sources`/`queue_scope` (§4, §7) |

Read `01` and `02` first; they are the contracts the rest depend on. `docs/refactor-plan.md` and
`docs/refactor-report.md` cover the workspace/project/task refactor itself, including the
revocations in §7 above.
