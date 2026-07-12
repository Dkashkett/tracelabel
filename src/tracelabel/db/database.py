import json
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from types import TracebackType

from .migrations import upgrade

TransactionFactory = Callable[[], AbstractContextManager[sqlite3.Connection]]
Clock = Callable[[], str]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def default_db_path(project_dir: Path) -> Path:
    return project_dir / ".tracelabel" / "tracelabel.db"


def decode_json(value: str) -> object:
    return json.loads(value)


class Database:
    """Own a configured SQLite connection and the repositories that share its transactions."""

    def __init__(self, path: Path, *, clock: Clock | None = None) -> None:
        from .annotations import AnnotationRepository
        from .tasks import TaskRepository
        from .traces import TraceRepository

        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._transaction_depth = 0
        self._closed = False
        resolved_clock = clock or now_iso
        try:
            self._configure()
            upgrade(self.connection)
        except BaseException:
            self.connection.close()
            self._closed = True
            raise
        self.traces: TraceRepository = TraceRepository(
            self.connection,
            self.transaction,
            resolved_clock,
        )
        self.tasks: TaskRepository = TaskRepository(
            self.connection,
            self.transaction,
            resolved_clock,
        )
        self.annotations: AnnotationRepository = AnnotationRepository(
            self.connection,
            self.transaction,
            resolved_clock,
        )

    def _configure(self) -> None:
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA busy_timeout=5000")

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        outermost = self._transaction_depth == 0
        self._transaction_depth += 1
        try:
            if outermost and not self.connection.in_transaction:
                self.connection.execute("BEGIN")
            yield self.connection
            if outermost:
                self.connection.commit()
        except BaseException:
            if outermost:
                self.connection.rollback()
            raise
        finally:
            self._transaction_depth -= 1

    def close(self) -> None:
        if not self._closed:
            self.connection.close()
            self._closed = True

    def __enter__(self) -> "Database":
        return self

    def __exit__(
        self,
        _exception_type: type[BaseException] | None,
        _exception: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        self.close()
