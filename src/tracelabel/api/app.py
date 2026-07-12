from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from tracelabel.config.models import ResolvedTaskConfig
from tracelabel.db.database import Database
from tracelabel.errors import NotFoundError, UserError

from .labeling import LabelingService
from .routes import create_api_router
from .static import configure_static, default_static_dir


def create_app(
    database: Database,
    config: ResolvedTaskConfig,
    queue: list[str],
    static_dir: Path | None = None,
) -> FastAPI:
    service = LabelingService(
        config,
        queue,
        database.traces,
        database.tasks,
        database.annotations,
    )
    app = FastAPI()

    @app.exception_handler(NotFoundError)
    async def not_found(_request: Request, error: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(error)})

    @app.exception_handler(UserError)
    async def user_error(_request: Request, error: UserError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(error)})

    app.include_router(create_api_router(service))
    configure_static(app, static_dir or default_static_dir())
    return app
