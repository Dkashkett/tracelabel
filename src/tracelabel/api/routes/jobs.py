"""GET /api/jobs/{job_id} — poll a background job started by an import or suggestion
run (see tracelabel/jobs.py).

``app.state`` has no ``jobs`` attribute wired up by ``create_app`` (see api/app.py) —
that file is frozen and owned elsewhere, so this module lazily creates and caches a
single ``JobRunner`` on ``request.app.state.jobs`` the first time any route in this
process needs one. Every route that submits or polls a job goes through
``get_job_runner()`` below, so they all share the same instance for the life of the
process. A later integration pass should move this into ``create_app`` directly.
"""

from fastapi import APIRouter, Depends, Request

from tracelabel.api.models import JobStatus
from tracelabel.errors import NotFoundError
from tracelabel.jobs import JobRunner

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def get_job_runner(request: Request) -> JobRunner:
    """The process-wide JobRunner, created on first use and cached on app.state.

    ``api/app.py`` doesn't construct one (see module docstring above), so this is the
    one place that does — every route that needs a JobRunner (here and in
    routes/imports.py) calls this instead of constructing its own.
    """
    if not hasattr(request.app.state, "jobs"):
        request.app.state.jobs = JobRunner()
    runner: JobRunner = request.app.state.jobs
    return runner


@router.get("/{job_id}", response_model=JobStatus)
async def get_job(
    job_id: str,
    job_runner: JobRunner = Depends(get_job_runner),  # noqa: B008 - FastAPI's DI idiom
) -> JobStatus:
    snapshot = job_runner.status(job_id)
    if snapshot is None:
        raise NotFoundError(f"unknown job '{job_id}'")
    return JobStatus(
        job_id=snapshot.id,
        state=snapshot.state,
        progress=snapshot.progress,
        result=snapshot.result,
        error=snapshot.error,
    )
