import sqlite3
from collections.abc import Callable

from tracelabel.errors import EnvError

_DDL_001 = """
CREATE TABLE traces (
    id            TEXT PRIMARY KEY,
    content_hash  TEXT NOT NULL,
    source        TEXT,
    metadata      TEXT NOT NULL DEFAULT '{}',
    raw           TEXT,
    imported_at   TEXT NOT NULL
);

CREATE TABLE turns (
    id            TEXT PRIMARY KEY,
    trace_id      TEXT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
    idx           INTEGER NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool','document')),
    content       TEXT NOT NULL,
    content_type  TEXT NOT NULL CHECK (content_type IN ('text','json','html','parts')),
    tool_calls    TEXT,
    tool_call_id  TEXT,
    name          TEXT,
    metadata      TEXT NOT NULL DEFAULT '{}',
    raw           TEXT,
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


def migrate_001_initial(connection: sqlite3.Connection) -> None:
    connection.executescript(_DDL_001)


MIGRATIONS: tuple[Callable[[sqlite3.Connection], None], ...] = (migrate_001_initial,)


def upgrade(connection: sqlite3.Connection) -> None:
    version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if version > len(MIGRATIONS):
        raise EnvError(
            f"Database schema v{version} is newer than this tracelabel ({len(MIGRATIONS)}). "
            "Upgrade: pip install -U tracelabel"
        )
    for index in range(version, len(MIGRATIONS)):
        with connection:
            MIGRATIONS[index](connection)
            connection.execute(f"PRAGMA user_version = {index + 1}")
