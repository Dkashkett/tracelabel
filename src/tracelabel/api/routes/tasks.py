"""Task and rubric routes, all under /api/projects/{project}/tasks.

Stub for Wave 0 (owned by W2-TASKS) — every handler below returns 501. The schema
PATCH endpoint's real implementation additionally returns 409 with a SchemaImpactOut
body when a breaking change isn't confirmed (``?confirm=true``); that logic lands
with W2-TASKS, once W1-IMPACT has implemented SchemaImpactAnalyzer.
"""

from fastapi import APIRouter, HTTPException

from tracelabel.api.models import (
    JobRef,
    SchemaOut,
    SchemaPatch,
    SuggestIn,
    TaskCreate,
    TaskDetail,
    TaskPatch,
    TaskSummary,
)

router = APIRouter(prefix="/api/projects/{project}/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskSummary])
async def list_tasks(project: str) -> list[TaskSummary]:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.post("", response_model=TaskDetail)
async def create_task(project: str, body: TaskCreate) -> TaskDetail:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.get("/{task}", response_model=TaskDetail)
async def get_task(project: str, task: str) -> TaskDetail:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.patch("/{task}", response_model=TaskDetail)
async def patch_task(project: str, task: str, body: TaskPatch) -> TaskDetail:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.get("/{task}/schema", response_model=SchemaOut)
async def get_schema(project: str, task: str) -> SchemaOut:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.patch("/{task}/schema", response_model=SchemaOut)
async def patch_schema(
    project: str, task: str, body: SchemaPatch, confirm: bool = False
) -> SchemaOut:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.post("/{task}/suggestions", response_model=JobRef)
async def start_suggestions(project: str, task: str, body: SuggestIn) -> JobRef:
    raise HTTPException(status_code=501, detail="not implemented yet")
