from fastapi import APIRouter

from .labeling import LabelingService
from .models import (
    AnnotationIn,
    AnnotationOut,
    Progress,
    QueueEntry,
    SessionInfo,
    TraceDetail,
)


def create_api_router(service: LabelingService) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/session", response_model=SessionInfo)
    async def get_session() -> SessionInfo:
        return service.session()

    @router.get("/queue", response_model=list[QueueEntry])
    async def get_queue() -> list[QueueEntry]:
        return service.queue()

    @router.get("/traces/{trace_id}", response_model=TraceDetail)
    async def get_trace(trace_id: str) -> TraceDetail:
        return service.trace_detail(trace_id)

    @router.put("/annotations", response_model=AnnotationOut)
    async def put_annotation(annotation: AnnotationIn) -> AnnotationOut:
        return service.put_annotation(annotation)

    @router.get("/progress", response_model=Progress)
    async def get_progress() -> Progress:
        return service.progress()

    return router
