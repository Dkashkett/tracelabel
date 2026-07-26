"""The on-disk workspace root: settings, the workspace lock, and per-project directories.

W0-BE defines the shape only — every ``Workspace`` and ``WorkspaceLock`` method body
raises ``NotImplementedError``. W1-WORKSPACE (Wave 1) implements them, moving
``ProjectLock``'s PID-probe logic (``db/locking.py``) into ``WorkspaceLock`` unchanged
and adding a ``threading.RLock`` around ``Database.transaction()`` for background-thread
safety. This module exists in Wave 0 so ``api/deps.py``, ``api/app.py`` and ``jobs.py``
callers have a frozen interface to import and type-check against.
"""

import os
from collections.abc import Callable
from pathlib import Path
from types import TracebackType

from tracelabel.db.database import Clock, Database, now_iso

from .models import ProjectRecord, Settings


def default_workspace_root(dir_override: Path | None = None) -> Path:
    """Resolve the workspace root: ``<dir_override>/.tracelabel`` if given, else
    ``$TRACELABEL_HOME/.tracelabel`` (tests set this so they never touch the real home
    directory), else ``~/.tracelabel``. One code path for both `--dir .` and the
    default — see report §6.2 and plan §4.
    """
    if dir_override is not None:
        return dir_override / ".tracelabel"
    home = os.environ.get("TRACELABEL_HOME")
    if home:
        return Path(home) / ".tracelabel"
    return Path.home() / ".tracelabel"


class WorkspaceLock:
    """The single workspace-wide lock, replacing the per-project ``db/locking.ProjectLock``.

    Body implemented by W1-WORKSPACE by moving ``ProjectLock``'s PID-probe logic here
    unchanged (``db/locking.py:13-66``).
    """

    def __init__(
        self,
        workspace_root: Path,
        port: int,
        *,
        pid: int | None = None,
        clock: Clock = now_iso,
    ) -> None:
        self.path = workspace_root / "lock"
        self.port = port
        self._pid = pid if pid is not None else os.getpid()
        self._clock = clock

    def acquire(self) -> "WorkspaceLock":
        raise NotImplementedError("implemented by W1-WORKSPACE")

    def release(self) -> None:
        raise NotImplementedError("implemented by W1-WORKSPACE")

    def __enter__(self) -> "WorkspaceLock":
        return self.acquire()

    def __exit__(
        self,
        _exception_type: type[BaseException] | None,
        _exception: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        self.release()


class Workspace:
    """Own the workspace root: settings, the project directory listing, and per-project
    database handles.

    Constructor DI: ``database_factory`` defaults to the real ``Database`` but can be
    swapped in tests.
    """

    def __init__(
        self,
        root: Path,
        *,
        database_factory: Callable[[Path], Database] = Database,
        clock: Clock = now_iso,
    ) -> None:
        self.root = root
        self._database_factory = database_factory
        self._clock = clock

    def project_dir(self, slug: str) -> Path:
        return self.root / "projects" / slug

    def database_path(self, slug: str) -> Path:
        return self.project_dir(slug) / "tracelabel.db"

    def read_settings(self) -> Settings:
        raise NotImplementedError("implemented by W1-WORKSPACE")

    def write_settings(self, settings: Settings) -> Settings:
        raise NotImplementedError("implemented by W1-WORKSPACE")

    def list_projects(self) -> list[ProjectRecord]:
        raise NotImplementedError("implemented by W1-WORKSPACE")

    def get_project(self, slug: str) -> ProjectRecord | None:
        raise NotImplementedError("implemented by W1-WORKSPACE")

    def create_project(self, name: str, *, notes: str = "") -> ProjectRecord:
        raise NotImplementedError("implemented by W1-WORKSPACE")

    def delete_project(self, slug: str) -> None:
        raise NotImplementedError("implemented by W1-WORKSPACE")

    def open_database(self, slug: str) -> Database:
        raise NotImplementedError("implemented by W1-WORKSPACE")
