"""The labeling view's routes, rehomed under /api/projects/{project}/tasks/{task}/...

Each handler is a thin wrapper over ``LabelingService`` (``api/labeling.py``), reached
via the ``TaskContext`` dependency (``api/deps.py``), which resolves the (project,
task) named in the URL path for this request.

``GET .../items`` (Phase 2, data manager) and ``GET .../stats`` (Phase 3, eval loop)
are intentionally left as 501 stubs — out of scope for this wave, per
docs/refactor-plan.md §3.
"""

from fastapi import APIRouter, Depends, HTTPException

from tracelabel.api.deps import TaskContext, get_task_context
from tracelabel.api.models import (
    AnnotationIn,
    AnnotationOut,
    ItemPage,
    Progress,
    QueueEntry,
    SessionInfo,
    TaskStats,
    TraceDetail,
)

router = APIRouter(prefix="/api/projects/{project}/tasks/{task}", tags=["labeling"])


@router.get("/session", response_model=SessionInfo)
async def get_session(
    context: TaskContext = Depends(get_task_context),  # noqa: B008 - FastAPI's DI idiom
) -> SessionInfo:
    return context.labeling_service.session()


@router.get("/queue", response_model=list[QueueEntry])
async def get_queue(
    context: TaskContext = Depends(get_task_context),  # noqa: B008 - FastAPI's DI idiom
) -> list[QueueEntry]:
    return context.labeling_service.queue()


@router.get("/traces/{trace_id}", response_model=TraceDetail)
async def get_trace(
    trace_id: str,
    context: TaskContext = Depends(get_task_context),  # noqa: B008 - FastAPI's DI idiom
) -> TraceDetail:
    return context.labeling_service.trace_detail(trace_id)


@router.put("/annotations", response_model=AnnotationOut)
async def put_annotation(
    annotation: AnnotationIn,
    context: TaskContext = Depends(get_task_context),  # noqa: B008 - FastAPI's DI idiom
) -> AnnotationOut:
    return context.labeling_service.put_annotation(annotation)


@router.get("/progress", response_model=Progress)
async def get_progress(
    context: TaskContext = Depends(get_task_context),  # noqa: B008 - FastAPI's DI idiom
) -> Progress:
    return context.labeling_service.progress()


@router.get("/items", response_model=ItemPage)
async def get_items(project: str, task: str) -> ItemPage:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.get("/stats", response_model=TaskStats)
async def get_stats(project: str, task: str) -> TaskStats:
    raise HTTPException(status_code=501, detail="not implemented yet")
