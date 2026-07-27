"""The on-disk workspace root: settings, the workspace lock, and per-project directories.

W0-BE defines the shape only — every ``Workspace`` and ``WorkspaceLock`` method body
raises ``NotImplementedError``. W1-WORKSPACE (Wave 1) implements them, moving
``ProjectLock``'s PID-probe logic (``db/locking.py``) into ``WorkspaceLock`` unchanged
and adding a ``threading.RLock`` around ``Database.transaction()`` for background-thread
safety. This module exists in Wave 0 so ``api/deps.py``, ``api/app.py`` and ``jobs.py``
callers have a frozen interface to import and type-check against.
"""

import json
import os
import re
import shutil
from collections.abc import Callable
from pathlib import Path
from types import TracebackType
from typing import Any

from tracelabel.db.database import Clock, Database, now_iso
from tracelabel.db.locking import pid_is_alive
from tracelabel.errors import EnvError, NotFoundError

from .models import ProjectRecord, Settings

_SLUG_DISALLOWED = re.compile(r"[^a-z0-9]+")


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


def slugify(name: str) -> str:
    """Lowercase, collapse runs of non-alphanumerics to a single ``-``, trim leading and
    trailing ``-``. Guaranteed to match ``^[a-z0-9][a-z0-9-]*$`` unless ``name`` has no
    alphanumeric characters at all, in which case it falls back to ``"project"``.
    """
    slug = _SLUG_DISALLOWED.sub("-", name.lower()).strip("-")
    return slug or "project"


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
        self._acquired = False

    def acquire(self) -> "WorkspaceLock":
        if self._acquired:
            return self
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            info = self._read_existing()
            existing_pid = int(info["pid"])
            if pid_is_alive(existing_pid):
                raise EnvError(
                    f"Another tracelabel instance (pid {existing_pid}) is serving this "
                    f"workspace on port {info['port']}. Stop it or use --dir to point "
                    "elsewhere."
                )
            self.path.unlink()
        payload = {"pid": self._pid, "port": self.port, "started_at": self._clock()}
        self.path.write_text(json.dumps(payload), encoding="utf-8")
        self._acquired = True
        return self

    def _read_existing(self) -> dict[str, Any]:
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise EnvError(f"Cannot read workspace lock {self.path}: {error}") from error
        if not isinstance(value, dict) or "pid" not in value or "port" not in value:
            raise EnvError(f"Workspace lock {self.path} is malformed")
        return value

    def release(self) -> None:
        if not self._acquired:
            return
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass
        self._acquired = False

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

    def _settings_path(self) -> Path:
        return self.root / "settings.json"

    def read_settings(self) -> Settings:
        path = self._settings_path()
        if not path.exists():
            return Settings()
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise EnvError(f"Cannot read workspace settings {path}: {error}") from error
        return Settings(
            annotator=raw.get("annotator"),
            default_llm_model=raw.get("default_llm_model"),
            theme=raw.get("theme", "system"),
        )

    def write_settings(self, settings: Settings) -> Settings:
        path = self._settings_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "annotator": settings.annotator,
            "default_llm_model": settings.default_llm_model,
            "theme": settings.theme,
        }
        path.write_text(json.dumps(payload), encoding="utf-8")
        return settings

    def _projects_dir(self) -> Path:
        return self.root / "projects"

    def _read_project_record(self, project_dir: Path) -> ProjectRecord:
        raw = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
        return ProjectRecord(
            name=raw["name"],
            slug=raw["slug"],
            created_at=raw["created_at"],
            notes=raw.get("notes", ""),
        )

    def list_projects(self) -> list[ProjectRecord]:
        projects_dir = self._projects_dir()
        if not projects_dir.exists():
            return []
        records = [
            self._read_project_record(child)
            for child in sorted(projects_dir.iterdir())
            if (child / "project.json").exists()
        ]
        return sorted(records, key=lambda record: record.slug)

    def get_project(self, slug: str) -> ProjectRecord | None:
        project_file = self.project_dir(slug) / "project.json"
        if not project_file.exists():
            return None
        return self._read_project_record(self.project_dir(slug))

    def _unique_slug(self, base_slug: str) -> str:
        existing = {record.slug for record in self.list_projects()}
        if base_slug not in existing:
            return base_slug
        suffix = 2
        while f"{base_slug}-{suffix}" in existing:
            suffix += 1
        return f"{base_slug}-{suffix}"

    def create_project(self, name: str, *, notes: str = "") -> ProjectRecord:
        slug = self._unique_slug(slugify(name))
        record = ProjectRecord(name=name, slug=slug, created_at=self._clock(), notes=notes)
        project_dir = self.project_dir(slug)
        project_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "name": record.name,
            "slug": record.slug,
            "created_at": record.created_at,
            "notes": record.notes,
        }
        (project_dir / "project.json").write_text(json.dumps(payload), encoding="utf-8")
        return record

    def delete_project(self, slug: str) -> None:
        if self.get_project(slug) is None:
            raise NotFoundError(f"unknown project '{slug}'")
        shutil.rmtree(self.project_dir(slug))

    def open_database(self, slug: str) -> Database:
        if self.get_project(slug) is None:
            raise NotFoundError(f"unknown project '{slug}'")
        return self._database_factory(self.database_path(slug))
