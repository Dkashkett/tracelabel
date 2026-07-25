import sqlite3

from tracelabel.errors import EnvError

SCHEMA_VERSION = 2

_DDL_002 = """
CREATE TABLE traces (
    id            TEXT PRIMARY KEY,
    content_hash  TEXT NOT NULL,
    source        TEXT,
    metadata      TEXT NOT NULL DEFAULT '{}',
    raw           TEXT,
    imported_at   TEXT NOT NULL,
    content       TEXT,
    content_type  TEXT CHECK (
        content_type IS NULL OR content_type IN ('text','json','html','markdown')
    )
);

CREATE TABLE turns (
    id            TEXT PRIMARY KEY,
    trace_id      TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    idx           INTEGER NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool','event')),
    content       TEXT NOT NULL,
    content_type  TEXT NOT NULL CHECK (content_type IN ('text','json','html','parts')),
    tool_calls    TEXT,
    tool_call_id  TEXT,
    name          TEXT,
    metadata      TEXT NOT NULL DEFAULT '{}',
    raw           TEXT,
    span_id       TEXT,
    parent_id     TEXT,
    agent         TEXT,
    kind          TEXT CHECK (
        kind IS NULL OR kind IN ('handoff','retrieval','agent','guardrail','span')
    ),
    started_at    TEXT,
    duration_ms   REAL,
    status        TEXT CHECK (status IS NULL OR status IN ('ok','error')),
    status_message TEXT,
    UNIQUE (trace_id, idx)
);
CREATE INDEX idx_turns_trace ON turns(trace_id, idx);

CREATE TABLE tasks (
    name            TEXT PRIMARY KEY,
    level           TEXT NOT NULL CHECK (level IN ('turn','trace')),
    schema_hash     TEXT NOT NULL,
    resolved_schema TEXT NOT NULL,
    label_roles     TEXT NOT NULL,
    shuffle_seed    INTEGER,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE annotations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task          TEXT NOT NULL REFERENCES tasks(name) ON DELETE CASCADE,
    target_type   TEXT NOT NULL CHECK (target_type IN ('turn','trace')),
    target_id     TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('labeled','skipped')),
    "values"      TEXT NOT NULL DEFAULT '{}',
    schema_hash   TEXT NOT NULL,
    annotator     TEXT NOT NULL,
    prefill_model TEXT,
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
    "values"     TEXT NOT NULL,
    model        TEXT NOT NULL,
    raw_response TEXT,
    created_at   TEXT NOT NULL,
    UNIQUE (task, target_type, target_id)
);
"""


def upgrade(connection: sqlite3.Connection) -> None:
    version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if version == SCHEMA_VERSION:
        return
    if version == 0:
        with connection:
            connection.executescript(_DDL_002)
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        return
    if version < SCHEMA_VERSION:
        raise EnvError(
            "This database was created by an older tracelabel. Start a new project "
            "directory and re-import your traces."
        )
    raise EnvError(
        f"Database schema v{version} is newer than this tracelabel ({SCHEMA_VERSION}). "
        "Upgrade: pip install -U tracelabel"
    )
