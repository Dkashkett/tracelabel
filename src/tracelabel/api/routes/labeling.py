"""The labeling view's routes plus the Phase 2/3 data views, all rehomed under
/api/projects/{project}/tasks/{task}/...

Stub for Wave 0 (owned by W2-LABELING) — every handler below returns 501. The five
existing labeling models (SessionInfo, QueueEntry, TraceDetail, AnnotationIn/Out,
Progress) keep their field lists; only the path changes, from the old flat
/api/session etc.
"""

from fastapi import APIRouter, HTTPException

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
async def get_session(project: str, task: str) -> SessionInfo:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.get("/queue", response_model=list[QueueEntry])
async def get_queue(project: str, task: str) -> list[QueueEntry]:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.get("/traces/{trace_id}", response_model=TraceDetail)
async def get_trace(project: str, task: str, trace_id: str) -> TraceDetail:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.put("/annotations", response_model=AnnotationOut)
async def put_annotation(project: str, task: str, annotation: AnnotationIn) -> AnnotationOut:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.get("/progress", response_model=Progress)
async def get_progress(project: str, task: str) -> Progress:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.get("/items", response_model=ItemPage)
async def get_items(project: str, task: str) -> ItemPage:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.get("/stats", response_model=TaskStats)
async def get_stats(project: str, task: str) -> TaskStats:
    raise HTTPException(status_code=501, detail="not implemented yet")
