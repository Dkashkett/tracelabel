import sqlite3
import warnings
from typing import Any, Literal, cast

from tracelabel.ctf.content import content_type_of, serialize_content
from tracelabel.ctf.hashing import (
    canonical_json,
    content_hash,
    derive_document_id,
    derive_trace_id,
    document_content_hash,
)
from tracelabel.ctf.models import Json
from tracelabel.errors import UserError

from .database import Clock, TransactionFactory

ImportResult = Literal["inserted", "skipped_duplicate", "skipped_conflict"]
ConflictPolicy = Literal["fail", "skip"]


def _json_or_none(value: Any) -> str | None:
    return None if value is None else canonical_json(value)


class TraceRepository:
    def __init__(
        self,
        connection: sqlite3.Connection,
        transaction: TransactionFactory,
        clock: Clock,
    ) -> None:
        self._connection = connection
        self._transaction = transaction
        self._clock = clock

    def import_trace(
        self,
        trace: Json,
        source: str,
        on_conflict: ConflictPolicy = "fail",
    ) -> tuple[ImportResult, str]:
        messages = cast(list[Json], trace["messages"])
        trace_id = str(trace.get("id") or derive_trace_id(messages))
        incoming_hash = content_hash(messages)
        existing = self._connection.execute(
            "SELECT content_hash FROM traces WHERE id=?",
            (trace_id,),
        ).fetchone()
        if existing is not None:
            return self._handle_existing(trace_id, incoming_hash, existing, on_conflict), trace_id

        with self._transaction() as connection:
            connection.execute(
                "INSERT INTO traces (id, content_hash, source, metadata, raw, imported_at) "
                "VALUES (?,?,?,?,?,?)",
                (
                    trace_id,
                    incoming_hash,
                    source,
                    canonical_json(trace.get("metadata", {})),
                    _json_or_none(trace.get("raw")),
                    self._clock(),
                ),
            )
            for index, message in enumerate(messages):
                content = cast(str | list[Json], message["content"])
                connection.execute(
                    "INSERT INTO turns VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        f"{trace_id}#{index}",
                        trace_id,
                        index,
                        message["role"],
                        serialize_content(content),
                        content_type_of(content),
                        _json_or_none(message.get("tool_calls")),
                        message.get("tool_call_id"),
                        message.get("name"),
                        canonical_json(message.get("metadata", {})),
                        _json_or_none(message.get("raw")),
                    ),
                )
        return "inserted", trace_id

    def import_document(
        self,
        document: Json,
        source: str,
        on_conflict: ConflictPolicy = "fail",
    ) -> tuple[ImportResult, str]:
        content = cast(str, document["content"])
        content_type = document.get("content_type")
        doc_id = str(document.get("id") or derive_document_id(content))
        incoming_hash = document_content_hash(content, content_type)
        existing = self._connection.execute(
            "SELECT content_hash FROM traces WHERE id=?",
            (doc_id,),
        ).fetchone()
        if existing is not None:
            return self._handle_existing(doc_id, incoming_hash, existing, on_conflict), doc_id

        with self._transaction() as connection:
            connection.execute(
                "INSERT INTO traces "
                "(id, content_hash, source, metadata, raw, imported_at, content, content_type) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    doc_id,
                    incoming_hash,
                    source,
                    canonical_json(document.get("metadata", {})),
                    _json_or_none(document.get("raw")),
                    self._clock(),
                    content,
                    content_type,
                ),
            )
        return "inserted", doc_id

    def _handle_existing(
        self,
        trace_id: str,
        incoming_hash: str,
        existing: sqlite3.Row,
        on_conflict: ConflictPolicy,
    ) -> ImportResult:
        if existing["content_hash"] == incoming_hash:
            return "skipped_duplicate"
        if on_conflict == "skip":
            warnings.warn(
                f"trace {trace_id}: content differs from stored copy; keeping stored version",
                stacklevel=3,
            )
            return "skipped_conflict"
        raise UserError(
            f"trace {trace_id}: incoming content differs from the stored copy that existing "
            "annotations reference. Re-run with --on-conflict skip to keep the stored "
            "version, or import under a new id."
        )

    def get(self, trace_id: str) -> sqlite3.Row | None:
        return cast(
            "sqlite3.Row | None",
            self._connection.execute(
                "SELECT * FROM traces WHERE id=?",
                (trace_id,),
            ).fetchone(),
        )

    def get_turn(self, turn_id: str) -> sqlite3.Row | None:
        return cast(
            "sqlite3.Row | None",
            self._connection.execute(
                "SELECT * FROM turns WHERE id=?",
                (turn_id,),
            ).fetchone(),
        )

    def get_turns(self, trace_id: str) -> list[sqlite3.Row]:
        return self._connection.execute(
            "SELECT * FROM turns WHERE trace_id=? ORDER BY idx",
            (trace_id,),
        ).fetchall()

    def ordered_ids(self) -> list[str]:
        rows = self._connection.execute("SELECT id FROM traces ORDER BY imported_at, id").fetchall()
        return [str(row[0]) for row in rows]
