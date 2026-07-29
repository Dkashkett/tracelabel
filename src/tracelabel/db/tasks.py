import random
import sqlite3
from collections.abc import Callable
from typing import Any, cast

from tracelabel.config.models import LLMConfig, ResolvedTaskConfig, TaskSpec
from tracelabel.config.resolver import compat_hash as compute_compat_hash
from tracelabel.ctf.hashing import canonical_json, sha256_hex
from tracelabel.ctf.models import Json
from tracelabel.errors import NotFoundError, UserError

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


def full_schema_hash(fields: list[dict[str, Any]]) -> str:
    """Hash of the complete field schema, written onto every annotation.

    This is the documented export column contract (README.md) — any change to the
    fields, however cosmetic, changes this hash. It is distinct from ``compat_hash``
    (``config/resolver.py``), which only tracks changes that can actually invalidate
    an existing annotation.
    """
    return sha256_hex(canonical_json(fields))


class TaskRepository:
    def __init__(
        self,
        connection: sqlite3.Connection,
        transaction: TransactionFactory,
        clock: Clock,
        *,
        seed_factory: Callable[[], int] | None = None,
    ) -> None:
        self._connection = connection
        self._transaction = transaction
        self._clock = clock
        self._seed_factory = seed_factory or (lambda: random.randrange(2**63))

    # ── creation ─────────────────────────────────────────────────────────────

    def create(self, spec: TaskSpec) -> sqlite3.Row:
        """Insert a brand-new task row from a ``TaskSpec`` and return it.

        Raises ``UserError`` if a task with this name already exists — callers that
        want "create or reconcile" behavior should use ``open()`` instead.
        """
        if self.get(spec.name) is not None:
            raise UserError(f"Task '{spec.name}' already exists. Pick a new task name.")
        values = self._row_values(
            name=spec.name,
            level=spec.level,
            fields=spec.fields,
            label_roles=spec.label_roles,
            shuffle=spec.shuffle,
            annotator=spec.annotator,
            llm=spec.llm,
            suggest_instructions=spec.suggest_instructions,
            review_of=spec.review_of,
            review_labels_from=spec.review_labels_from,
            queue_scope=spec.queue_scope,
        )
        with self._transaction() as connection:
            self._insert(connection, values)
        return self._require(spec.name)

    def _create_from_resolved(self, resolved: ResolvedTaskConfig) -> None:
        """Back-compat creation path for callers that still hand in a fully-resolved
        YAML/CLI config (see ``open()``) rather than the newer API-facing ``TaskSpec``.
        """
        values = self._row_values(
            name=resolved.name,
            level=resolved.level,
            fields=resolved.fields,
            label_roles=resolved.label_roles,
            shuffle=resolved.shuffle,
            annotator=resolved.annotator,
            llm=resolved.llm,
            suggest_instructions=resolved.suggest_instructions,
            review_of=resolved.review_of,
            review_labels_from=resolved.review_labels_from,
            queue_scope={"type": "all"},
        )
        with self._transaction() as connection:
            self._insert(connection, values)

    def _row_values(
        self,
        *,
        name: str,
        level: str,
        fields: list[dict[str, Any]],
        label_roles: list[str],
        shuffle: bool,
        annotator: str,
        llm: LLMConfig | None,
        suggest_instructions: str | None,
        review_of: str | None,
        review_labels_from: str,
        queue_scope: dict[str, Any],
    ) -> dict[str, Any]:
        timestamp = self._clock()
        values: dict[str, Any] = {
            "name": name,
            "level": level,
            "schema_hash": full_schema_hash(fields),
            "resolved_schema": canonical_json(fields),
            "label_roles": canonical_json(label_roles),
            "shuffle_seed": self._seed_factory() if shuffle else None,
            "created_at": timestamp,
            "updated_at": timestamp,
            "compat_hash": compute_compat_hash(fields),
            "queue_scope": canonical_json(queue_scope),
            "annotator": annotator,
            "suggest_instructions": suggest_instructions,
            "review_of": review_of,
            "review_labels_from": review_labels_from,
        }
        if llm is not None:
            values["llm_model"] = llm.model
            values["llm_temperature"] = llm.temperature
            values["llm_max_tokens"] = llm.max_tokens
        return values

    @staticmethod
    def _insert(connection: sqlite3.Connection, values: dict[str, Any]) -> None:
        columns = list(values)
        placeholders = ", ".join(f":{column}" for column in columns)
        connection.execute(
            f"INSERT INTO tasks ({', '.join(columns)}) VALUES ({placeholders})",
            values,
        )

    # ── schema updates ──────────────────────────────────────────────────────

    def update_schema(
        self, name: str, fields: list[dict[str, Any]], *, confirmed: bool
    ) -> sqlite3.Row:
        """Replace a task's field schema.

        ``confirmed`` is a plain bool the caller (eventually the API's
        ``PATCH .../schema?confirm=`` route, via the 409 ``SchemaImpactOut`` flow)
        decides on its own — this method never prompts. If the schema actually
        changed and the caller didn't confirm, it raises ``UserError`` instead of
        writing anything.
        """
        row = self._require(name)
        new_hash = full_schema_hash(fields)
        if row["schema_hash"] == new_hash:
            return row
        if not confirmed:
            old_schema = cast(list[dict[str, Any]], decode_json(row["resolved_schema"]))
            raise UserError(
                f"{diff_schemas(old_schema, fields)}\n"
                f"Aborted — schema change for task '{name}' was not confirmed. Existing "
                "annotations keep their old schema_hash; pass confirmed=True to proceed."
            )
        with self._transaction() as connection:
            connection.execute(
                "UPDATE tasks SET schema_hash=:schema_hash, resolved_schema=:resolved_schema, "
                "compat_hash=:compat_hash, updated_at=:updated_at WHERE name=:name",
                {
                    "schema_hash": new_hash,
                    "resolved_schema": canonical_json(fields),
                    "compat_hash": compute_compat_hash(fields),
                    "updated_at": self._clock(),
                    "name": name,
                },
            )
        return self._require(name)

    def open(
        self,
        resolved: ResolvedTaskConfig,
        *,
        assume_yes: bool,
        confirm: Confirm | None = None,
    ) -> None:
        """Create the task if it's new, else reconcile schema drift.

        This is the YAML/CLI resolution flow's entry point — ``ConfigResolver``
        still produces a ``ResolvedTaskConfig``, not a ``TaskSpec``. There is no
        stdin fallback: if the schema drifted and the caller passed neither
        ``assume_yes=True`` nor a ``confirm`` callback that returns ``True``, this
        raises rather than blocking on input().
        """
        row = self.get(resolved.name)
        if row is None:
            self._create_from_resolved(resolved)
            return
        if row["level"] != resolved.level:
            raise UserError(
                f"Task '{resolved.name}' exists at level={row['level']}; got "
                f"level={resolved.level}. Pick a new task name."
            )
        if row["schema_hash"] == resolved.schema_hash:
            return
        prompt = (
            f"Field schema changed for existing task '{resolved.name}'. Existing "
            "annotations keep their old schema_hash. Continue with the NEW schema? [y/N]"
        )
        confirmed = assume_yes or (confirm is not None and confirm(prompt))
        self.update_schema(resolved.name, resolved.fields, confirmed=confirmed)

    # ── reads ────────────────────────────────────────────────────────────────

    def get(self, name: str) -> sqlite3.Row | None:
        return cast(
            "sqlite3.Row | None",
            self._connection.execute(
                "SELECT * FROM tasks WHERE name=?",
                (name,),
            ).fetchone(),
        )

    def _require(self, name: str) -> sqlite3.Row:
        row = self.get(name)
        if row is None:
            raise NotFoundError(f"No task named '{name}'.")
        return row

    def resolve(self, name: str) -> ResolvedTaskConfig:
        """Build a ``ResolvedTaskConfig`` from the stored row.

        This is what makes ``LabelingService``, ``AnnotationValidator``,
        ``SuggestionService`` and ``ExportService`` work unchanged even though the
        config now lives in the database instead of YAML — only the *source* moved.
        """
        row = self._require(name)
        llm = None
        if row["llm_model"] is not None:
            llm = LLMConfig(
                model=row["llm_model"],
                temperature=(row["llm_temperature"] if row["llm_temperature"] is not None else 0.0),
                max_tokens=(row["llm_max_tokens"] if row["llm_max_tokens"] is not None else 1024),
            )
        return ResolvedTaskConfig(
            name=row["name"],
            level=row["level"],
            fields=cast(list[dict[str, Any]], decode_json(row["resolved_schema"])),
            label_roles=cast(list[str], decode_json(row["label_roles"])),
            shuffle=row["shuffle_seed"] is not None,
            annotator=row["annotator"] or "",
            schema_hash=row["schema_hash"],
            llm=llm,
            suggest_instructions=row["suggest_instructions"],
            review_of=row["review_of"],
            review_labels_from=row["review_labels_from"],
        )

    # ── queue ────────────────────────────────────────────────────────────────

    def build_queue(self, task_name: str, trace_ids: list[str] | None = None) -> list[str]:
        row = self._require(task_name)
        if trace_ids is None:
            scope = cast(dict[str, Any], decode_json(row["queue_scope"]))
            trace_ids = self._scoped_trace_ids(scope)
        else:
            trace_ids = list(trace_ids)
        seed = row["shuffle_seed"]
        if seed is not None:
            random.Random(seed).shuffle(trace_ids)
        return trace_ids

    def _scoped_trace_ids(self, scope: dict[str, Any]) -> list[str]:
        if scope.get("type") == "source":
            source_ids = scope["source_ids"] if "source_ids" in scope else [scope["source_id"]]
            rows = self._connection.execute(
                "SELECT DISTINCT t.id FROM traces t JOIN trace_sources ts ON ts.trace_id = t.id "
                "WHERE ts.source_id IN (SELECT value FROM json_each(?)) "
                "ORDER BY t.imported_at, t.id",
                (canonical_json(source_ids),),
            )
        else:
            rows = self._connection.execute("SELECT id FROM traces ORDER BY imported_at, id")
        return [str(row[0]) for row in rows]

    # ── listing ──────────────────────────────────────────────────────────────

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
                    "queue_scope": decode_json(task["queue_scope"]),
                }
            )
        return summaries

    def _total(self, task: sqlite3.Row) -> int:
        scope = cast(dict[str, Any], decode_json(task["queue_scope"]))
        trace_ids = self._scoped_trace_ids(scope)
        if task["level"] == "trace":
            return len(trace_ids)
        row = self._connection.execute(
            "SELECT count(*) FROM turns WHERE role IN (SELECT value FROM json_each(?)) "
            "AND trace_id IN (SELECT value FROM json_each(?))",
            (task["label_roles"], canonical_json(trace_ids)),
        ).fetchone()
        return int(row[0])
