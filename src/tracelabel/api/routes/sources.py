"""GET /api/projects/{project}/sources."""

from fastapi import APIRouter, Depends

from tracelabel.api.deps import get_project_database
from tracelabel.api.models import SourceOut
from tracelabel.db.database import Database

router = APIRouter(prefix="/api/projects/{project}/sources", tags=["sources"])


@router.get("", response_model=list[SourceOut])
async def list_sources(
    project: str,
    database: Database = Depends(get_project_database),  # noqa: B008 - FastAPI's DI idiom
) -> list[SourceOut]:
    return [
        SourceOut(
            id=row["id"],
            name=row["name"],
            path=row["path"],
            adapter=row["adapter"],
            imported_at=row["imported_at"],
            trace_count=row["trace_count"],
        )
        for row in database.sources.list_all()
    ]
