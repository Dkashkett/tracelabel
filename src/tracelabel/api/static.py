from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope


class ImmutableStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def default_static_dir() -> Path:
    return Path(__file__).parent.parent / "static"


def configure_static(app: FastAPI, static_dir: Path) -> None:
    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", ImmutableStaticFiles(directory=assets_dir), name="assets")

    async def spa(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="not found")
        index = static_dir / "index.html"
        if not index.is_file():
            raise HTTPException(
                status_code=503,
                detail="frontend not built — run `npm run build` in frontend/ "
                "or use the Vite dev server",
            )
        return FileResponse(index)

    app.add_api_route("/{full_path:path}", spa, methods=["GET"])
