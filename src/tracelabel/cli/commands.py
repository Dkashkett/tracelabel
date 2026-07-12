import importlib.resources as resources
import socket
import tempfile
import webbrowser
from collections.abc import Callable
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any

import typer
import uvicorn
from fastapi import FastAPI

from tracelabel.api.app import create_app
from tracelabel.config.loader import raw_config_for_target
from tracelabel.config.models import CliArgs, ResolvedTaskConfig
from tracelabel.config.resolver import ConfigResolver
from tracelabel.ctf.validation import CtfValidator
from tracelabel.db.annotations import ExportStatus
from tracelabel.db.database import Database, default_db_path
from tracelabel.db.locking import ProjectLock
from tracelabel.db.traces import ConflictPolicy
from tracelabel.errors import EnvError, UserError
from tracelabel.exporting.service import ExportFormat, ExportService
from tracelabel.imports.adapters.base import AdapterRegistry
from tracelabel.imports.service import ImportService, ImportSummary
from tracelabel.suggestions.client import LiteLLMClient
from tracelabel.suggestions.service import SuggestionService, SuggestionSummary

from .output import print_import_summary, print_tasks_table

PortProbe = Callable[[str, int], bool]
ServerCallable = Callable[..., None]
BrowserCallable = Callable[[str], Any]
DatabaseFactory = Callable[[Path], Database]
LockFactory = Callable[[Path, int], AbstractContextManager[ProjectLock]]


def port_is_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
        try:
            candidate.bind((host, port))
        except OSError:
            return False
    return True


def pick_port(requested: int = 8377, probe: PortProbe | None = None) -> int:
    return ServerRunner(port_probe=probe).pick_port(requested)


class ServerRunner:
    def __init__(
        self,
        *,
        port_probe: PortProbe | None = None,
        server: ServerCallable | None = None,
        browser: BrowserCallable | None = None,
    ) -> None:
        self._port_probe = port_probe
        self._server = server
        self._browser = browser

    def pick_port(self, requested: int = 8377) -> int:
        probe = self._port_probe or port_is_available
        for port in range(requested, requested + 10):
            if not probe("127.0.0.1", port):
                continue
            if port != requested:
                typer.echo(f"port {requested} is busy; using {port} instead")
            return port
        raise EnvError(
            f"No free port in {requested}–{requested + 9}. Free one up or pass a different --port."
        )

    def run(self, app: FastAPI, port: int, *, no_browser: bool) -> None:
        url = f"http://127.0.0.1:{port}"
        if not no_browser:
            browser = self._browser or webbrowser.open
            browser(url)
        if self._server is None:
            uvicorn.run(app, host="127.0.0.1", port=port)
        else:
            self._server(app, host="127.0.0.1", port=port)


class ServeCommand:
    def __init__(
        self,
        *,
        server_runner: ServerRunner | None = None,
        database_factory: DatabaseFactory = Database,
        lock_factory: LockFactory = ProjectLock,
    ) -> None:
        self._server_runner = server_runner or ServerRunner()
        self._database_factory = database_factory
        self._lock_factory = lock_factory

    def execute(
        self,
        config: ResolvedTaskConfig,
        project_dir: Path,
        database_path: Path | None,
        requested_port: int,
        no_browser: bool,
        assume_yes: bool,
    ) -> None:
        path = database_path or default_db_path(project_dir)
        with self._database_factory(path) as database:
            port = self._server_runner.pick_port(requested_port)
            with self._lock_factory(project_dir, port):
                summary = _import_service(database).import_file(
                    config.data_path,
                    on_conflict="fail",
                )
                print_import_summary(config.data_path, summary)
                database.tasks.open(config, assume_yes=assume_yes)
                queue = database.tasks.build_queue(config.name)
                app = create_app(database, config, queue)
                typer.echo(
                    f"tracelabel · task '{config.name}' ({config.level}-level) · "
                    f"http://127.0.0.1:{port}"
                )
                self._server_runner.run(app, port, no_browser=no_browser)


class ImportCommand:
    def execute(
        self,
        path: Path,
        *,
        database_path: Path | None,
        from_: str,
        on_conflict: ConflictPolicy,
        skip_invalid: bool,
        as_documents: bool,
    ) -> ImportSummary:
        db_path = database_path or default_db_path(path.parent)
        with Database(db_path) as database:
            summary = _import_service(database).import_file(
                path,
                from_=from_,
                on_conflict=on_conflict,
                skip_invalid=skip_invalid,
                as_documents=as_documents,
            )
        print_import_summary(path, summary)
        return summary


class ExportCommand:
    def execute(
        self,
        *,
        task: str | None,
        database_path: Path | None,
        format: ExportFormat,
        joined: bool,
        out: Path | None,
        status: ExportStatus,
    ) -> int:
        path = database_path or default_db_path(Path.cwd())
        with Database(path) as database:
            task_name = self._resolve_task(database, task)
            service = ExportService(database.tasks, database.annotations, database.traces)
            return service.export(task_name, format, joined, out, status)

    @staticmethod
    def _resolve_task(database: Database, task: str | None) -> str:
        if task is not None:
            return task
        names = [str(item["name"]) for item in database.tasks.list_summaries()]
        if len(names) == 1:
            return names[0]
        listed = ", ".join(names) or "(none)"
        raise UserError(f"--task is required; existing tasks: {listed}")


class TasksListCommand:
    def execute(self, database_path: Path | None) -> None:
        path = database_path or default_db_path(Path.cwd())
        with Database(path) as database:
            print_tasks_table(database.tasks.list_summaries())


class SuggestCommand:
    def execute(
        self,
        config: ResolvedTaskConfig,
        project_dir: Path,
        database_path: Path | None,
        *,
        limit: int | None,
        overwrite: bool,
        concurrency: int,
    ) -> SuggestionSummary:
        client = LiteLLMClient()
        path = database_path or default_db_path(project_dir)
        with Database(path) as database:
            service = SuggestionService(
                config,
                database.traces,
                database.annotations,
                client,
            )
            return service.run(limit=limit, overwrite=overwrite, concurrency=concurrency)


class DemoCommand:
    def execute(self, port: int, no_browser: bool) -> None:
        source = resources.files("tracelabel.demo_data") / "traces.jsonl"
        project_dir = Path(tempfile.mkdtemp(prefix="tracelabel-demo-"))
        data = project_dir / "traces.jsonl"
        data.write_bytes(source.read_bytes())
        config = ConfigResolver().resolve(raw_config_for_target(data), CliArgs())
        ServeCommand().execute(
            config,
            project_dir,
            None,
            port,
            no_browser,
            assume_yes=True,
        )


def _import_service(database: Database) -> ImportService:
    return ImportService(AdapterRegistry.default(), CtfValidator(), database.traces)
