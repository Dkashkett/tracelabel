import sqlite3
from typing import Any, cast

from tracelabel.config.models import ResolvedTaskConfig
from tracelabel.config.validation import AnnotationValidator
from tracelabel.db.annotations import AnnotationRepository
from tracelabel.db.database import decode_json
from tracelabel.db.tasks import TaskRepository
from tracelabel.db.traces import TraceRepository
from tracelabel.errors import NotFoundError, UserError

from .models import (
    AnnotationIn,
    AnnotationOut,
    DocumentOut,
    Progress,
    QueueEntry,
    SessionInfo,
    SuggestionOut,
    TraceDetail,
    TraceInfo,
    TurnOut,
)


class LabelingService:
    def __init__(
        self,
        config: ResolvedTaskConfig,
        queue: list[str],
        traces: TraceRepository,
        tasks: TaskRepository,
        annotations: AnnotationRepository,
        validator: AnnotationValidator | None = None,
    ) -> None:
        self._config = config
        self._queue = queue
        self._traces = traces
        self._tasks = tasks
        self._annotations = annotations
        self._validator = validator or AnnotationValidator(config.fields)

    def session(self) -> SessionInfo:
        return SessionInfo(
            task=self._config.name,
            level=self._config.level,
            fields=self._config.fields,
            label_roles=self._config.label_roles,
            annotator=self._config.annotator,
            schema_hash=self._config.schema_hash,
            shuffle=self._config.shuffle,
        )

    def queue(self) -> list[QueueEntry]:
        counts = self._annotations.target_counts(self._task(), self._config.annotator)
        entries: list[QueueEntry] = []
        for position, trace_id in enumerate(self._queue):
            target_count, labeled_count, skipped_count = counts.get(trace_id, (0, 0, 0))
            entries.append(
                QueueEntry(
                    trace_id=trace_id,
                    position=position,
                    n_targets=target_count,
                    n_labeled=labeled_count,
                    n_skipped=skipped_count,
                )
            )
        return entries

    def trace_detail(self, trace_id: str) -> TraceDetail:
        trace = self._traces.get(trace_id)
        if trace is None:
            raise NotFoundError(f"unknown trace '{trace_id}'")
        document = self._document_out(trace)
        turns = (
            [] if document else [self._turn_out(row) for row in self._traces.get_turns(trace_id)]
        )
        annotations = {
            str(row["target_id"]): self._annotation_out(row)
            for row in self._annotations.annotations_for_trace(
                self._config.name,
                self._config.annotator,
                trace_id,
            )
        }
        suggestions = {
            str(row["target_id"]): self._suggestion_out(row)
            for row in self._annotations.suggestions_for_trace(self._config.name, trace_id)
        }
        return TraceDetail(
            trace=TraceInfo(
                id=trace["id"],
                source=trace["source"],
                metadata=self._json_object(trace["metadata"]),
            ),
            turns=turns,
            document=document,
            annotations=annotations,
            suggestions=suggestions,
        )

    def put_annotation(self, annotation: AnnotationIn) -> AnnotationOut:
        self._validate_target(annotation)
        self._validator.validate(annotation.values, annotation.status)
        row = self._annotations.upsert_annotation(
            task=self._config.name,
            target_type=annotation.target_type,
            target_id=annotation.target_id,
            status=annotation.status,
            values=dict(annotation.values),
            annotator=self._config.annotator,
            schema_hash=self._config.schema_hash,
            prefill_model=annotation.prefill_model,
        )
        return self._annotation_out(row)

    def progress(self) -> Progress:
        counts = self._annotations.target_counts(self._task(), self._config.annotator)
        queue_set = set(self._queue)
        scoped = [count for trace_id, count in counts.items() if trace_id in queue_set]
        return Progress(
            unit="turns" if self._config.level == "turn" else "traces",
            total=sum(count[0] for count in scoped),
            labeled=sum(count[1] for count in scoped),
            skipped=sum(count[2] for count in scoped),
        )

    def _task(self) -> sqlite3.Row:
        task = self._tasks.get(self._config.name)
        if task is None:
            raise UserError(f"task '{self._config.name}' is not open")
        return task

    def _validate_target(self, annotation: AnnotationIn) -> None:
        if annotation.target_type != self._config.level:
            raise UserError(
                f"target_type '{annotation.target_type}' must match task level "
                f"'{self._config.level}'"
            )
        if annotation.target_type == "trace":
            if self._traces.get(annotation.target_id) is None:
                raise NotFoundError(f"unknown trace '{annotation.target_id}'")
            return
        turn = self._traces.get_turn(annotation.target_id)
        if turn is None:
            raise NotFoundError(f"unknown turn '{annotation.target_id}'")
        if turn["role"] not in self._config.label_roles:
            raise UserError(
                f"turn '{annotation.target_id}' has role '{turn['role']}', not labelable"
            )

    @staticmethod
    def _document_out(trace: sqlite3.Row) -> DocumentOut | None:
        content = trace["content"]
        if content is None:
            return None
        return DocumentOut(content=content, content_type=trace["content_type"] or "text")

    def _turn_out(self, row: sqlite3.Row) -> TurnOut:
        raw_tool_calls = row["tool_calls"]
        tool_calls = (
            cast(list[dict[str, Any]], decode_json(raw_tool_calls))
            if raw_tool_calls is not None
            else None
        )
        return TurnOut(
            id=row["id"],
            idx=row["idx"],
            role=row["role"],
            content=row["content"],
            content_type=row["content_type"],
            tool_calls=tool_calls,
            tool_call_id=row["tool_call_id"],
            name=row["name"],
            labelable=(self._config.level == "turn" and row["role"] in self._config.label_roles),
            metadata=self._json_object(row["metadata"]),
        )

    @classmethod
    def _annotation_out(cls, row: sqlite3.Row) -> AnnotationOut:
        return AnnotationOut(
            target_type=row["target_type"],
            target_id=row["target_id"],
            status=row["status"],
            values=cls._json_object(row["values"]),
            prefill_model=row["prefill_model"],
            schema_hash=row["schema_hash"],
            annotator=row["annotator"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @classmethod
    def _suggestion_out(cls, row: sqlite3.Row) -> SuggestionOut:
        return SuggestionOut(
            target_id=row["target_id"],
            values=cls._json_object(row["values"]),
            model=row["model"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _json_object(raw: str) -> dict[str, Any]:
        return cast(dict[str, Any], decode_json(raw))
