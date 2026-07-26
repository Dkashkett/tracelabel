"""FastAPI dependency functions and the per-request TaskContext.

Replaces the old model where ``create_app(database, config, queue)`` froze a single
(project, task) for the whole process lifetime. Now one server serves any number of
projects/tasks, and each request resolves its own (project, task) from the URL path
via these dependencies.
"""

from functools import cached_property
from typing import Any, cast

from fastapi import Depends, Request

from tracelabel.config.models import ResolvedTaskConfig
from tracelabel.db.database import Database, decode_json
from tracelabel.errors import NotFoundError
from tracelabel.workspace.workspace import Workspace

from .labeling import LabelingService


def get_workspace(request: Request) -> Workspace:
    """The Workspace instance create_app() stashes on app.state."""
    return cast(Workspace, request.app.state.workspace)


def get_project_database(
    project: str,
    workspace: Workspace = Depends(get_workspace),  # noqa: B008 - FastAPI's DI idiom
) -> Database:
    record = workspace.get_project(project)
    if record is None:
        raise NotFoundError(f"unknown project '{project}'")
    return workspace.open_database(record.slug)


def resolve_task_config(database: Database, task_name: str) -> ResolvedTaskConfig:
    """Build a ``ResolvedTaskConfig`` straight from a ``tasks`` row.

    Reads columns directly rather than calling a ``TaskRepository.resolve()`` helper,
    because that helper is added by a later packet (W1-TASKS) — this is what makes
    ``api/deps.py`` usable before that lands. W1-TASKS may replace this body with a
    call to that helper once it exists; the signature should not need to change.
    """
    row = database.tasks.get(task_name)
    if row is None:
        raise NotFoundError(f"unknown task '{task_name}'")
    fields = cast(list[dict[str, Any]], decode_json(row["resolved_schema"]))
    label_roles = cast(list[str], decode_json(row["label_roles"]))
    return ResolvedTaskConfig(
        name=row["name"],
        level=row["level"],
        fields=fields,
        label_roles=label_roles,
        shuffle=row["shuffle_seed"] is not None,
        annotator=row["annotator"] or "annotator",
        schema_hash=row["schema_hash"],
        llm=None,
        suggest_instructions=row["suggest_instructions"],
        review_of=row["review_of"],
        review_labels_from=row["review_labels_from"] or "judge",
    )


class TaskContext:
    """Everything one request needs for one (project, task): the shared Database, the
    resolved task config, and a LabelingService built from them.

    Cheap to construct — the constructor only stores references. The queue is a
    ``functools.cached_property``, built once per request and reused by every call on
    this context within that request, so ``PUT /annotations`` (which fires on every
    commit) never rebuilds it.
    """

    def __init__(self, database: Database, config: ResolvedTaskConfig) -> None:
        self.database = database
        self.config = config

    @cached_property
    def queue(self) -> list[str]:
        return self.database.tasks.build_queue(self.config.name)

    @cached_property
    def labeling_service(self) -> LabelingService:
        return LabelingService(
            self.config,
            self.queue,
            self.database.traces,
            self.database.tasks,
            self.database.annotations,
        )


def get_task_context(
    task: str,
    database: Database = Depends(get_project_database),  # noqa: B008 - FastAPI's DI idiom
) -> TaskContext:
    config = resolve_task_config(database, task)
    return TaskContext(database, config)
