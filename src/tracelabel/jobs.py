"""A tiny in-memory background job runner.

Imports and suggestion runs must not block the request that starts them (report
§7 "Real risks": a 500 MB JSONL would otherwise hang the UI). Routes call
``JobRunner.submit()`` with a callable and return its job id as a ``JobRef``; the
client then polls ``GET /api/jobs/{job_id}``, which routes to ``JobRunner.status()``.

Deliberately minimal: one process, one workspace, jobs live only in memory and are
gone on restart — matching the rest of tracelabel's no-daemon, single-player model.
"""

import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

JobState = Literal["pending", "running", "done", "error"]


@dataclass(frozen=True)
class JobSnapshot:
    """A point-in-time, immutable read of one job's state."""

    id: str
    state: JobState
    progress: float
    result: Any = None
    error: str | None = None


class Job:
    """One tracked unit of background work.

    Runs ``target`` on its own thread. ``target`` receives this ``Job`` back so it can
    call ``report_progress()`` as it works (e.g. an import reporting rows processed).
    """

    def __init__(self, job_id: str, target: Callable[["Job"], Any]) -> None:
        self.id = job_id
        self._target = target
        self._lock = threading.Lock()
        self._state: JobState = "pending"
        self._progress = 0.0
        self._result: Any = None
        self._error: str | None = None
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> "Job":
        self._thread.start()
        return self

    def report_progress(self, fraction: float) -> None:
        with self._lock:
            self._progress = fraction

    def snapshot(self) -> JobSnapshot:
        with self._lock:
            return JobSnapshot(
                id=self.id,
                state=self._state,
                progress=self._progress,
                result=self._result,
                error=self._error,
            )

    def _run(self) -> None:
        with self._lock:
            self._state = "running"
        try:
            result = self._target(self)
        except Exception as error:  # noqa: BLE001 - reported to the client, not re-raised
            with self._lock:
                self._state = "error"
                self._error = str(error)
            return
        with self._lock:
            self._state = "done"
            self._result = result
            self._progress = 1.0


class JobRunner:
    """Own the registry of background jobs for one running server.

    Constructor DI: pass ``id_factory`` in tests for deterministic job ids.
    """

    def __init__(self, *, id_factory: Callable[[], str] = lambda: uuid.uuid4().hex) -> None:
        self._id_factory = id_factory
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def submit(self, target: Callable[[Job], Any]) -> str:
        job_id = self._id_factory()
        job = Job(job_id, target)
        with self._lock:
            self._jobs[job_id] = job
        job.start()
        return job_id

    def status(self, job_id: str) -> JobSnapshot | None:
        with self._lock:
            job = self._jobs.get(job_id)
        return job.snapshot() if job is not None else None
