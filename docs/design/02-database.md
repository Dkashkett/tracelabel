# 02 — Database

SQLite via stdlib `sqlite3` (no ORM). One database per **project**.

## 1. Project layout & db location

```
my-eval/
├── traces.jsonl            # user's data
├── config.yaml             # optional
└── .tracelabel/            # created on first run, sits NEXT TO the data/config file
    ├── tracelabel.db
    └── lock                # JSON: {"pid": 1234, "port": 8377, "started_at": "..."}
```

- Default db path: `<dir of config/data file>/.tracelabel/tracelabel.db`. Override: `--db PATH`.
- One db per project — never a global db. Projects stay portable and deletable.
- Connection pragmas on every open:
  `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`

### Locking

```
def acquire_lock(project_dir):
    lock = project_dir/".tracelabel/lock"
    if lock.exists():
        info = json.load(lock)
        if pid_is_alive(info["pid"]):
            die(f"Another tracelabel instance (pid {info['pid']}) is serving this project "
                f"on port {info['port']}. Stop it or use --db to point elsewhere.")
        lock.unlink()          # stale lock from a crash
    lock.write(json({"pid": os.getpid(), "port": chosen_port, "started_at": now_iso()}))
    atexit(lock.unlink)
```

## 2. Schema (DDL, migration 001)

```sql
-- version: PRAGMA user_version = 1

CREATE TABLE traces (
    id            TEXT PRIMARY KEY,            -- CTF trace id (user-provided or t_<hash32>)
    content_hash  TEXT NOT NULL,               -- full sha256 hex of canonical_json(messages)
    source        TEXT,                        -- 'jsonl' | 'adk' | 'datadog' | ...
    metadata      TEXT NOT NULL DEFAULT '{}',  -- JSON
    raw           TEXT,                        -- JSON passthrough, nullable
    imported_at   TEXT NOT NULL                -- ISO-8601 UTC
);

CREATE TABLE turns (
    id            TEXT PRIMARY KEY,            -- "{trace_id}#{idx}"
    trace_id      TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    idx           INTEGER NOT NULL,            -- 0-based position
    role          TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool','document')),
    content       TEXT NOT NULL,               -- verbatim string, or JSON-serialized parts array
    content_type  TEXT NOT NULL CHECK (content_type IN ('text','json','html','parts')),
    tool_calls    TEXT,                        -- JSON array, nullable, assistant only
    tool_call_id  TEXT,                        -- nullable, tool only
    name          TEXT,
    metadata      TEXT NOT NULL DEFAULT '{}',  -- JSON
    raw           TEXT,
    UNIQUE (trace_id, idx)
);
CREATE INDEX idx_turns_trace ON turns(trace_id, idx);

CREATE TABLE tasks (
    name            TEXT PRIMARY KEY,
    level           TEXT NOT NULL CHECK (level IN ('turn','trace')),
    schema_hash     TEXT NOT NULL,             -- sha256 hex of canonical resolved fields (see 03 §6)
    resolved_schema TEXT NOT NULL,             -- JSON: the resolved field list, verbatim
    label_roles     TEXT NOT NULL,             -- JSON array, e.g. ["assistant","document"]
    shuffle_seed    INTEGER,                   -- NULL = sequential order
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE annotations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task          TEXT NOT NULL REFERENCES tasks(name) ON DELETE CASCADE,
    target_type   TEXT NOT NULL CHECK (target_type IN ('turn','trace')),
    target_id     TEXT NOT NULL,               -- turns.id or traces.id
    status        TEXT NOT NULL CHECK (status IN ('labeled','skipped')),
    "values"      TEXT NOT NULL DEFAULT '{}',  -- JSON object keyed by field name
    schema_hash   TEXT NOT NULL,               -- copied from task at write time (drift forensics)
    annotator     TEXT NOT NULL,
    prefill_model TEXT,                        -- litellm model string if started from a suggestion; NULL = unassisted
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE (task, target_type, target_id, annotator)
);
CREATE INDEX idx_annotations_task ON annotations(task, target_type);

CREATE TABLE suggestions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task         TEXT NOT NULL REFERENCES tasks(name) ON DELETE CASCADE,
    target_type  TEXT NOT NULL CHECK (target_type IN ('turn','trace')),
    target_id    TEXT NOT NULL,
    "values"     TEXT NOT NULL,                -- JSON object keyed by field name
    model        TEXT NOT NULL,                -- litellm model string
    raw_response TEXT,                         -- full model output for debugging, nullable
    created_at   TEXT NOT NULL,
    UNIQUE (task, target_type, target_id)      -- one live suggestion; re-running suggest REPLACEs
);
```

Notes:
- `values` as a JSON blob keyed by field name (not normalized rows) is deliberate: config
  changes stay painless and SQLite JSON1 (`json_extract(values, '$.verdict')`) covers querying.
- Multi-select values are JSON arrays of option strings. Verdicts are the strings
  `"pass"`/`"fail"`, **never** booleans (leaves room for `borderline` later, reads better in CSV).
- Timestamps: ISO-8601 UTC with `Z` suffix, e.g. `2026-07-11T18:04:22Z`.

## 3. Migrations

`PRAGMA user_version` + tiny sequential Python migration scripts. Runs automatically on every
db open (CLI and server). pip-upgraded users' existing dbs must survive.

```python
MIGRATIONS: list[Callable[[sqlite3.Connection], None]] = [migrate_001_initial, ...]

def upgrade(conn):
    v = conn.execute("PRAGMA user_version").fetchone()[0]
    if v > len(MIGRATIONS):
        die(f"Database schema v{v} is newer than this tracelabel ({len(MIGRATIONS)}). Upgrade: pip install -U tracelabel")
    for i in range(v, len(MIGRATIONS)):
        with conn:                       # each migration is one transaction
            MIGRATIONS[i](conn)
            conn.execute(f"PRAGMA user_version = {i + 1}")
```

Rules: migrations are append-only, never edited after release; each must be idempotent-safe to
review; destructive changes (dropping columns) require a copy-table migration.

## 4. Idempotent import (normative pseudocode)

```python
def import_trace(conn, ctf: dict, source: str, on_conflict: str = "fail"):
    tid   = ctf.get("id") or f"t_{sha256(canonical_json(ctf['messages']))[:32]}"
    chash = sha256_hex(canonical_json(ctf["messages"]))

    existing = conn.execute("SELECT content_hash FROM traces WHERE id=?", (tid,)).fetchone()
    if existing:
        if existing["content_hash"] == chash:
            return "skipped_duplicate"                     # normal idempotent path
        # same id, DIFFERENT content — annotations may be invalidated
        if on_conflict == "skip":
            warn(f"trace {tid}: content differs from stored copy; keeping stored version")
            return "skipped_conflict"
        die(f"trace {tid}: incoming content differs from the stored copy that existing "
            f"annotations reference. Re-run with --on-conflict skip to keep the stored "
            f"version, or import under a new id.")          # default: fail loudly

    with conn:
        conn.execute("INSERT INTO traces VALUES (?,?,?,?,?,?)",
                     (tid, chash, source, json(ctf.get("metadata", {})),
                      json_or_null(ctf.get("raw")), now_iso()))
        for i, m in enumerate(ctf["messages"]):
            conn.execute("INSERT INTO turns VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (f"{tid}#{i}", tid, i, m["role"],
                          serialize_content(m["content"]),          # verbatim; parts → json string
                          content_type_of(m["content"]),
                          json_or_null(m.get("tool_calls")), m.get("tool_call_id"),
                          m.get("name"), json(m.get("metadata", {})),
                          json_or_null(m.get("raw"))))
    return "inserted"
```

`--on-conflict` accepts `fail` (default) | `skip`. `replace` is explicitly deferred post-MVP
because it silently invalidates annotations.

## 5. Task upsert & drift guard (normative)

```python
def open_task(conn, resolved: ResolvedTaskConfig, assume_yes: bool):
    row = conn.execute("SELECT * FROM tasks WHERE name=?", (resolved.name,)).fetchone()
    if row is None:
        seed = random_seed() if resolved.shuffle else None
        conn.execute("INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)",
                     (resolved.name, resolved.level, resolved.schema_hash,
                      json(resolved.fields), json(resolved.label_roles),
                      seed, now_iso(), now_iso()))
        return

    if row["level"] != resolved.level:
        die(f"Task '{resolved.name}' exists at level={row['level']}; got level={resolved.level}. "
            f"Pick a new task name.")
    if row["schema_hash"] != resolved.schema_hash:
        # SCHEMA DRIFT — invariant #5: be loud, require explicit consent
        print(diff_schemas(json.loads(row["resolved_schema"]), resolved.fields))
        if not (assume_yes or confirm("Field schema changed for existing task "
                                      f"'{resolved.name}'. Existing annotations keep their old "
                                      f"schema_hash. Continue with the NEW schema? [y/N]")):
            die("Aborted. Use a new --task name to start a fresh pass.")
        conn.execute("UPDATE tasks SET schema_hash=?, resolved_schema=?, updated_at=? WHERE name=?",
                     (resolved.schema_hash, json(resolved.fields), now_iso(), resolved.name))
```

## 6. Annotation upsert (last-write-wins)

```python
def upsert_annotation(conn, task, target_type, target_id, status, values,
                      annotator, schema_hash, prefill_model):
    conn.execute("""
      INSERT INTO annotations
        (task, target_type, target_id, status, "values", schema_hash,
         annotator, prefill_model, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT (task, target_type, target_id, annotator) DO UPDATE SET
        status=excluded.status, "values"=excluded."values",
        schema_hash=excluded.schema_hash, prefill_model=excluded.prefill_model,
        updated_at=excluded.updated_at
    """, (task, target_type, target_id, status, json(values), schema_hash,
          annotator, prefill_model, now_iso(), now_iso()))
```

No revision history in MVP. `updated_at` keeps the door open.

## 7. Progress & "definition of done" queries

Done means: every target at the task's level has an annotation with status `labeled`
(all required fields valid — enforced at write time by the server) **or** `skipped`.

```sql
-- turn-level task: targets are labelable turns
SELECT count(*) FROM turns t
WHERE t.role IN (SELECT value FROM json_each((SELECT label_roles FROM tasks WHERE name=:task)));

-- addressed
SELECT count(*) FROM annotations
WHERE task=:task AND target_type='turn' AND annotator=:annotator;

-- trace-level task: targets are all traces; analogous with target_type='trace'
```

Progress is always reported in the task's native unit ("137/482 turns", "34/200 traces").
