import socket
import tempfile
import webbrowser
from collections.abc import Callable
from contextlib import AbstractContextManager
from importlib import resources
from pathlib import Path
from typing import Any

import typer
import uvicorn
from fastapi import FastAPI

from tracelabel.api.app import create_app
from tracelabel.config.models import TaskSpec
from tracelabel.config.resolver import default_task_name, os_username
from tracelabel.ctf.validation import CtfValidator
from tracelabel.db.annotations import ExportStatus
from tracelabel.db.database import Database
from tracelabel.db.traces import ConflictPolicy
from tracelabel.errors import EnvError, UserError
from tracelabel.exporting.service import ExportFormat, ExportService
from tracelabel.imports.adapters.base import AdapterRegistry
from tracelabel.imports.service import ImportService, ImportSummary
from tracelabel.suggestions.client import LiteLLMClient
from tracelabel.suggestions.service import SuggestionService, SuggestionSummary
from tracelabel.workspace.models import ProjectRecord
from tracelabel.workspace.workspace import Workspace, WorkspaceLock, slugify

from .output import print_import_summary

PortProbe = Callable[[str, int], bool]
ServerCallable = Callable[..., None]
BrowserCallable = Callable[[str], Any]
WorkspaceFactory = Callable[[Path], Workspace]
LockFactory = Callable[[Path, int], AbstractContextManager[WorkspaceLock]]
ImportServiceFactory = Callable[[Database], ImportService]


def port_is_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as candidate:
        try:
            candidate.bind((host, port))
        except OSError:
            return False
    return True


def pick_port(requested: int = 8377, probe: PortProbe | None = None) -> int:
    return ServerRunner(port_probe=probe).pick_port(requested)


def default_import_service(database: Database) -> ImportService:
    """The real collaborators for a from-scratch ``ImportService``.

    Every command that imports data shares this construction — it wires the default
    adapter registry, a CTF validator, and the database's own trace/source
    repositories.
    """
    return ImportService(
        AdapterRegistry.default(),
        CtfValidator(),
        database.traces,
        database.sources,
    )


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

    def run(self, app: FastAPI, port: int, *, no_browser: bool, path: str = "/") -> None:
        url = f"http://127.0.0.1:{port}{path}"
        if not no_browser:
            browser = self._browser or webbrowser.open
            browser(url)
        if self._server is None:
            uvicorn.run(app, host="127.0.0.1", port=port)
        else:
            self._server(app, host="127.0.0.1", port=port)


_DEFAULT_TASK_FIELDS: list[dict[str, Any]] = [
    {
        "name": "verdict",
        "label": "Verdict",
        "type": "single_select",
        "options": ["pass", "fail"],
        "required": True,
    },
    {
        "name": "reasoning",
        "label": "Reasoning",
        "type": "text",
        "placeholder": "Why is this a pass or fail?",
        "required": True,
    },
]


class AppCommand:
    """The launcher: `tracelabel [TARGET]`.

    With no target, this just opens the browser onto the project list for the whole
    workspace. With a target (a file or a directory of documents), it finds-or-creates
    a project and a task for that target, imports it, and opens straight into the
    labeling view — this is what the old `serve` command did for a flat per-directory
    database, now expressed against the workspace/project/task model.

    Project/task idempotency: re-running against the same target must NOT create a
    second project or task (the "still lands directly in the labeling view" regression
    depends on that). The project slug is derived from the target's name and reused via
    `Workspace.get_project`; the task name is derived from the target via the same
    `default_task_name` helper the old YAML-driven `ConfigResolver` used, and reused via
    `TaskRepository.get`.
    """

    def __init__(
        self,
        *,
        server_runner: ServerRunner | None = None,
        workspace_factory: WorkspaceFactory = Workspace,
        lock_factory: LockFactory = WorkspaceLock,
        import_service_factory: ImportServiceFactory = default_import_service,
        username_provider: Callable[[], str] = os_username,
    ) -> None:
        self._server_runner = server_runner or ServerRunner()
        self._workspace_factory = workspace_factory
        self._lock_factory = lock_factory
        self._import_service_factory = import_service_factory
        self._username_provider = username_provider

    def execute(
        self,
        workspace_root: Path,
        target: Path | None,
        requested_port: int,
        no_browser: bool,
    ) -> None:
        workspace = self._workspace_factory(workspace_root)
        port = self._server_runner.pick_port(requested_port)
        with self._lock_factory(workspace_root, port):
            app = create_app(workspace)
            if target is None:
                self._server_runner.run(app, port, no_browser=no_browser, path="/")
                return
            project = self._find_or_create_project(workspace, target)
            task_name = self._import_and_open_task(workspace, project, target)
            typer.echo(
                f"tracelabel · project '{project.slug}' · task '{task_name}' · "
                f"http://127.0.0.1:{port}"
            )
            self._server_runner.run(
                app,
                port,
                no_browser=no_browser,
                path=f"/p/{project.slug}/t/{task_name}/label",
            )

    @staticmethod
    def _find_or_create_project(workspace: Workspace, target: Path) -> ProjectRecord:
        name = target.stem if target.is_file() else target.name
        slug = slugify(name)
        existing = workspace.get_project(slug)
        if existing is not None:
            return existing
        return workspace.create_project(name)

    def _import_and_open_task(
        self, workspace: Workspace, project: ProjectRecord, target: Path
    ) -> str:
        task_name = default_task_name(target)
        with workspace.open_database(project.slug) as database:
            existing_task = database.tasks.get(task_name)
            if existing_task is None:
                summary = self._import_service_factory(database).import_source(
                    path=str(target), on_conflict="fail"
                )
                print_import_summary(target, summary)
                database.tasks.create(
                    TaskSpec(
                        name=task_name,
                        level="trace",
                        fields=list(_DEFAULT_TASK_FIELDS),
                        label_roles=["assistant"],
                        shuffle=False,
                        annotator=self._username_provider(),
                    )
                )
        return task_name


class DemoCommand:
    """`tracelabel demo`: launch against the bundled demo traces.

    Reuses the same idempotent find-or-create logic as `AppCommand` by delegating to
    it with the demo file as TARGET, inside a project derived from "demo". Runs against
    the user's normal workspace (not a fresh temp dir every time) so a second
    `tracelabel demo` reopens the same demo project instead of piling up duplicates —
    consistent with the idempotency `AppCommand` already gives every other target. The
    demo *data file* still gets copied to a fresh temp path each run (matching the old
    behavior of always seeding from the bundled fixture), but the *project* it lands in
    is the same one every time because `AppCommand` derives the project slug from the
    target's name ("demo"), not its path.
    """

    def __init__(self, *, app_command: AppCommand | None = None) -> None:
        self._app_command = app_command or AppCommand()

    def execute(self, workspace_root: Path, port: int, no_browser: bool) -> None:
        source = resources.files("tracelabel.demo_data") / "traces.jsonl"
        demo_dir = Path(tempfile.mkdtemp(prefix="tracelabel-demo-"))
        target = demo_dir / "demo.jsonl"
        target.write_bytes(source.read_bytes())
        self._app_command.execute(workspace_root, target, port, no_browser)


class ImportCommand:
    """`tracelabel import FILE --project NAME`.

    Unlike the launcher, this is an automation primitive: `--project` must already
    exist. Auto-creating a project here would make typos silently succeed against the
    wrong project, which is exactly the kind of surprise a scriptable command should
    not have.
    """

    def __init__(
        self,
        *,
        workspace_factory: WorkspaceFactory = Workspace,
        import_service_factory: ImportServiceFactory = default_import_service,
    ) -> None:
        self._workspace_factory = workspace_factory
        self._import_service_factory = import_service_factory

    def execute(
        self,
        workspace_root: Path,
        project: str,
        path: Path,
        *,
        from_: str,
        on_conflict: ConflictPolicy,
        skip_invalid: bool,
        as_documents: bool,
    ) -> ImportSummary:
        workspace = self._workspace_factory(workspace_root)
        if workspace.get_project(project) is None:
            raise UserError(
                f"unknown project '{project}'. Create it first in the browser UI, "
                "then re-run this import."
            )
        with workspace.open_database(project) as database:
            summary = self._import_service_factory(database).import_source(
                path=str(path),
                from_=from_,
                on_conflict=on_conflict,
                skip_invalid=skip_invalid,
                as_documents=as_documents,
            )
        print_import_summary(path, summary)
        return summary


class ExportCommand:
    def __init__(self, *, workspace_factory: WorkspaceFactory = Workspace) -> None:
        self._workspace_factory = workspace_factory

    def execute(
        self,
        workspace_root: Path,
        project: str | None,
        *,
        task: str | None,
        format: ExportFormat,
        joined: bool,
        out: Path | None,
        status: ExportStatus,
    ) -> int:
        workspace = self._workspace_factory(workspace_root)
        project_slug = self._resolve_project(workspace, project)
        with workspace.open_database(project_slug) as database:
            task_name = self._resolve_task(database, task)
            service = ExportService(database.tasks, database.annotations, database.traces)
            return service.export(task_name, format, joined, out, status)

    @staticmethod
    def _resolve_project(workspace: Workspace, project: str | None) -> str:
        if project is not None:
            return project
        slugs = [record.slug for record in workspace.list_projects()]
        if len(slugs) == 1:
            return slugs[0]
        listed = ", ".join(slugs) or "(none)"
        raise UserError(f"--project is required; existing projects: {listed}")

    @staticmethod
    def _resolve_task(database: Database, task: str | None) -> str:
        if task is not None:
            return task
        names = [str(item["name"]) for item in database.tasks.list_summaries()]
        if len(names) == 1:
            return names[0]
        listed = ", ".join(names) or "(none)"
        raise UserError(f"--task is required; existing tasks: {listed}")


class SuggestCommand:
    def __init__(
        self,
        *,
        workspace_factory: WorkspaceFactory = Workspace,
        client_factory: Callable[[], LiteLLMClient] = LiteLLMClient,
    ) -> None:
        self._workspace_factory = workspace_factory
        self._client_factory = client_factory

    def execute(
        self,
        workspace_root: Path,
        project: str,
        task: str,
        *,
        limit: int | None,
        overwrite: bool,
        concurrency: int,
    ) -> SuggestionSummary:
        workspace = self._workspace_factory(workspace_root)
        with workspace.open_database(project) as database:
            resolved = database.tasks.resolve(task)
            service = SuggestionService(
                resolved,
                database.traces,
                database.annotations,
                self._client_factory(),
            )
            return service.run(limit=limit, overwrite=overwrite, concurrency=concurrency)
