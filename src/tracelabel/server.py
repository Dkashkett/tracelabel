import json
import sqlite3
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from . import db
from .config import ResolvedTaskConfig, validate_annotation_values
from .errors import UserError

Level = Literal["turn", "trace"]
TargetType = Literal["turn", "trace"]


class SessionInfo(BaseModel):
    task: str
    level: Level
    fields: list[dict[str, Any]]
    label_roles: list[str]
    annotator: str
    schema_hash: str
    shuffle: bool


class QueueEntry(BaseModel):
    trace_id: str
    position: int
    n_targets: int
    n_labeled: int
    n_skipped: int


class TraceInfo(BaseModel):
    id: str
    source: str | None = None
    metadata: dict[str, Any]


class TurnOut(BaseModel):
    id: str
    idx: int
    role: str
    content: str
    content_type: Literal["text", "json", "html", "parts"]
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    labelable: bool
    metadata: dict[str, Any]


class AnnotationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_type: TargetType
    target_id: str
    status: Literal["labeled", "skipped"]
    values: dict[str, str | list[str]]
    prefill_model: str | None = None


class AnnotationOut(BaseModel):
    target_type: TargetType
    target_id: str
    status: str
    values: dict[str, Any]
    prefill_model: str | None = None
    schema_hash: str
    annotator: str
    created_at: str
    updated_at: str


class SuggestionOut(BaseModel):
    target_id: str
    values: dict[str, Any]
    model: str
    created_at: str


class TraceDetail(BaseModel):
    trace: TraceInfo
    turns: list[TurnOut]
    annotations: dict[str, AnnotationOut]
    suggestions: dict[str, SuggestionOut]


class Progress(BaseModel):
    unit: Literal["turns", "traces"]
    total: int
    labeled: int
    skipped: int


def _annotation_out(row: sqlite3.Row) -> AnnotationOut:
    return AnnotationOut(
        target_type=row["target_type"],
        target_id=row["target_id"],
        status=row["status"],
        values=json.loads(row["values"]),
        prefill_model=row["prefill_model"],
        schema_hash=row["schema_hash"],
        annotator=row["annotator"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _suggestion_out(row: sqlite3.Row) -> SuggestionOut:
    return SuggestionOut(
        target_id=row["target_id"],
        values=json.loads(row["values"]),
        model=row["model"],
        created_at=row["created_at"],
    )


def _turn_out(row: sqlite3.Row, cfg: ResolvedTaskConfig) -> TurnOut:
    tool_calls = json.loads(row["tool_calls"]) if row["tool_calls"] else None
    return TurnOut(
        id=row["id"],
        idx=row["idx"],
        role=row["role"],
        content=row["content"],
        content_type=row["content_type"],
        tool_calls=tool_calls,
        tool_call_id=row["tool_call_id"],
        name=row["name"],
        labelable=cfg.level == "turn" and row["role"] in cfg.label_roles,
        metadata=json.loads(row["metadata"]),
    )


class _ImmutableStatic(StaticFiles):
    async def get_response(self, path: str, scope: Any) -> Any:
        resp = await super().get_response(path, scope)
        # Vite emits content-hashed filenames under /assets, so they are safe to cache forever.
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


def build_app(
    conn: sqlite3.Connection,
    cfg: ResolvedTaskConfig,
    queue: list[str],
    static_dir: Path | None = None,
) -> FastAPI:
    if static_dir is None:
        static_dir = Path(__file__).parent / "static"
    app = FastAPI()

    def task_row() -> sqlite3.Row:
        # open_task (04 §2 serve order) runs before build_app, so the task always exists.
        row = db.get_task(conn, cfg.name)
        assert row is not None
        return row

    @app.exception_handler(UserError)
    async def _user_error(_request: Request, exc: UserError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    # Every endpoint is `async def` with only synchronous db calls: FastAPI then runs them on
    # the single event loop, serializing access to the one sqlite connection (01-interfaces §7
    # DECISION). A sync `def` endpoint would hit the threadpool and race the shared connection.

    @app.get("/api/session", response_model=SessionInfo)
    async def get_session() -> SessionInfo:
        return SessionInfo(
            task=cfg.name,
            level=cfg.level,
            fields=cfg.fields,
            label_roles=cfg.label_roles,
            annotator=cfg.annotator,
            schema_hash=cfg.schema_hash,
            shuffle=cfg.shuffle,
        )

    @app.get("/api/queue", response_model=list[QueueEntry])
    async def get_queue() -> list[QueueEntry]:
        counts = db.target_counts(conn, task_row(), cfg.annotator)
        out: list[QueueEntry] = []
        for position, trace_id in enumerate(queue):
            n_targets, n_labeled, n_skipped = counts.get(trace_id, (0, 0, 0))
            out.append(
                QueueEntry(
                    trace_id=trace_id,
                    position=position,
                    n_targets=n_targets,
                    n_labeled=n_labeled,
                    n_skipped=n_skipped,
                )
            )
        return out

    @app.get("/api/traces/{trace_id}", response_model=TraceDetail)
    async def get_trace(trace_id: str) -> TraceDetail:
        trace = db.get_trace(conn, trace_id)
        if trace is None:
            raise HTTPException(status_code=404, detail=f"unknown trace '{trace_id}'")
        turns = [_turn_out(t, cfg) for t in db.get_turns(conn, trace_id)]
        annotations = {
            r["target_id"]: _annotation_out(r)
            for r in db.annotations_for_trace(conn, cfg.name, cfg.annotator, trace_id)
        }
        suggestions = {
            r["target_id"]: _suggestion_out(r)
            for r in db.suggestions_for_trace(conn, cfg.name, trace_id)
        }
        return TraceDetail(
            trace=TraceInfo(
                id=trace["id"],
                source=trace["source"],
                metadata=json.loads(trace["metadata"]),
            ),
            turns=turns,
            annotations=annotations,
            suggestions=suggestions,
        )

    @app.put("/api/annotations", response_model=AnnotationOut)
    async def put_annotation(ann: AnnotationIn) -> AnnotationOut:
        if ann.target_type != cfg.level:
            raise HTTPException(
                status_code=422,
                detail=f"target_type '{ann.target_type}' must match task level '{cfg.level}'",
            )
        if ann.target_type == "trace":
            if db.get_trace(conn, ann.target_id) is None:
                raise HTTPException(status_code=404, detail=f"unknown trace '{ann.target_id}'")
        else:
            turn = conn.execute("SELECT * FROM turns WHERE id=?", (ann.target_id,)).fetchone()
            if turn is None:
                raise HTTPException(status_code=404, detail=f"unknown turn '{ann.target_id}'")
            if turn["role"] not in cfg.label_roles:
                raise HTTPException(
                    status_code=422,
                    detail=f"turn '{ann.target_id}' has role '{turn['role']}', not labelable",
                )
        try:
            validate_annotation_values(ann.values, ann.status, cfg.fields)
        except UserError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        row = db.upsert_annotation(
            conn,
            task=cfg.name,
            target_type=ann.target_type,
            target_id=ann.target_id,
            status=ann.status,
            values=dict(ann.values),
            annotator=cfg.annotator,
            schema_hash=cfg.schema_hash,
            prefill_model=ann.prefill_model,
        )
        return _annotation_out(row)

    @app.get("/api/progress", response_model=Progress)
    async def get_progress() -> Progress:
        counts = db.target_counts(conn, task_row(), cfg.annotator)
        return Progress(
            unit="turns" if cfg.level == "turn" else "traces",
            total=sum(c[0] for c in counts.values()),
            labeled=sum(c[1] for c in counts.values()),
            skipped=sum(c[2] for c in counts.values()),
        )

    assets_dir = static_dir / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", _ImmutableStatic(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str) -> FileResponse:
        # Unknown /api paths are JSON 404s — never the SPA shell (05 §5).
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

    return app
