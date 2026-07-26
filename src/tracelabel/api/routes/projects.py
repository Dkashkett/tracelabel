"""GET/POST /api/projects, GET/DELETE /api/projects/{project}.

Stub for Wave 0 (owned by W2-PROJECTS in Wave 2) — every handler below returns 501.
"""

from fastapi import APIRouter, HTTPException, Response

from tracelabel.api.models import ProjectCreate, ProjectDetail, ProjectSummary

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectSummary])
async def list_projects() -> list[ProjectSummary]:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.post("", response_model=ProjectSummary)
async def create_project(body: ProjectCreate) -> ProjectSummary:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.get("/{project}", response_model=ProjectDetail)
async def get_project(project: str) -> ProjectDetail:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.delete("/{project}", status_code=204)
async def delete_project(project: str) -> Response:
    raise HTTPException(status_code=501, detail="not implemented yet")
