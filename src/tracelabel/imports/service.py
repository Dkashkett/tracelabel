import warnings
from dataclasses import dataclass, field
from pathlib import Path

from tracelabel.ctf.validation import CtfError, CtfValidator
from tracelabel.db.traces import ConflictPolicy, ImportResult, TraceRepository
from tracelabel.errors import UserError

from .adapters.base import AdapterRegistry
from .adapters.loose import LooseAdapter
from .parsing import iter_target


@dataclass
class ImportSummary:
    inserted: int = 0
    skipped_duplicate: int = 0
    skipped_conflict: int = 0
    invalid: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    trace_ids: list[str] = field(default_factory=list)


class ImportService:
    def __init__(
        self,
        registry: AdapterRegistry,
        validator: CtfValidator,
        traces: TraceRepository,
    ) -> None:
        self._registry = registry
        self._validator = validator
        self._traces = traces

    def import_file(
        self,
        path: Path,
        *,
        from_: str = "auto",
        on_conflict: ConflictPolicy = "fail",
        skip_invalid: bool = False,
        as_documents: bool = False,
    ) -> ImportSummary:
        summary = ImportSummary()
        plan = iter_target(path, self._registry, from_=from_, as_documents=as_documents)

        seen_ids: dict[str, int] = {}
        seen_trace_ids: set[str] = set()
        warned: set[str] = set()
        items = iter(plan.items)
        while True:
            try:
                file, line_number, trace = next(items)
            except StopIteration:
                break
            except CtfError as error:
                if skip_invalid:
                    summary.invalid.append(str(error))
                    continue
                raise UserError(
                    str(error) + "Run with --skip-invalid to import the other lines anyway.\n"
                ) from error
            try:
                folded, unknown_warnings = self._validator.fold_unknown_keys(trace)
                for warning in unknown_warnings:
                    if warning not in warned:
                        warned.add(warning)
                        warnings.warn(warning, stacklevel=2)
                self._validator.validate_line(folded, file, line_number)
                self._check_duplicate_id(folded.get("id"), seen_ids, file, line_number)
                if "content" in folded and "messages" not in folded:
                    result, trace_id = self._traces.import_document(
                        folded, plan.source, on_conflict
                    )
                else:
                    result, trace_id = self._traces.import_trace(folded, plan.source, on_conflict)
                self._tally(summary, result)
                if trace_id not in seen_trace_ids:
                    seen_trace_ids.add(trace_id)
                    summary.trace_ids.append(trace_id)
            except CtfError as error:
                if skip_invalid:
                    summary.invalid.append(str(error))
                    continue
                raise UserError(
                    str(error) + "Run with --skip-invalid to import the other lines anyway.\n"
                ) from error
        summary.notes = list(plan.notes)
        if isinstance(plan.adapter, LooseAdapter):
            summary.notes.extend(plan.adapter.notes())
        return summary

    @staticmethod
    def _check_duplicate_id(
        provided_id: object,
        seen_ids: dict[str, int],
        file: str,
        line_number: int,
    ) -> None:
        if provided_id is None:
            return
        trace_id = str(provided_id)
        if trace_id in seen_ids:
            raise CtfError(
                file,
                line_number,
                "Duplicate id within one file is not allowed.",
                f"id {trace_id!r} also appears on line {seen_ids[trace_id]}.",
                None,
            )
        seen_ids[trace_id] = line_number

    @staticmethod
    def _tally(summary: ImportSummary, result: ImportResult) -> None:
        if result == "inserted":
            summary.inserted += 1
        elif result == "skipped_duplicate":
            summary.skipped_duplicate += 1
        else:
            summary.skipped_conflict += 1
