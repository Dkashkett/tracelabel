"""GET /api/jobs/{job_id} — poll a background job started by an import or suggestion
run (see tracelabel/jobs.py).

Stub for Wave 0 — returns 501. A later packet wires this to
``request.app.state.jobs.status(job_id)``.
"""

from fastapi import APIRouter, HTTPException

from tracelabel.api.models import JobStatus

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobStatus)
async def get_job(job_id: str) -> JobStatus:
    raise HTTPException(status_code=501, detail="not implemented yet")
