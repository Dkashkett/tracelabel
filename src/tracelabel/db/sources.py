"""CRUD over the ``sources`` and ``trace_sources`` tables added in schema v3.

A "source" is one completed import (a file, a paste, a directory of documents). It
records what was imported and links every trace that import produced, so the UI can
list "where did this trace come from" and "what did this import bring in."

Mirrors the existing repository pattern in this package (see ``TraceRepository`` in
``traces.py`` and ``TaskRepository`` in ``tasks.py``): constructor-injected connection
+ transaction + clock, plain ``sqlite3.Row`` results, no ORM.
"""

import sqlite3
from typing import cast

from .database import Clock, TransactionFactory


class SourceRepository:
    def __init__(
        self,
        connection: sqlite3.Connection,
        transaction: TransactionFactory,
        clock: Clock,
    ) -> None:
        self._connection = connection
        self._transaction = transaction
        self._clock = clock

    def record_import(
        self,
        *,
        name: str,
        path: str | None,
        adapter: str,
        trace_ids: list[str],
    ) -> sqlite3.Row:
        """Create one ``sources`` row and link every trace a completed import produced.

        Call this only after traces have actually been written (from
        ``ImportService.import_source``) — ``ImportService.preview()`` writes nothing
        and never calls this.
        """
        timestamp = self._clock()
        with self._transaction() as connection:
            cursor = connection.execute(
                "INSERT INTO sources (name, path, adapter, imported_at, trace_count) "
                "VALUES (?,?,?,?,?)",
                (name, path, adapter, timestamp, len(trace_ids)),
            )
            source_id = cast(int, cursor.lastrowid)
            connection.executemany(
                "INSERT OR IGNORE INTO trace_sources (source_id, trace_id) VALUES (?,?)",
                [(source_id, trace_id) for trace_id in trace_ids],
            )
        row = self.get(source_id)
        assert row is not None  # just inserted, in the same connection
        return row

    def get(self, source_id: int) -> sqlite3.Row | None:
        return cast(
            "sqlite3.Row | None",
            self._connection.execute(
                "SELECT * FROM sources WHERE id=?",
                (source_id,),
            ).fetchone(),
        )

    def list_all(self) -> list[sqlite3.Row]:
        return self._connection.execute("SELECT * FROM sources ORDER BY imported_at, id").fetchall()

    def trace_ids_for(self, source_id: int) -> list[str]:
        rows = self._connection.execute(
            "SELECT trace_id FROM trace_sources WHERE source_id=? ORDER BY trace_id",
            (source_id,),
        ).fetchall()
        return [str(row[0]) for row in rows]
