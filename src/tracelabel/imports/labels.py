from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tracelabel.config.models import ResolvedTaskConfig
from tracelabel.config.validation import AnnotationValidator
from tracelabel.db.annotations import AnnotationRepository
from tracelabel.errors import UserError

from .parsing import parse_values


@dataclass
class LabelIngestSummary:
    ingested: int = 0
    skipped_no_label: int = 0
    trace_ids: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class LabelIngestService:
    """Load pre-existing judge labels from a source file as annotations under a named
    (source) annotator, so review mode has predictions to step through. Labels are matched to
    stored traces by ``id`` and validated against the task schema, exactly like a UI commit."""

    def __init__(self, annotations: AnnotationRepository) -> None:
        self._annotations = annotations

    def ingest(self, source_path: Path, config: ResolvedTaskConfig) -> LabelIngestSummary:
        if config.review_of is None:
            raise UserError("label ingest requires a review source annotator")
        if config.level != "trace":
            raise UserError(
                "review mode currently supports trace-level labels only; turn-level judge "
                "labels are not yet supported."
            )
        validator = AnnotationValidator(config.fields)
        summary = LabelIngestSummary()
        for line_number, value in parse_values(source_path):
            if not isinstance(value, dict) or config.review_labels_from not in value:
                summary.skipped_no_label += 1
                continue
            trace_id = self._trace_id(value, source_path, line_number)
            values = self._values(value[config.review_labels_from], source_path, line_number)
            try:
                validator.validate(values, "labeled")
            except UserError as error:
                raise UserError(
                    f"{source_path}:{line_number}: judge label under "
                    f"'{config.review_labels_from}' is invalid — {error}"
                ) from error
            self._annotations.upsert_annotation(
                task=config.name,
                target_type="trace",
                target_id=trace_id,
                status="labeled",
                values=values,
                annotator=config.review_of,
                schema_hash=config.schema_hash,
                prefill_model=config.review_of,
            )
            summary.ingested += 1
            summary.trace_ids.append(trace_id)
        return summary

    @staticmethod
    def _trace_id(value: dict[str, Any], source_path: Path, line_number: int) -> str:
        trace_id = value.get("id")
        if trace_id is None:
            raise UserError(
                f"{source_path}:{line_number}: a line carrying a judge label needs an 'id' so "
                "the label can be matched to its trace. Add an id to each labeled line."
            )
        return str(trace_id)

    @staticmethod
    def _values(raw: Any, source_path: Path, line_number: int) -> dict[str, str | list[str]]:
        if not isinstance(raw, dict):
            raise UserError(
                f"{source_path}:{line_number}: a judge label must be an object mapping field "
                'names to values (e.g. {"verdict": "pass", "reasoning": "..."}).'
            )
        return raw
