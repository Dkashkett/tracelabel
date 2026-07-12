from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from tracelabel.config.models import AnnotationStatus, Level
from tracelabel.db.annotations import TargetType


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


class DocumentOut(BaseModel):
    content: str
    content_type: Literal["text", "json", "html", "markdown"]


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
    status: AnnotationStatus
    values: dict[str, str | list[str]]
    prefill_model: str | None = None


class AnnotationOut(BaseModel):
    target_type: TargetType
    target_id: str
    status: AnnotationStatus
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
    document: DocumentOut | None = None
    annotations: dict[str, AnnotationOut]
    suggestions: dict[str, SuggestionOut]


class Progress(BaseModel):
    unit: Literal["turns", "traces"]
    total: int
    labeled: int
    skipped: int
