"""GET /api/projects/{project}/sources.

Stub for Wave 0 (owned by W1-SOURCES / a Wave 2 route packet) — returns 501.
"""

from fastapi import APIRouter, HTTPException

from tracelabel.api.models import SourceOut

router = APIRouter(prefix="/api/projects/{project}/sources", tags=["sources"])


@router.get("", response_model=list[SourceOut])
async def list_sources(project: str) -> list[SourceOut]:
    raise HTTPException(status_code=501, detail="not implemented yet")
