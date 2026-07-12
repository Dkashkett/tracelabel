import sqlite3
from typing import Any, Literal, cast

from tracelabel.config.models import AnnotationStatus, ResolvedTaskConfig
from tracelabel.ctf.hashing import canonical_json
from tracelabel.ctf.models import Json

from .database import Clock, TransactionFactory

TargetType = Literal["turn", "trace"]
ExportStatus = Literal["labeled", "skipped", "all"]


class AnnotationRepository:
    def __init__(
        self,
        connection: sqlite3.Connection,
        transaction: TransactionFactory,
        clock: Clock,
    ) -> None:
        self._connection = connection
        self._transaction = transaction
        self._clock = clock

    def upsert_annotation(
        self,
        *,
        task: str,
        target_type: TargetType,
        target_id: str,
        status: AnnotationStatus,
        values: Json,
        annotator: str,
        schema_hash: str,
        prefill_model: str | None,
    ) -> sqlite3.Row:
        timestamp = self._clock()
        with self._transaction() as connection:
            connection.execute(
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
                    timestamp,
                    timestamp,
                ),
            )
        return cast(
            sqlite3.Row,
            self._connection.execute(
                "SELECT * FROM annotations "
                "WHERE task=? AND target_type=? AND target_id=? AND annotator=?",
                (task, target_type, target_id, annotator),
            ).fetchone(),
        )

    def upsert_suggestion(
        self,
        *,
        task: str,
        target_type: TargetType,
        target_id: str,
        values: Json,
        model: str,
        raw_response: str | None,
    ) -> None:
        with self._transaction() as connection:
            connection.execute(
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
                    self._clock(),
                ),
            )

    def annotations_for_trace(
        self,
        task: str,
        annotator: str,
        trace_id: str,
    ) -> list[sqlite3.Row]:
        return self._connection.execute(
            "SELECT a.* FROM annotations a "
            "LEFT JOIN turns t ON a.target_type='turn' AND a.target_id = t.id "
            "WHERE a.task=? AND a.annotator=? AND ("
            "  (a.target_type='trace' AND a.target_id=?) "
            "  OR (a.target_type='turn' AND t.trace_id=?))",
            (task, annotator, trace_id, trace_id),
        ).fetchall()

    def suggestions_for_trace(self, task: str, trace_id: str) -> list[sqlite3.Row]:
        return self._connection.execute(
            "SELECT s.* FROM suggestions s "
            "LEFT JOIN turns t ON s.target_type='turn' AND s.target_id = t.id "
            "WHERE s.task=? AND ("
            "  (s.target_type='trace' AND s.target_id=?) "
            "  OR (s.target_type='turn' AND t.trace_id=?))",
            (task, trace_id, trace_id),
        ).fetchall()

    def target_counts(
        self,
        task: sqlite3.Row,
        annotator: str,
    ) -> dict[str, tuple[int, int, int]]:
        if task["level"] == "turn":
            rows = self._connection.execute(
                "SELECT t.trace_id AS tid, "
                "  count(*) AS n_targets, "
                "  sum(CASE WHEN a.status='labeled' THEN 1 ELSE 0 END) AS n_labeled, "
                "  sum(CASE WHEN a.status='skipped' THEN 1 ELSE 0 END) AS n_skipped "
                "FROM turns t "
                "LEFT JOIN annotations a "
                "  ON a.task=? AND a.annotator=? AND a.target_type='turn' AND a.target_id=t.id "
                "WHERE t.role IN (SELECT value FROM json_each(?)) "
                "GROUP BY t.trace_id",
                (task["name"], annotator, task["label_roles"]),
            ).fetchall()
        else:
            rows = self._connection.execute(
                "SELECT tr.id AS tid, "
                "  1 AS n_targets, "
                "  sum(CASE WHEN a.status='labeled' THEN 1 ELSE 0 END) AS n_labeled, "
                "  sum(CASE WHEN a.status='skipped' THEN 1 ELSE 0 END) AS n_skipped "
                "FROM traces tr "
                "LEFT JOIN annotations a "
                "  ON a.task=? AND a.annotator=? AND a.target_type='trace' AND a.target_id=tr.id "
                "GROUP BY tr.id",
                (task["name"], annotator),
            ).fetchall()
        return {
            str(row["tid"]): (
                int(row["n_targets"]),
                int(row["n_labeled"] or 0),
                int(row["n_skipped"] or 0),
            )
            for row in rows
        }

    def unaddressed_targets(
        self, config: ResolvedTaskConfig, trace_ids: list[str] | None = None
    ) -> list[str]:
        scope_clause = ""
        scope_params: list[Any] = []
        if trace_ids is not None:
            scope_clause = " AND {column} IN (SELECT value FROM json_each(?))"
            scope_params = [canonical_json(trace_ids)]
        if config.level == "turn":
            rows = self._connection.execute(
                "SELECT t.id FROM turns t "
                "WHERE t.role IN (SELECT value FROM json_each(?)) "
                "AND NOT EXISTS (SELECT 1 FROM annotations a WHERE a.task=? "
                "  AND a.annotator=? AND a.target_type='turn' AND a.target_id=t.id) "
                + scope_clause.format(column="t.trace_id")
                + " ORDER BY t.trace_id, t.idx",
                (canonical_json(config.label_roles), config.name, config.annotator, *scope_params),
            ).fetchall()
        else:
            rows = self._connection.execute(
                "SELECT tr.id FROM traces tr "
                "WHERE NOT EXISTS (SELECT 1 FROM annotations a WHERE a.task=? "
                "  AND a.annotator=? AND a.target_type='trace' AND a.target_id=tr.id) "
                + scope_clause.format(column="tr.id")
                + " ORDER BY tr.imported_at, tr.id",
                (config.name, config.annotator, *scope_params),
            ).fetchall()
        return [str(row[0]) for row in rows]

    def targets_without_suggestion(self, task: str, target_ids: list[str]) -> list[str]:
        existing = {
            str(row[0])
            for row in self._connection.execute(
                "SELECT target_id FROM suggestions WHERE task=?",
                (task,),
            )
        }
        return [target_id for target_id in target_ids if target_id not in existing]

    def list_for_export(self, task: str, status: ExportStatus) -> list[sqlite3.Row]:
        sql = "SELECT * FROM annotations WHERE task=?"
        parameters: list[Any] = [task]
        if status != "all":
            sql += " AND status=?"
            parameters.append(status)
        sql += " ORDER BY target_type, target_id, annotator"
        return self._connection.execute(sql, parameters).fetchall()
