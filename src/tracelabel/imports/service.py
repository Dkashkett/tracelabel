import tempfile
import warnings
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, cast

from tracelabel.api.models import DocumentOut, ImportPreview, TraceDetail, TraceInfo, TurnOut
from tracelabel.ctf.content import content_type_of, serialize_content
from tracelabel.ctf.hashing import derive_document_id, derive_trace_id
from tracelabel.ctf.models import Json
from tracelabel.ctf.validation import CtfError, CtfValidator
from tracelabel.db.sources import SourceRepository
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
    # Set by import_file() once the adapter is detected; used by import_source() to
    # label the resulting `sources` row.
    adapter: str = ""
    # Set by import_source() after it records a `sources` row; None for a bare
    # import_file() call (e.g. the CLI path, which has no sources table concept).
    source_id: int | None = None


class ImportService:
    """Detect, preview, and run imports through the existing adapter pipeline.

    Three public entry points, in order of how "real" they are:

    - ``preview()``   — writes nothing. Runs the first ``limit`` records through the
                         same adapter/validation pipeline as a real import, so the UI
                         can show what an import *would* produce.
    - ``import_file()`` — the pre-existing full import: writes traces/turns, no
                         ``sources`` bookkeeping. Kept as-is; the CLI and
                         ``SuggestCommand``/``ServeCommand`` call it directly and don't
                         know about sources.
    - ``import_source()`` — ``import_file()`` plus a `sources` row linking every trace
                         it wrote. This is what a background job (via
                         ``tracelabel.jobs.JobRunner``) should call for the
                         ``POST /api/projects/{p}/imports`` route.
    """

    def __init__(
        self,
        registry: AdapterRegistry,
        validator: CtfValidator,
        traces: TraceRepository,
        sources: SourceRepository | None = None,
    ) -> None:
        self._registry = registry
        self._validator = validator
        self._traces = traces
        self._sources = sources

    # ── preview: read-only ───────────────────────────────────────────────

    def preview(
        self,
        *,
        path: str | None = None,
        content: str | None = None,
        from_: str = "auto",
        limit: int = 3,
        as_documents: bool = False,
    ) -> ImportPreview:
        """Run the adapter pipeline over ``path`` or ``content`` and report what it
        would import, without writing anything to the database.

        Detection reuses ``AdapterRegistry.detect`` (via ``iter_target`` -> `.select`),
        which only sniffs the first 5 parsed values, so this stays cheap even for a
        large file. The full set of parsed values is still validated and converted
        (matching what a real import does), so ``trace_count`` and ``errors`` reflect
        the whole file — only the returned ``traces`` sample is capped at ``limit``.
        """
        with self._resolved_path(path, content) as resolved_path:
            plan = iter_target(
                resolved_path,
                self._registry,
                from_=from_,
                as_documents=as_documents,
            )
            traces: list[TraceDetail] = []
            errors: list[str] = []
            count = 0
            for file, line_number, raw_trace in plan.items:
                count += 1
                try:
                    folded, _warnings = self._validator.fold_unknown_keys(raw_trace)
                    self._validator.validate_line(folded, file, line_number)
                except CtfError as error:
                    errors.append(str(error))
                    continue
                if len(traces) < limit:
                    traces.append(self._to_trace_detail(folded))
            adapter_name = plan.adapter.name if plan.adapter is not None else plan.source
            return ImportPreview(
                adapter=adapter_name,
                trace_count=count,
                traces=traces,
                errors=errors,
                notes=list(plan.notes),
            )

    # ── full import: writes traces/turns only (pre-existing behavior) ───

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
        summary.adapter = plan.source

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

    # ── full import + sources bookkeeping ────────────────────────────────

    def import_source(
        self,
        *,
        path: str | None = None,
        content: str | None = None,
        name: str | None = None,
        from_: str = "auto",
        on_conflict: ConflictPolicy = "fail",
        skip_invalid: bool = False,
        as_documents: bool = False,
    ) -> ImportSummary:
        """Run a real import and record a ``sources`` row linking every trace it wrote.

        This is the method a route handler should hand to
        ``JobRunner.submit(lambda job: import_service.import_source(...))`` to satisfy
        the ``ImportIn -> JobRef`` contract — the job's result becomes this
        ``ImportSummary`` (with ``source_id`` set), pollable via ``GET /api/jobs/{id}``.
        """
        if self._sources is None:
            raise UserError(
                "ImportService was constructed without a SourceRepository; "
                "import_source() needs one to record the import."
            )
        with self._resolved_path(path, content) as resolved_path:
            summary = self.import_file(
                resolved_path,
                from_=from_,
                on_conflict=on_conflict,
                skip_invalid=skip_invalid,
                as_documents=as_documents,
            )
        source_name = name or (Path(path).name if path is not None else "pasted import")
        source = self._sources.record_import(
            name=source_name,
            path=path,
            adapter=summary.adapter,
            trace_ids=summary.trace_ids,
        )
        summary.source_id = int(source["id"])
        return summary

    # ── shared helpers ────────────────────────────────────────────────────

    @staticmethod
    @contextmanager
    def _resolved_path(path: str | None, content: str | None) -> Iterator[Path]:
        """Resolve an ``ImportPreviewIn``/``ImportIn``-style path-or-content pair to a
        real file path, writing ``content`` to a temp file if that's what was given.

        Imported content stays byte-for-byte immutable — this only chooses where the
        bytes live on disk before handing them to the same file-reading pipeline
        (``parsing.iter_target``) a path-based import already uses.
        """
        if (path is None) == (content is None):
            raise UserError("Provide exactly one of 'path' or 'content'.")
        if path is not None:
            yield Path(path)
            return
        assert content is not None
        with tempfile.NamedTemporaryFile(
            "w", suffix=".jsonl", delete=False, encoding="utf-8"
        ) as handle:
            handle.write(content)
            temp_path = Path(handle.name)
        try:
            yield temp_path
        finally:
            temp_path.unlink(missing_ok=True)

    def _to_trace_detail(self, folded: Json) -> TraceDetail:
        """Build a ``TraceDetail`` straight from a folded CTF ``Json`` dict — no
        database round trip. Preview has no task yet (no ``label_roles``/``level``),
        so every turn's ``labelable`` is ``False``; the real labeling view computes it
        once a task exists (see ``LabelingService.trace_detail``).
        """
        if "content" in folded and "messages" not in folded:
            return self._document_detail(folded)
        return self._conversation_detail(folded)

    @staticmethod
    def _document_detail(document: Json) -> TraceDetail:
        content = str(document["content"])
        content_type_value = document.get("content_type") or "text"
        content_type = cast('Literal["text", "json", "html", "markdown"]', content_type_value)
        doc_id = str(document.get("id") or derive_document_id(content))
        return TraceDetail(
            trace=TraceInfo(
                id=doc_id,
                source=document.get("source"),
                metadata=document.get("metadata", {}),
            ),
            turns=[],
            document=DocumentOut(content=content, content_type=content_type),
            annotations={},
            suggestions={},
        )

    def _conversation_detail(self, trace: Json) -> TraceDetail:
        messages = trace["messages"]
        trace_id = str(trace.get("id") or derive_trace_id(messages))
        turns = [self._turn_out(trace_id, index, message) for index, message in enumerate(messages)]
        return TraceDetail(
            trace=TraceInfo(
                id=trace_id,
                source=trace.get("source"),
                metadata=trace.get("metadata", {}),
            ),
            turns=turns,
            document=None,
            annotations={},
            suggestions={},
        )

    @staticmethod
    def _turn_out(trace_id: str, index: int, message: Json) -> TurnOut:
        content = message["content"]
        return TurnOut(
            id=f"{trace_id}#{index}",
            idx=index,
            role=message["role"],
            content=serialize_content(content),
            content_type=content_type_of(content),
            tool_calls=message.get("tool_calls"),
            tool_call_id=message.get("tool_call_id"),
            name=message.get("name"),
            labelable=False,
            metadata=message.get("metadata", {}),
            span_id=message.get("span_id"),
            parent_id=message.get("parent_id"),
            agent=message.get("agent"),
            kind=message.get("kind"),
            started_at=message.get("started_at"),
            duration_ms=message.get("duration_ms"),
            status=message.get("status"),
            status_message=message.get("status_message"),
        )

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
