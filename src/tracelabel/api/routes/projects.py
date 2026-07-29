"""GET/POST /api/projects, GET/DELETE /api/projects/{project}."""

from fastapi import APIRouter, Depends, Response

from tracelabel.api.deps import get_workspace
from tracelabel.api.models import (
    ProjectCreate,
    ProjectDetail,
    ProjectSummary,
    SourceOut,
    TaskSummary,
)
from tracelabel.db.database import Database
from tracelabel.errors import NotFoundError
from tracelabel.workspace.models import ProjectRecord
from tracelabel.workspace.workspace import Workspace

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _task_summaries(database: Database) -> list[TaskSummary]:
    """Task summaries for a project, including ``compat_hash``.

    ``TaskRepository.list_summaries()`` doesn't include ``compat_hash`` (that
    repository is owned elsewhere), so it's read off each task's full row here
    instead of touching ``db/tasks.py``.
    """
    summaries = []
    for summary in database.tasks.list_summaries():
        row = database.tasks.get(summary["name"])
        assert row is not None  # just listed, in the same connection
        summaries.append(
            TaskSummary(
                name=summary["name"],
                level=summary["level"],
                schema_hash=summary["schema_hash"],
                compat_hash=row["compat_hash"],
                updated_at=summary["updated_at"],
                total=summary["total"],
                addressed=summary["addressed"],
                queue_scope=summary["queue_scope"],
            )
        )
    return summaries


def _source_summaries(database: Database) -> list[SourceOut]:
    return [
        SourceOut(
            id=row["id"],
            name=row["name"],
            path=row["path"],
            adapter=row["adapter"],
            imported_at=row["imported_at"],
            trace_count=row["trace_count"],
        )
        for row in database.sources.list_all()
    ]


def _summarize(record: ProjectRecord, workspace: Workspace) -> ProjectSummary:
    database = workspace.open_database(record.slug)
    return ProjectSummary(
        slug=record.slug,
        name=record.name,
        created_at=record.created_at,
        task_count=len(database.tasks.list_summaries()),
        source_count=len(database.sources.list_all()),
    )


@router.get("", response_model=list[ProjectSummary])
async def list_projects(
    workspace: Workspace = Depends(get_workspace),  # noqa: B008 - FastAPI's DI idiom
) -> list[ProjectSummary]:
    return [_summarize(record, workspace) for record in workspace.list_projects()]


@router.post("", response_model=ProjectSummary)
async def create_project(
    body: ProjectCreate,
    workspace: Workspace = Depends(get_workspace),  # noqa: B008 - FastAPI's DI idiom
) -> ProjectSummary:
    record = workspace.create_project(body.name, notes=body.notes)
    return ProjectSummary(
        slug=record.slug,
        name=record.name,
        created_at=record.created_at,
        task_count=0,
        source_count=0,
    )


@router.get("/{project}", response_model=ProjectDetail)
async def get_project(
    project: str,
    workspace: Workspace = Depends(get_workspace),  # noqa: B008 - FastAPI's DI idiom
) -> ProjectDetail:
    record = workspace.get_project(project)
    if record is None:
        raise NotFoundError(f"unknown project '{project}'")
    database = workspace.open_database(record.slug)
    return ProjectDetail(
        slug=record.slug,
        name=record.name,
        created_at=record.created_at,
        notes=record.notes,
        tasks=_task_summaries(database),
        sources=_source_summaries(database),
    )


@router.delete("/{project}", status_code=204)
async def delete_project(
    project: str,
    workspace: Workspace = Depends(get_workspace),  # noqa: B008 - FastAPI's DI idiom
) -> Response:
    workspace.delete_project(project)
    return Response(status_code=204)
