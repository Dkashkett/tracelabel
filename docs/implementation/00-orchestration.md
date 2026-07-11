# TraceLabel Implementation Plan — Orchestration

**Status:** Ready for execution · **Targets:** design specs `docs/design/00`–`09` (spec v1.0)

This folder is the build plan for the MVP described in `docs/design/`. The design docs remain
the **source of truth for behavior**; these docs add only what the specs leave open: module
boundaries, frozen signatures, file paths, test names, sequencing, and agent instructions.
If a packet doc and a design doc disagree on *behavior*, the design doc wins — and the
disagreement is a bug in the packet doc; fix the packet doc.

## 1. How this plan is organized

| File | Purpose |
|---|---|
| `00-orchestration.md` | This file: phases, dependency graph, file ownership, agent playbook |
| `01-interfaces.md` | **Frozen** cross-module signatures. Parallel packets code against these, never against each other's source |
| `02-test-matrix.md` | Every normative rule → a named test. The definition of done |
| `packets/P0…P11` | One self-contained work packet per unit of implementation |

## 2. Phases & parallelization

Packets in the same phase are independent (disjoint files, dependencies only on earlier
phases) and may run as parallel agents/worktrees/sessions.

| Phase | Packets (∥ = parallel) | Gate to enter next phase |
|---|---|---|
| **0** | P0 scaffold | `pip install -e ".[dev]"` succeeds; `pytest` collects; `tracelabel --help` runs; `npm run build` in `frontend/` succeeds |
| **1** | P1 core-ctf ∥ P9 frontend *(long lane, see below)* ∥ P10 demo-data | P1 tests green |
| **2** | P2 config ∥ P3 database ∥ P4 adapters *(merge P4 last — see note)* | P2 + P3 tests green |
| **3** | P5 server-api ∥ P6 export ∥ P7 suggest | P5 tests green |
| **4** | P8 cli | full backend test suite green |
| **5** | P11 packaging-ci-e2e | Playwright smoke green on CI matrix |

```
P0 ──┬── P1 ──┬── P2 ──┬── P5 ──┐
     │        ├── P3 ──┼── P6 ──┼── P8 ── P11
     │        └── P4 ──┴── P7 ──┘          │
     ├── P9 (frontend lane — runs phases 1–4 against mocks) ──┘
     └── P10 (demo data — authored in phase 1, validated when P1 lands)
```

**Notes on the graph:**

- **P9 (frontend) is the big parallelization win.** Its only dependency is the HTTP contract
  (`05-http-api.md` §2, restated in `01-interfaces.md` §10) plus the P0 scaffold. It develops
  against mock fixtures and needs nothing from the Python lane until final integration in P11.
- **P4 (adapters)** codes against the frozen `db.import_trace` signature; its golden-file and
  sniff tests are db-free and run immediately, but its 3 `import_file` pipeline tests need P3
  merged. Start P4 in parallel; **merge it after P3** within phase 2.
- **P10 (demo data)** is pure authoring; its validation test (`tests/test_demo_data.py`)
  becomes runnable once P1 merges.
- P2 and P3 both depend only on P1 + the frozen `ResolvedTaskConfig` shape; P3 does not need
  P2's code (see `01-interfaces.md` §1 change protocol).

## 3. File ownership (conflict-free parallelism)

Each packet owns a disjoint set of paths. **An agent must not create or modify files outside
its packet's ownership list.** Ownership transfers forward: P0 creates stubs that later
packets fill in (that's sequential, so no conflict).

| Packet | Owns |
|---|---|
| P0 | `pyproject.toml`, `.gitignore`, `.github/workflows/ci.yml`, `src/tracelabel/{__init__,__main__,errors}.py`, module stubs (`ctf,config,db,server,export,suggest,cli`.py + `adapters/`), `tests/` dir + `tests/helpers.py`, `frontend/` scaffold |
| P1 | `src/tracelabel/ctf.py`, `tests/test_ctf.py`, `tests/test_canonical.py`, `tests/fixtures/ctf/` |
| P2 | `src/tracelabel/config.py`, `tests/test_config.py` |
| P3 | `src/tracelabel/db.py`, `tests/test_db.py` |
| P4 | `src/tracelabel/adapters/**`, `tests/test_adapters.py`, `tests/golden/**` |
| P5 | `src/tracelabel/server.py`, `tests/test_api.py` |
| P6 | `src/tracelabel/export.py`, `tests/test_export.py` |
| P7 | `src/tracelabel/suggest.py`, `tests/test_suggest.py` |
| P8 | `src/tracelabel/cli.py`, `tests/test_cli.py` |
| P9 | `frontend/**` (after the P0 scaffold) |
| P10 | `src/tracelabel/demo_data/traces.jsonl`, `tests/test_demo_data.py` |
| P11 | `.github/workflows/release.yml`, `e2e/**`, `README.md`, `LICENSE`, `docs/pandas.md`, `docs/trace-format.md` |

## 4. Agent playbook (token-efficiency rules)

Every packet doc has the same template: Objective · Required reading · Owned files ·
Implementation notes · Tests · Verification · Out of scope. An agent executing a packet:

1. **Read exactly:** the packet doc, its *Required reading* spec sections (not whole docs
   unless listed), `01-interfaces.md` (only the sections the packet doc names), and
   `.claude/CLAUDE.md`. Total budget ≈ 600–1000 lines. **Do not** read other packets, other
   spec docs, or source files owned by other packets — the interfaces doc exists so you
   never have to.
2. **Implement against frozen signatures.** If a signature in `01-interfaces.md` proves wrong,
   stop, edit `01-interfaces.md` first, and flag the change in your final report (mirror of
   the "change the doc before the code" rule in CLAUDE.md). Never silently deviate.
3. **Tests first.** Write the packet's rows from `02-test-matrix.md` as failing tests, then
   implement. Every normative rule the packet touches must be pinned by a test.
4. **Verify:** run the packet's *Verification* command(s); all must pass. Also run the full
   `pytest -q` if your packet is in phase ≥ 2 (regressions in merged packets are your problem
   if you caused them).
5. **Done means:** verification passes · matrix rows implemented · no files outside the
   ownership list touched · no new runtime dependencies beyond the locked list
   (`fastapi uvicorn pydantic>=2 typer pyyaml`, `[ai]→litellm`) · coding preferences in
   CLAUDE.md respected (no module docstrings, comments only for non-obvious *why*, pathlib,
   full type annotations).

### Orchestrator notes

- One packet = one branch (or worktree) = one merge. Ownership disjointness makes same-phase
  merges conflict-free; merge in packet-number order within a phase (P4 after P3, see §2).
- Suggested agent prompt shape: *"Execute packet `docs/implementation/packets/P<N>-….md` in
  this repo. Follow the agent playbook in `docs/implementation/00-orchestration.md` §4.
  Report: files created, test results, any interface deviations."*
- Sonnet-class models are sufficient for P0, P6, P10; use Opus-class for P1–P5, P7–P9, P11
  (they carry normative pseudocode or the security-sensitive surfaces).
- Phase gates are cheap to check: they are just the verification commands of the phase's
  packets. Don't start phase N+1 lanes early except P9/P10 as drawn.

## 5. Cross-cutting conventions (all packets)

- **Runtime deps are locked** (overview §3 table). Dev/test deps allowed: `pytest`,
  `hypothesis`, `httpx` (FastAPI TestClient), `pytest-asyncio` if needed. Frontend dev deps
  per P0/P9. Playwright only in P11's `e2e/`.
- **Errors:** library code raises `UserError`/`EnvError` (see `01-interfaces.md` §2); only
  `cli.py` converts them to exit codes 1/2 and prints to stderr.
- **Timestamps:** always `db.now_iso()` — ISO-8601 UTC with `Z` (02 §2 notes).
- **JSON in db columns:** always `ctf.canonical_json`, except `turns.content` which uses
  `ctf.serialize_content` (invariant #1).
- **Windows is a target platform.** `pathlib` everywhere; no shell-isms in code or tests;
  tests must pass on Windows CI (mind file locking around SQLite/WAL in teardown).
