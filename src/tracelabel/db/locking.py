import json
import os
from collections.abc import Callable
from pathlib import Path
from types import TracebackType
from typing import Any

from tracelabel.errors import EnvError

from .database import Clock, now_iso


def pid_is_alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes

        process_query_limited_information = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(  # type: ignore[attr-defined]
            process_query_limited_information,
            False,
            pid,
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


class ProjectLock:
    """Own a project lock from acquisition through deterministic context cleanup."""

    def __init__(
        self,
        project_dir: Path,
        port: int,
        *,
        process_probe: Callable[[int], bool] = pid_is_alive,
        pid: int | None = None,
        clock: Clock = now_iso,
    ) -> None:
        self.path = project_dir / ".tracelabel" / "lock"
        self.port = port
        self._process_probe = process_probe
        self._pid = pid if pid is not None else os.getpid()
        self._clock = clock
        self._acquired = False

    def acquire(self) -> "ProjectLock":
        if self._acquired:
            return self
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            info = self._read_existing()
            existing_pid = int(info["pid"])
            if self._process_probe(existing_pid):
                raise EnvError(
                    f"Another tracelabel instance (pid {existing_pid}) is serving this project "
                    f"on port {info['port']}. Stop it or use --db to point elsewhere."
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
            raise EnvError(f"Cannot read project lock {self.path}: {error}") from error
        if not isinstance(value, dict) or "pid" not in value or "port" not in value:
            raise EnvError(f"Project lock {self.path} is malformed")
        return value

    def release(self) -> None:
        if not self._acquired:
            return
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass
        self._acquired = False

    def __enter__(self) -> "ProjectLock":
        return self.acquire()

    def __exit__(
        self,
        _exception_type: type[BaseException] | None,
        _exception: BaseException | None,
        _traceback: TracebackType | None,
    ) -> None:
        self.release()
