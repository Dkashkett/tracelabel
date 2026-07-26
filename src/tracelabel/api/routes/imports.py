"""POST /api/projects/{project}/imports/preview, POST .../imports.

Stub for Wave 0 (owned by W2-IMPORTS) — every handler below returns 501.
"""

from fastapi import APIRouter, HTTPException

from tracelabel.api.models import ImportIn, ImportPreview, ImportPreviewIn, JobRef

router = APIRouter(prefix="/api/projects/{project}/imports", tags=["imports"])


@router.post("/preview", response_model=ImportPreview)
async def preview_import(project: str, body: ImportPreviewIn) -> ImportPreview:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.post("", response_model=JobRef)
async def start_import(project: str, body: ImportIn) -> JobRef:
    raise HTTPException(status_code=501, detail="not implemented yet")
