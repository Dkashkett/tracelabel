"""POST /api/projects/{project}/imports/preview, POST .../imports.

Builds the same ``ImportService`` the CLI's ``ImportCommand`` uses (see
``cli/commands.py``'s ``_import_service`` helper) and either runs it inline
(preview — read-only, cheap enough to await directly) or hands it to the shared
``JobRunner`` as a background job (a real import can be slow for a large file — see
``tracelabel/jobs.py`` and the risk it calls out).
"""

from fastapi import APIRouter, Depends, Request

from tracelabel.api.deps import get_project_database
from tracelabel.api.models import ImportIn, ImportPreview, ImportPreviewIn, JobRef
from tracelabel.ctf.validation import CtfValidator
from tracelabel.db.database import Database
from tracelabel.imports.adapters.base import AdapterRegistry
from tracelabel.imports.service import ImportService

from .jobs import get_job_runner

router = APIRouter(prefix="/api/projects/{project}/imports", tags=["imports"])


def _import_service(database: Database, *, with_sources: bool) -> ImportService:
    """Build an ImportService the same way cli/commands.py's ``_import_service`` does.

    Note: ``ImportPreviewIn``/``ImportIn`` both carry an ``include_all_spans`` field,
    but neither ``ImportService.preview()`` nor ``import_source()`` accept it as a
    call argument — only ``AdapterRegistry.default(include_all_spans=...)`` does, as a
    constructor-time flag. Since the request body's flag has nowhere to flow into a
    per-call service method, we build the registry with the CLI's default
    (``include_all_spans=False``) rather than inventing new plumbing for a field that
    may be a Phase-2 option the service layer doesn't consume yet.
    """
    return ImportService(
        AdapterRegistry.default(),
        CtfValidator(),
        database.traces,
        database.sources if with_sources else None,
    )


@router.post("/preview", response_model=ImportPreview)
async def preview_import(
    project: str,
    body: ImportPreviewIn,
    database: Database = Depends(get_project_database),  # noqa: B008 - FastAPI's DI idiom
) -> ImportPreview:
    service = _import_service(database, with_sources=False)
    return service.preview(
        path=body.path,
        content=body.content,
        from_=body.from_,
        as_documents=body.as_documents,
    )


@router.post("", response_model=JobRef)
async def start_import(
    project: str,
    body: ImportIn,
    request: Request,
    database: Database = Depends(get_project_database),  # noqa: B008 - FastAPI's DI idiom
) -> JobRef:
    service = _import_service(database, with_sources=True)
    job_runner = get_job_runner(request)
    job_id = job_runner.submit(
        lambda job: service.import_source(
            path=body.path,
            content=body.content,
            name=body.name,
            from_=body.from_,
            on_conflict=body.on_conflict,
            skip_invalid=body.skip_invalid,
            as_documents=body.as_documents,
        )
    )
    return JobRef(job_id=job_id)
