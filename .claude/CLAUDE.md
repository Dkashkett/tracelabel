# TraceLabel — working notes for Claude

Local-first, zero-config labeling tool for agent traces. One Python wheel: Typer CLI +
FastAPI server (127.0.0.1 only) + a prebuilt React SPA + SQLite, one db file per project.

**The design docs in `docs/design/` are the source of truth.** Read `00-overview.md` first,
then `01-canonical-trace-format.md` and `03-config.md` — they are the contracts everything
else depends on. This file is *how we write the code*; those docs are *what the code must do*.

## Non-negotiables

- **The invariants in `00-overview.md` §5 are law.** Violating one is a bug, not a tradeoff.
  If a task seems to require breaking one, stop and flag it — don't work around it.
- **Normative pseudocode is a contract, not a suggestion.** Where a design doc gives
  pseudocode (identity/hashing in 01 §6, idempotent import in 02 §4, resolution in 03 §4,
  write-path validation in 05 §3, …), the implementation must match its behavior exactly.
  Change the doc before changing that behavior.
- **Content is immutable and never reformatted.** Store imported strings byte-for-byte.
  Detecting a type is fine; re-serializing is a bug (invariant #1). This keeps future
  span-offset tagging valid.
- **Server binds `127.0.0.1` only, no auth, no `--host` flag** (invariant #6). No telemetry,
  ever (not opt-in, not opt-out). The only outbound calls are litellm calls the user
  explicitly runs via `suggest`.

## Coding preferences

- **Small core, few dependencies.** Runtime core is exactly `fastapi`, `uvicorn`,
  `pydantic>=2`, `typer`, `pyyaml`. `litellm` is the only `[ai]` extra and its import is lazy
  and guarded. The tiny dep list is a feature (supply-chain surface + install time).
  shadcn/ui is *vendored*, not a runtime dep.
- **Stdlib first.** SQLite via stdlib `sqlite3`, no ORM. Hashing via `hashlib`. Paths via
  `pathlib` everywhere (Windows is a supported platform).
- **Python ≥ 3.10, fully type-annotated.** Pydantic v2 models with
  `model_config = ConfigDict(extra="forbid")` — unknown keys and typos are hard errors with
  good messages. Do not soften this.
- **Be liberal in what we accept, strict in what we store.** Adapters bend over backwards to
  ingest almost-CTF data (see the LooseAdapter, 07 §3); the importer only ever sees clean
  validated CTF. The permissiveness lives at the edge, never in the core.
- **Fail loud, fail early, with actionable errors.** No silent fallbacks or best-effort
  guessing in the core. Every user-facing error names the location (`file:line`, YAML path),
  the rule that failed, and shows a *fixed example* of the input (01 §7, 03 §7, 07 §5). This
  error-message quality is an adoption feature — hold the bar.
- **One resolved schema flows downstream.** Renderer, writer, hasher, and suggester see only
  `ResolvedTaskConfig`; nothing downstream knows defaults or presets exist (03 §4). Keep that
  boundary — don't leak raw config or default-injection logic past resolution.
- **Everything resumes.** Writes commit immediately (annotation upsert on every commit); a
  killed process must lose nothing. No submit-at-end batching.
- **Deterministic where it matters.** `canonical_json` (sorted keys, tight separators) is the
  one true serialization for hashing and identity. Shuffle uses a stored per-task seed so
  order is stable across resume. Same input → same hash → same id, always.
- **The frontend renders whatever schema the server sends.** A single `FieldRenderer` switch
  over field types; zero client-side knowledge of defaults, presets, or level semantics
  (06 §6). No Redux — client state is just position + form draft in a reducer. New field
  types = a new `case`, not a redesign.
- **Code documents itself; comments are a last resort.** No module-level docstrings; a rare
  comment may capture non-obvious *why* (which invariant a line upholds, a spec clause it
  satisfies), never *what*.
- **No cleverness that obscures a normative rule.**

## Testing

Per `09-packaging-security.md` §4, the minimum bar is: contract tests for every CTF rejection
rule (01 §7) and adapter golden files; property tests for hash stability, import idempotency,
and `canonical_json` determinism; the full write-path validation matrix (05 §3); and the
Playwright e2e smoke (`demo` → `j` → `1` → type → `Enter` → assert the row exists). **Every
normative rule should be pinned by a test** — the specs enumerate the cases; cover them.

## Layout (target)

```
frontend/                    # Vite + React + TS; dev proxies /api → :8377
src/tracelabel/
  cli.py server.py config.py db.py ctf.py export.py suggest.py
  adapters/{loose,adk,datadog}.py
  static/                    # CI-populated (vite build output), gitignored
  demo_data/
docs/design/                 # the specs — source of truth
```