"""GET /api/projects/{project}/tasks/{task}/export — a thin wrapper over the
unchanged ExportService (exporting/service.py), streaming a file.

ExportService is CLI-oriented: it writes rows to a real file path, or to
``self._stdout`` when told the destination is stdout (``out=Path("-")``). We reuse
it unmodified by handing it an in-memory ``io.StringIO`` as its ``stdout`` and then
returning that buffer's contents as the HTTP response body — no changes to
ExportService are needed.
"""

import io
from pathlib import Path

from fastapi import APIRouter, Depends, Response

from tracelabel.api.deps import get_project_database
from tracelabel.db.annotations import ExportStatus
from tracelabel.db.database import Database
from tracelabel.exporting.service import ExportFormat, ExportService

router = APIRouter(prefix="/api/projects/{project}/tasks/{task}", tags=["exports"])

_MEDIA_TYPES: dict[ExportFormat, str] = {
    "jsonl": "application/x-ndjson",
    "csv": "text/csv",
}


@router.get("/export")
async def export_task(
    project: str,
    task: str,
    format: ExportFormat = "jsonl",
    joined: bool = False,
    status: ExportStatus = "all",
    database: Database = Depends(get_project_database),  # noqa: B008 - FastAPI's DI idiom
) -> Response:
    buffer = io.StringIO()
    service = ExportService(database.tasks, database.annotations, database.traces, stdout=buffer)
    # out=Path("-") is ExportService's existing sentinel for "write to stdout" (see
    # ExportService._output_path), which we've pointed at our in-memory buffer above.
    service.export(task, format, joined, out=Path("-"), status=status)
    filename = f"{task}-annotations.{format}"
    return Response(
        content=buffer.getvalue(),
        media_type=_MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
