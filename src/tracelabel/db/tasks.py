import random
import sqlite3
from collections.abc import Callable
from typing import Any, cast

from tracelabel.config.models import ResolvedTaskConfig
from tracelabel.ctf.hashing import canonical_json
from tracelabel.ctf.models import Json
from tracelabel.errors import UserError

from .database import Clock, TransactionFactory, decode_json

Confirm = Callable[[str], bool]


def diff_schemas(old: list[dict[str, Any]], new: list[dict[str, Any]]) -> str:
    old_by_name = {field["name"]: field for field in old}
    new_by_name = {field["name"]: field for field in new}
    lines = [f"Field schema for this task changed ({len(old)} → {len(new)} fields):"]
    for name, field in new_by_name.items():
        if name not in old_by_name:
            lines.append(f"  + added   '{name}'")
        elif old_by_name[name] != field:
            lines.append(f"  ~ changed '{name}'")
    for name in old_by_name:
        if name not in new_by_name:
            lines.append(f"  - removed '{name}'")
    return "\n".join(lines)


def _stdin_confirm(prompt: str) -> bool:
    return input(prompt + " ").strip().lower() in ("y", "yes")


class TaskRepository:
    def __init__(
        self,
        connection: sqlite3.Connection,
        transaction: TransactionFactory,
        clock: Clock,
        *,
        seed_factory: Callable[[], int] | None = None,
        output: Callable[[str], None] = print,
    ) -> None:
        self._connection = connection
        self._transaction = transaction
        self._clock = clock
        self._seed_factory = seed_factory or (lambda: random.randrange(2**63))
        self._output = output

    def open(
        self,
        resolved: ResolvedTaskConfig,
        *,
        assume_yes: bool,
        confirm: Confirm | None = None,
    ) -> None:
        confirmation = confirm or _stdin_confirm
        row = self.get(resolved.name)
        if row is None:
            self._create(resolved)
            return
        if row["level"] != resolved.level:
            raise UserError(
                f"Task '{resolved.name}' exists at level={row['level']}; got "
                f"level={resolved.level}. Pick a new task name."
            )
        if row["schema_hash"] == resolved.schema_hash:
            return
        old_schema = cast(list[dict[str, Any]], decode_json(row["resolved_schema"]))
        self._output(diff_schemas(old_schema, resolved.fields))
        prompt = (
            f"Field schema changed for existing task '{resolved.name}'. Existing "
            "annotations keep their old schema_hash. Continue with the NEW schema? [y/N]"
        )
        if not assume_yes and not confirmation(prompt):
            raise UserError("Aborted. Use a new --task name to start a fresh pass.")
        with self._transaction() as connection:
            connection.execute(
                "UPDATE tasks SET schema_hash=?, resolved_schema=?, updated_at=? WHERE name=?",
                (
                    resolved.schema_hash,
                    canonical_json(resolved.fields),
                    self._clock(),
                    resolved.name,
                ),
            )

    def _create(self, resolved: ResolvedTaskConfig) -> None:
        timestamp = self._clock()
        seed = self._seed_factory() if resolved.shuffle else None
        with self._transaction() as connection:
            connection.execute(
                "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)",
                (
                    resolved.name,
                    resolved.level,
                    resolved.schema_hash,
                    canonical_json(resolved.fields),
                    canonical_json(resolved.label_roles),
                    seed,
                    timestamp,
                    timestamp,
                ),
            )

    def get(self, name: str) -> sqlite3.Row | None:
        return cast(
            "sqlite3.Row | None",
            self._connection.execute(
                "SELECT * FROM tasks WHERE name=?",
                (name,),
            ).fetchone(),
        )

    def build_queue(self, task_name: str) -> list[str]:
        trace_ids = [
            str(row[0])
            for row in self._connection.execute("SELECT id FROM traces ORDER BY imported_at, id")
        ]
        row = self._connection.execute(
            "SELECT shuffle_seed FROM tasks WHERE name=?",
            (task_name,),
        ).fetchone()
        seed = row["shuffle_seed"] if row is not None else None
        if seed is not None:
            random.Random(seed).shuffle(trace_ids)
        return trace_ids

    def list_summaries(self) -> list[Json]:
        summaries: list[Json] = []
        for task in self._connection.execute("SELECT * FROM tasks ORDER BY updated_at DESC, name"):
            addressed = int(
                self._connection.execute(
                    "SELECT count(*) FROM annotations WHERE task=?",
                    (task["name"],),
                ).fetchone()[0]
            )
            summaries.append(
                {
                    "name": task["name"],
                    "level": task["level"],
                    "schema_hash": task["schema_hash"],
                    "updated_at": task["updated_at"],
                    "total": self._total(task),
                    "addressed": addressed,
                }
            )
        return summaries

    def _total(self, task: sqlite3.Row) -> int:
        if task["level"] == "turn":
            row = self._connection.execute(
                "SELECT count(*) FROM turns WHERE role IN (SELECT value FROM json_each(?))",
                (task["label_roles"],),
            ).fetchone()
        else:
            row = self._connection.execute("SELECT count(*) FROM traces").fetchone()
        return int(row[0])
