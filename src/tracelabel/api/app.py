from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from tracelabel.errors import NotFoundError, UserError
from tracelabel.workspace.workspace import Workspace

from .routes.exports import router as exports_router
from .routes.imports import router as imports_router
from .routes.jobs import router as jobs_router
from .routes.labeling import router as labeling_router
from .routes.projects import router as projects_router
from .routes.settings import router as settings_router
from .routes.sources import router as sources_router
from .routes.tasks import router as tasks_router
from .static import configure_static, default_static_dir


def create_app(workspace: Workspace, static_dir: Path | None = None) -> FastAPI:
    """Build the FastAPI app for one workspace.

    Every route resolves its own (project, task) from the request path via
    api/deps.py, so one server process can serve any number of projects — unlike the
    old ``create_app(database, config, queue)``, which froze a single (project, task)
    for the whole process lifetime.
    """
    app = FastAPI()
    app.state.workspace = workspace

    @app.exception_handler(NotFoundError)
    async def not_found(_request: Request, error: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(error)})

    @app.exception_handler(UserError)
    async def user_error(_request: Request, error: UserError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(error)})

    for router in (
        settings_router,
        projects_router,
        sources_router,
        imports_router,
        tasks_router,
        labeling_router,
        exports_router,
        jobs_router,
    ):
        app.include_router(router)

    configure_static(app, static_dir or default_static_dir())
    return app
