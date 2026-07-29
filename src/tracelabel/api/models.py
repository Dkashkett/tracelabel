"""Every request/response model in the HTTP API — the frozen contract from
docs/refactor-plan.md §3. Edit only to track that table.

The five pre-existing labeling models (SessionInfo, QueueEntry, TraceDetail,
AnnotationIn/Out, Progress) keep their field lists unchanged — only their route
paths move (to api/routes/labeling.py, under /api/projects/{p}/tasks/{t}/...).
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from tracelabel.config.models import AnnotationStatus, Level
from tracelabel.db.annotations import TargetType

# ── labeling (existing shapes, unchanged) ───────────────────────────────────


class SessionInfo(BaseModel):
    task: str
    level: Level
    fields: list[dict[str, Any]]
    label_roles: list[str]
    annotator: str
    schema_hash: str
    shuffle: bool
    mode: Literal["labeling", "review"] = "labeling"
    review_of: str | None = None


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
    span_id: str | None = None
    parent_id: str | None = None
    agent: str | None = None
    kind: str | None = None
    started_at: str | None = None
    duration_ms: float | None = None
    status: str | None = None
    status_message: str | None = None


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
    # In review mode, the labels being reviewed (the source/judge annotator's annotations),
    # keyed by target_id. Empty in normal labeling.
    review_of: dict[str, AnnotationOut] = {}


class Progress(BaseModel):
    unit: Literal["turns", "traces"]
    total: int
    labeled: int
    skipped: int


# ── settings ─────────────────────────────────────────────────────────────


class Settings(BaseModel):
    annotator: str | None = None
    default_llm_model: str | None = None
    theme: Literal["system", "light", "dark"] = "system"


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotator: str | None = None
    default_llm_model: str | None = None
    theme: Literal["system", "light", "dark"] | None = None


# ── sources ──────────────────────────────────────────────────────────────


class SourceOut(BaseModel):
    id: int
    name: str
    path: str | None
    adapter: str
    imported_at: str
    trace_count: int


# ── tasks ────────────────────────────────────────────────────────────────


class TaskSummary(BaseModel):
    name: str
    level: Level
    schema_hash: str
    compat_hash: str
    updated_at: str
    total: int
    addressed: int
    queue_scope: dict[str, Any]


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    level: Level
    fields: list[dict[str, Any]] | None = None  # None -> DEFAULT_FIELDS
    label_roles: list[str] | None = None
    shuffle: bool = False
    annotator: str | None = None
    queue_scope: dict[str, Any] | None = None


class TaskPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    annotator: str | None = None
    shuffle: bool | None = None
    queue_scope: dict[str, Any] | None = None
    llm_model: str | None = None
    llm_temperature: float | None = None
    llm_max_tokens: int | None = None
    suggest_instructions: str | None = None
    review_of: str | None = None
    review_labels_from: str | None = None


class TaskDetail(BaseModel):
    name: str
    level: Level
    fields: list[dict[str, Any]]
    label_roles: list[str]
    shuffle: bool
    annotator: str
    schema_hash: str
    compat_hash: str
    queue_scope: dict[str, Any]
    llm_model: str | None
    llm_temperature: float | None
    llm_max_tokens: int | None
    suggest_instructions: str | None
    review_of: str | None
    review_labels_from: str
    created_at: str
    updated_at: str


# ── schema (rubric) ─────────────────────────────────────────────────────


class SchemaOut(BaseModel):
    fields: list[dict[str, Any]]
    schema_hash: str
    compat_hash: str


class SchemaPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fields: list[dict[str, Any]]


class RetypedFieldOut(BaseModel):
    name: str
    old_type: str
    new_type: str


class SchemaImpactOut(BaseModel):
    removed_fields: list[str]
    retyped_fields: list[RetypedFieldOut]
    removed_options: dict[str, list[str]]
    affected_annotations: int
    breaking: bool


# ── projects ─────────────────────────────────────────────────────────────


class ProjectSummary(BaseModel):
    slug: str
    name: str
    created_at: str
    task_count: int
    source_count: int


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    notes: str = ""


class ProjectDetail(BaseModel):
    slug: str
    name: str
    created_at: str
    notes: str
    tasks: list[TaskSummary]
    sources: list[SourceOut]


# ── imports ──────────────────────────────────────────────────────────────


class ImportPreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    path: str | None = None
    content: str | None = None
    from_: str = Field(default="auto", alias="from")
    as_documents: bool = False
    include_all_spans: bool = False


class ImportPreview(BaseModel):
    adapter: str
    trace_count: int | None = None
    # The first few traces, rendered with the same shape the labeling view uses
    # (F2-IMPORT renders these with the real TracePane components).
    traces: list[TraceDetail]
    errors: list[str]
    notes: list[str] = []


class ImportIn(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    path: str | None = None
    content: str | None = None
    name: str | None = None  # display name for the resulting `sources` row
    from_: str = Field(default="auto", alias="from")
    on_conflict: Literal["fail", "skip"] = "fail"
    skip_invalid: bool = False
    as_documents: bool = False
    include_all_spans: bool = False


# ── items (Phase 2 — data manager) ──────────────────────────────────────


class ItemOut(BaseModel):
    target_id: str
    trace_id: str
    status: Literal["labeled", "skipped", "unaddressed"]
    values: dict[str, Any]
    annotator: str | None
    source: str | None


class ItemPage(BaseModel):
    items: list[ItemOut]
    total: int
    offset: int
    limit: int


# ── stats (Phase 3 — eval loop) ─────────────────────────────────────────


class FieldAgreement(BaseModel):
    field: str
    agreement_rate: float
    confusion: dict[str, dict[str, int]]


class TaskStats(BaseModel):
    total: int
    labeled: int
    skipped: int
    agreement: list[FieldAgreement]


class SuggestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int | None = None
    overwrite: bool = False
    concurrency: int = 4


# ── jobs ─────────────────────────────────────────────────────────────────


class JobRef(BaseModel):
    job_id: str


class JobStatus(BaseModel):
    job_id: str
    state: Literal["pending", "running", "done", "error"]
    progress: float
    result: Any | None = None
    error: str | None = None
