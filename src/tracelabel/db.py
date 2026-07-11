import atexit
import json
import os
import random
import sqlite3
import warnings
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, cast

from .config import ResolvedTaskConfig
from .ctf import (
    Json,
    canonical_json,
    content_hash,
    content_type_of,
    derive_trace_id,
    serialize_content,
)
from .errors import EnvError, UserError

TargetType = Literal["turn", "trace"]
ImportResult = Literal["inserted", "skipped_duplicate", "skipped_conflict"]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def default_db_path(project_dir: Path) -> Path:
    return project_dir / ".tracelabel" / "tracelabel.db"


def open_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    upgrade(conn)
    return conn


# ── Migrations ──────────────────────────────────────────────────────────────

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


def migrate_001_initial(conn: sqlite3.Connection) -> None:
    conn.executescript(_DDL_001)


MIGRATIONS: list[Callable[[sqlite3.Connection], None]] = [migrate_001_initial]


def upgrade(conn: sqlite3.Connection) -> None:
    v = conn.execute("PRAGMA user_version").fetchone()[0]
    if v > len(MIGRATIONS):
        raise EnvError(
            f"Database schema v{v} is newer than this tracelabel ({len(MIGRATIONS)}). "
            f"Upgrade: pip install -U tracelabel"
        )
    for i in range(v, len(MIGRATIONS)):
        with conn:
            MIGRATIONS[i](conn)
            conn.execute(f"PRAGMA user_version = {i + 1}")


# ── Locking ─────────────────────────────────────────────────────────────────


def _lock_path(project_dir: Path) -> Path:
    return project_dir / ".tracelabel" / "lock"


def pid_is_alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes

        # Pragmatic fallback: OpenProcess succeeding is treated as "alive". Windows lacks
        # a signal-0 probe; this over-reports at worst (a live lock never gets reclaimed),
        # which is the safe direction.
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(  # type: ignore[attr-defined]
            PROCESS_QUERY_LIMITED_INFORMATION, False, pid
        )
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)  # type: ignore[attr-defined]
            return True
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def acquire_lock(project_dir: Path, port: int) -> None:
    lock = _lock_path(project_dir)
    lock.parent.mkdir(parents=True, exist_ok=True)
    if lock.exists():
        info = json.loads(lock.read_text())
        if pid_is_alive(info["pid"]):
            raise EnvError(
                f"Another tracelabel instance (pid {info['pid']}) is serving this project "
                f"on port {info['port']}. Stop it or use --db to point elsewhere."
            )
        lock.unlink()  # stale lock from a crash
    lock.write_text(json.dumps({"pid": os.getpid(), "port": port, "started_at": now_iso()}))
    atexit.register(release_lock, project_dir)


def release_lock(project_dir: Path) -> None:
    try:
        _lock_path(project_dir).unlink()
    except FileNotFoundError:
        pass


# ── Normative writes ────────────────────────────────────────────────────────


def _json_or_null(value: Any) -> str | None:
    return None if value is None else canonical_json(value)


def import_trace(
    conn: sqlite3.Connection,
    ctf: Json,
    source: str,
    on_conflict: Literal["fail", "skip"] = "fail",
) -> ImportResult:
    messages = ctf["messages"]
    tid = ctf.get("id") or derive_trace_id(messages)
    chash = content_hash(messages)

    existing = conn.execute("SELECT content_hash FROM traces WHERE id=?", (tid,)).fetchone()
    if existing:
        if existing["content_hash"] == chash:
            return "skipped_duplicate"
        if on_conflict == "skip":
            warnings.warn(
                f"trace {tid}: content differs from stored copy; keeping stored version",
                stacklevel=2,
            )
            return "skipped_conflict"
        raise UserError(
            f"trace {tid}: incoming content differs from the stored copy that existing "
            f"annotations reference. Re-run with --on-conflict skip to keep the stored "
            f"version, or import under a new id."
        )

    with conn:
        conn.execute(
            "INSERT INTO traces VALUES (?,?,?,?,?,?)",
            (
                tid,
                chash,
                source,
                canonical_json(ctf.get("metadata", {})),
                _json_or_null(ctf.get("raw")),
                now_iso(),
            ),
        )
        for i, m in enumerate(messages):
            conn.execute(
                "INSERT INTO turns VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    f"{tid}#{i}",
                    tid,
                    i,
                    m["role"],
                    # invariant #1: strings stored byte-for-byte; only a parts array wrapper
                    # is serialized. Never re-serialize an incoming string.
                    serialize_content(m["content"]),
                    content_type_of(m["content"]),
                    _json_or_null(m.get("tool_calls")),
                    m.get("tool_call_id"),
                    m.get("name"),
                    canonical_json(m.get("metadata", {})),
                    _json_or_null(m.get("raw")),
                ),
            )
    return "inserted"


def diff_schemas(old: list[dict[str, Any]], new: list[dict[str, Any]]) -> str:
    old_by = {f["name"]: f for f in old}
    new_by = {f["name"]: f for f in new}
    lines = [f"Field schema for this task changed ({len(old)} → {len(new)} fields):"]
    for name, f in new_by.items():
        if name not in old_by:
            lines.append(f"  + added   '{name}'")
        elif old_by[name] != f:
            lines.append(f"  ~ changed '{name}'")
    for name in old_by:
        if name not in new_by:
            lines.append(f"  - removed '{name}'")
    return "\n".join(lines)


def _random_seed() -> int:
    return random.randrange(2**63)


def _stdin_confirm(prompt: str) -> bool:
    return input(prompt + " ").strip().lower() in ("y", "yes")


def open_task(
    conn: sqlite3.Connection,
    resolved: ResolvedTaskConfig,
    assume_yes: bool,
    confirm: Callable[[str], bool] | None = None,
) -> None:
    if confirm is None:
        confirm = _stdin_confirm
    row = conn.execute("SELECT * FROM tasks WHERE name=?", (resolved.name,)).fetchone()
    if row is None:
        seed = _random_seed() if resolved.shuffle else None
        with conn:
            conn.execute(
                "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)",
                (
                    resolved.name,
                    resolved.level,
                    resolved.schema_hash,
                    canonical_json(resolved.fields),
                    canonical_json(resolved.label_roles),
                    seed,
                    now_iso(),
                    now_iso(),
                ),
            )
        return

    if row["level"] != resolved.level:
        raise UserError(
            f"Task '{resolved.name}' exists at level={row['level']}; got "
            f"level={resolved.level}. Pick a new task name."
        )
    if row["schema_hash"] != resolved.schema_hash:
        # SCHEMA DRIFT — invariant #5: be loud, require explicit consent.
        print(diff_schemas(json.loads(row["resolved_schema"]), resolved.fields))
        if not (
            assume_yes
            or confirm(
                f"Field schema changed for existing task '{resolved.name}'. Existing "
                f"annotations keep their old schema_hash. Continue with the NEW schema? [y/N]"
            )
        ):
            raise UserError("Aborted. Use a new --task name to start a fresh pass.")
        with conn:
            conn.execute(
                "UPDATE tasks SET schema_hash=?, resolved_schema=?, updated_at=? WHERE name=?",
                (
                    resolved.schema_hash,
                    canonical_json(resolved.fields),
                    now_iso(),
                    resolved.name,
                ),
            )


def upsert_annotation(
    conn: sqlite3.Connection,
    *,
    task: str,
    target_type: TargetType,
    target_id: str,
    status: str,
    values: Json,
    annotator: str,
    schema_hash: str,
    prefill_model: str | None,
) -> sqlite3.Row:
    ts = now_iso()
    with conn:
        conn.execute(
            """
            INSERT INTO annotations
              (task, target_type, target_id, status, "values", schema_hash,
               annotator, prefill_model, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT (task, target_type, target_id, annotator) DO UPDATE SET
              status=excluded.status, "values"=excluded."values",
              schema_hash=excluded.schema_hash, prefill_model=excluded.prefill_model,
              updated_at=excluded.updated_at
            """,
            (
                task,
                target_type,
                target_id,
                status,
                canonical_json(values),
                schema_hash,
                annotator,
                prefill_model,
                ts,
                ts,
            ),
        )
    return cast(
        sqlite3.Row,
        conn.execute(
            "SELECT * FROM annotations "
            "WHERE task=? AND target_type=? AND target_id=? AND annotator=?",
            (task, target_type, target_id, annotator),
        ).fetchone(),
    )


def upsert_suggestion(
    conn: sqlite3.Connection,
    *,
    task: str,
    target_type: TargetType,
    target_id: str,
    values: Json,
    model: str,
    raw_response: str | None,
) -> None:
    with conn:
        conn.execute(
            """
            INSERT INTO suggestions
              (task, target_type, target_id, "values", model, raw_response, created_at)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT (task, target_type, target_id) DO UPDATE SET
              "values"=excluded."values", model=excluded.model,
              raw_response=excluded.raw_response, created_at=excluded.created_at
            """,
            (
                task,
                target_type,
                target_id,
                canonical_json(values),
                model,
                raw_response,
                now_iso(),
            ),
        )


def build_queue(conn: sqlite3.Connection, task_name: str) -> list[str]:
    ids = [r[0] for r in conn.execute("SELECT id FROM traces ORDER BY imported_at, id")]
    row = conn.execute("SELECT shuffle_seed FROM tasks WHERE name=?", (task_name,)).fetchone()
    seed = row["shuffle_seed"] if row is not None else None
    if seed is not None:
        # Stored per-task seed → order is stable across resume. Turn order never shuffles.
        random.Random(seed).shuffle(ids)
    return ids


# ── Read helpers ────────────────────────────────────────────────────────────


def get_task(conn: sqlite3.Connection, name: str) -> sqlite3.Row | None:
    return cast(
        "sqlite3.Row | None",
        conn.execute("SELECT * FROM tasks WHERE name=?", (name,)).fetchone(),
    )


def _task_total(conn: sqlite3.Connection, task_row: sqlite3.Row) -> int:
    if task_row["level"] == "turn":
        row = conn.execute(
            "SELECT count(*) FROM turns " "WHERE role IN (SELECT value FROM json_each(?))",
            (task_row["label_roles"],),
        ).fetchone()
    else:
        row = conn.execute("SELECT count(*) FROM traces").fetchone()
    return cast(int, row[0])


def list_tasks(conn: sqlite3.Connection) -> list[Json]:
    out: list[Json] = []
    for t in conn.execute("SELECT * FROM tasks ORDER BY updated_at DESC, name"):
        addressed = conn.execute(
            "SELECT count(*) FROM annotations WHERE task=?", (t["name"],)
        ).fetchone()[0]
        out.append(
            {
                "name": t["name"],
                "level": t["level"],
                "schema_hash": t["schema_hash"],
                "updated_at": t["updated_at"],
                "total": _task_total(conn, t),
                "addressed": addressed,
            }
        )
    return out


def get_trace(conn: sqlite3.Connection, trace_id: str) -> sqlite3.Row | None:
    return cast(
        "sqlite3.Row | None",
        conn.execute("SELECT * FROM traces WHERE id=?", (trace_id,)).fetchone(),
    )


def get_turns(conn: sqlite3.Connection, trace_id: str) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM turns WHERE trace_id=? ORDER BY idx", (trace_id,)).fetchall()


def annotations_for_trace(
    conn: sqlite3.Connection, task: str, annotator: str, trace_id: str
) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT a.* FROM annotations a "
        "LEFT JOIN turns t ON a.target_type='turn' AND a.target_id = t.id "
        "WHERE a.task=? AND a.annotator=? AND ("
        "  (a.target_type='trace' AND a.target_id=?) "
        "  OR (a.target_type='turn' AND t.trace_id=?))",
        (task, annotator, trace_id, trace_id),
    ).fetchall()


def suggestions_for_trace(conn: sqlite3.Connection, task: str, trace_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT s.* FROM suggestions s "
        "LEFT JOIN turns t ON s.target_type='turn' AND s.target_id = t.id "
        "WHERE s.task=? AND ("
        "  (s.target_type='trace' AND s.target_id=?) "
        "  OR (s.target_type='turn' AND t.trace_id=?))",
        (task, trace_id, trace_id),
    ).fetchall()


def target_counts(
    conn: sqlite3.Connection, task_row: sqlite3.Row, annotator: str
) -> dict[str, tuple[int, int, int]]:
    if task_row["level"] == "turn":
        rows = conn.execute(
            "SELECT t.trace_id AS tid, "
            "  count(*) AS n_targets, "
            "  sum(CASE WHEN a.status='labeled' THEN 1 ELSE 0 END) AS n_labeled, "
            "  sum(CASE WHEN a.status='skipped' THEN 1 ELSE 0 END) AS n_skipped "
            "FROM turns t "
            "LEFT JOIN annotations a "
            "  ON a.task=? AND a.annotator=? AND a.target_type='turn' AND a.target_id=t.id "
            "WHERE t.role IN (SELECT value FROM json_each(?)) "
            "GROUP BY t.trace_id",
            (task_row["name"], annotator, task_row["label_roles"]),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT tr.id AS tid, "
            "  1 AS n_targets, "
            "  sum(CASE WHEN a.status='labeled' THEN 1 ELSE 0 END) AS n_labeled, "
            "  sum(CASE WHEN a.status='skipped' THEN 1 ELSE 0 END) AS n_skipped "
            "FROM traces tr "
            "LEFT JOIN annotations a "
            "  ON a.task=? AND a.annotator=? AND a.target_type='trace' AND a.target_id=tr.id "
            "GROUP BY tr.id",
            (task_row["name"], annotator),
        ).fetchall()
    return {r["tid"]: (r["n_targets"], r["n_labeled"] or 0, r["n_skipped"] or 0) for r in rows}


def unaddressed_targets(conn: sqlite3.Connection, cfg: ResolvedTaskConfig) -> list[str]:
    if cfg.level == "turn":
        rows = conn.execute(
            "SELECT t.id FROM turns t "
            "WHERE t.role IN (SELECT value FROM json_each(?)) "
            "AND NOT EXISTS (SELECT 1 FROM annotations a WHERE a.task=? "
            "  AND a.annotator=? AND a.target_type='turn' AND a.target_id=t.id) "
            "ORDER BY t.trace_id, t.idx",
            (canonical_json(cfg.label_roles), cfg.name, cfg.annotator),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT tr.id FROM traces tr "
            "WHERE NOT EXISTS (SELECT 1 FROM annotations a WHERE a.task=? "
            "  AND a.annotator=? AND a.target_type='trace' AND a.target_id=tr.id) "
            "ORDER BY tr.imported_at, tr.id",
            (cfg.name, cfg.annotator),
        ).fetchall()
    return [r[0] for r in rows]


def targets_without_suggestion(
    conn: sqlite3.Connection, task: str, target_ids: list[str]
) -> list[str]:
    have = {r[0] for r in conn.execute("SELECT target_id FROM suggestions WHERE task=?", (task,))}
    return [tid for tid in target_ids if tid not in have]
