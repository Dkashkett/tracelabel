"""GET /api/projects/{project}/tasks/{task}/export — a thin wrapper over the
unchanged ExportService (exporting/service.py), streaming a file.

Stub for Wave 0 (owned by W2-EXPORT) — returns 501.
"""

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/projects/{project}/tasks/{task}", tags=["exports"])


@router.get("/export")
async def export_task(project: str, task: str) -> None:
    raise HTTPException(status_code=501, detail="not implemented yet")
