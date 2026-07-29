import json
import sqlite3
from collections.abc import Callable
from typing import Any, cast

from tracelabel.config.resolver import compat_hash
from tracelabel.errors import EnvError

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

_DDL_003 = """
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
"""


def _to_v2(connection: sqlite3.Connection) -> None:
    connection.executescript(_DDL_002)


def _to_v3(connection: sqlite3.Connection) -> None:
    connection.executescript(_DDL_003)
    # Backfill compat_hash from each existing task's already-stored resolved_schema.
    # This is Python, not SQL, because compat_hash's field-name/type projection and
    # canonical-JSON encoding live in config/resolver.py, not in SQLite.
    rows = connection.execute("SELECT name, resolved_schema FROM tasks").fetchall()
    for row in rows:
        fields = cast(list[dict[str, Any]], json.loads(row["resolved_schema"]))
        connection.execute(
            "UPDATE tasks SET compat_hash=? WHERE name=?",
            (compat_hash(fields), row["name"]),
        )


Migration = Callable[[sqlite3.Connection], None]
SCHEMA_VERSION = 3
MIGRATIONS: list[tuple[int, Migration]] = [(2, _to_v2), (3, _to_v3)]


def upgrade(connection: sqlite3.Connection) -> None:
    version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if 0 < version < MIGRATIONS[0][0]:
        raise EnvError(
            "This database was created by an older tracelabel. Start a new project "
            "directory and re-import your traces."
        )
    if version > SCHEMA_VERSION:
        raise EnvError(
            f"Database schema v{version} is newer than this tracelabel "
            f"({SCHEMA_VERSION}). Upgrade: pip install -U tracelabel"
        )
    for target, step in MIGRATIONS:
        if version < target:
            with connection:
                step(connection)
                connection.execute(f"PRAGMA user_version = {target}")
