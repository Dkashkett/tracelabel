# P3 — Database (schema, migrations, lock, normative writes)

**Phase:** 2 · **Depends on:** P1 (+ frozen `ResolvedTaskConfig` shape from `01-interfaces.md` §4 — not P2's code) · **Unblocks:** P4 (pipeline tests), P5, P6, P7, P8

**Owned files:** `src/tracelabel/db.py`, `tests/test_db.py`.

## Objective

The persistence layer: migration 001 DDL, project lock, and the three normative write paths
(idempotent import, task upsert with drift guard, annotation last-write-wins upsert), plus
the read helpers every later packet consumes.

## Required reading

- `docs/design/02-database.md` — **all of it; §1, §3, §4, §5, §6 are normative code**
- `docs/design/04-cli.md` §3 (queue ordering)
- `01-interfaces.md` §5 (frozen signatures + JSON-serialization DECISION)

## Implementation notes

- **DDL:** `migrate_001_initial` executes the 02 §2 DDL character-faithfully (same tables,
  columns, CHECKs, UNIQUEs, indexes). `"values"` stays quoted in all SQL.
- **`upgrade`, `import_trace`, `open_task`, `upsert_annotation`:** the 02 §3–§6 pseudocode is
  a contract — same branches, same messages, same return values. `die(...)` in the pseudocode
  means raise (`EnvError` for newer-db and live-lock, `UserError` for conflicts/drift-declined).
- `open_task`'s `confirm` param defaults to a stdin `[y/N]` prompt; tests and `--yes` inject.
  The drift path must print `diff_schemas(old, new)` first — implement `diff_schemas` as a
  simple field-by-field added/removed/changed listing (no external deps).
- **Lock:** JSON file per 02 §1. `pid_is_alive`: `os.kill(pid, 0)` wrapped for
  `ProcessLookupError`/`PermissionError` on POSIX; on Windows use
  `ctypes.windll.kernel32.OpenProcess` or `psutil`-free equivalent — **no new deps**; a
  pragmatic fallback (`OpenProcess` present → alive) is fine, note it. `release_lock` is
  idempotent and registered with `atexit` inside `acquire_lock`.
- **`build_queue`:** 04 §3 verbatim — `ORDER BY imported_at, id`, `random.Random(seed)` with
  the seed read from the task row. Turn order is never shuffled.
- Timestamps only via `now_iso()`. JSON columns via `ctf.canonical_json`; `turns.content`
  via `ctf.serialize_content` (invariant #1 — this is the load-bearing line; a *why* comment
  citing the invariant is appropriate).
- `import_trace` receives already-validated CTF dicts and must not re-validate; it derives
  `tid`/`chash` per 02 §4 using `ctf.derive_trace_id`/`ctf.content_hash` on the *incoming
  dicts* (see P1 hashing discipline).
- Read helpers per `01-interfaces.md` §5: keep them thin `SELECT`s; `target_counts` must be
  one query per 02 §7 (labelable-turns via `json_each(label_roles)`), not N+1 per trace.
- Multi-select values are stored inside the `values` JSON as arrays; verdicts are the strings
  `"pass"`/`"fail"` — never booleans (02 §2 notes). Nothing in this module enforces field
  semantics (that's the shared validator); it stores what it is given.

## Tests

Matrix rows **DB-01 … DB-15**. Use `tmp_path` projects; construct `ResolvedTaskConfig`
directly (don't import P2 — build the frozen dataclass by hand in tests to keep the packet
independent; if P2 is already merged, importing it is also acceptable).

## Verification

```
pytest tests/test_db.py -q
```

## Out of scope

File iteration/adapters and batching (P4's `import_file`), HTTP anything (P5), port picking
(P8). `--on-conflict replace` is deliberately deferred post-MVP (02 §4) — do not add it.
