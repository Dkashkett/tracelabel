import json
import warnings
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol, cast, runtime_checkable

from ..ctf import (
    CtfError,
    Json,
    fold_unknown_keys,
    validate_ctf_line,
)
from ..db import ImportResult, import_trace
from ..errors import UserError
from .adk import AdkAdapter
from .datadog import DatadogAdapter
from .loose import LooseAdapter, _NotLoose

GENERIC_CTF_SNIPPET = (
    '{"messages":[{"role":"user","content":"What\'s AAPL trading at?"},'
    '{"role":"assistant","content":"AAPL is trading at $212.40."}]}'
)


@runtime_checkable
class Adapter(Protocol):
    name: str

    def sniff(self, first_lines: list[Json]) -> bool: ...
    def to_ctf(self, obj: Json) -> Iterator[Json]: ...


def _looks_like_ctf(o: Any) -> bool:
    if not isinstance(o, dict):
        return False
    msgs = o.get("messages")
    if not isinstance(msgs, list) or not msgs:
        return False
    return all(isinstance(m, dict) and "role" in m for m in msgs)


class CtfAdapter:
    name = "ctf"

    def sniff(self, first_lines: list[Any]) -> bool:
        return bool(first_lines) and _looks_like_ctf(first_lines[0])

    def to_ctf(self, obj: Json) -> Iterator[Json]:
        yield obj


ADAPTERS: list[Adapter] = [CtfAdapter(), AdkAdapter(), DatadogAdapter(), LooseAdapter()]

_BY_NAME: dict[str, type] = {
    "ctf": CtfAdapter,
    "adk": AdkAdapter,
    "datadog": DatadogAdapter,
    "loose": LooseAdapter,
}


def die_with_format_help() -> Adapter:
    raise UserError(
        "Could not detect the format of this file.\n"
        "Each line should be a CTF trace, for example:\n\n"
        f"  {GENERIC_CTF_SNIPPET}\n\n"
        "Pass --from adk|datadog|loose to force an adapter, or --as-documents to import "
        "freeform text. See docs/trace-format.md."
    )


def detect(first_lines: list[Json]) -> Adapter:
    for adapter in ADAPTERS:
        if adapter.sniff(first_lines):
            return adapter
    return die_with_format_help()


def _fresh_by_name(name: str) -> Adapter:
    cls = _BY_NAME.get(name)
    if cls is None:
        raise UserError(
            f"Unknown --from value {name!r}. Choose from: auto, ctf, adk, datadog, loose."
        )
    return cast(Adapter, cls())


def _select_adapter(values: list[tuple[int, Any]], from_: str) -> Adapter:
    # A fresh instance per import keeps stateful adapters (LooseAdapter's note counter) clean.
    if from_ != "auto":
        return _fresh_by_name(from_)
    first = [v for _, v in values[:5]]
    return type(detect(first))()


def _parse_values(path: Path) -> list[tuple[int, Any]]:
    text = path.read_text(encoding="utf-8")
    parsed: list[tuple[int, Any]] = []
    jsonl_ok = True
    for i, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            parsed.append((i, json.loads(line)))
        except json.JSONDecodeError:
            jsonl_ok = False
            break
    if jsonl_ok and parsed:
        return parsed
    try:
        whole = json.loads(text)
    except json.JSONDecodeError as e:
        raise UserError(f"{path}: file is not valid JSON or JSONL ({e}).") from e
    if isinstance(whole, list):
        return [(1, v) for v in whole]
    return [(1, whole)]


def _apply(
    adapter: Adapter, values: list[tuple[int, Any]], file: str
) -> Iterator[tuple[int, Json]]:
    if isinstance(adapter, DatadogAdapter):
        # Datadog groups spans across the whole file, so the adapter sees them all at once.
        spans = [v for _, v in values]
        line0 = values[0][0] if values else 1
        for ctf in adapter.to_ctf({"spans": spans}):
            yield line0, ctf
        return
    for line_no, v in values:
        try:
            results = list(adapter.to_ctf(v))
        except _NotLoose as e:
            raise CtfError(
                file,
                line_no,
                "This line does not match any known format.",
                "could not interpret this line as a trace.",
                GENERIC_CTF_SNIPPET,
            ) from e
        for ctf in results:
            yield line_no, ctf


def _doc(s: str) -> Json:
    return {"messages": [{"role": "document", "content": s}], "source": "documents"}


def _iter_documents(path: Path) -> Iterator[tuple[int, Json]]:
    if path.suffix == ".jsonl":
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not line.strip():
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                parsed = None
            # A JSON string line uses its parsed value; anything else keeps the raw line text.
            yield line_no, _doc(parsed if isinstance(parsed, str) else line)
    else:
        # .txt/.html/.json: whole file is one document, content byte-for-byte (07 §4).
        yield 1, _doc(path.read_text(encoding="utf-8"))


def iter_source(
    path: Path, from_: str = "auto", as_documents: bool = False
) -> Iterator[tuple[int, Json]]:
    if as_documents:
        yield from _iter_documents(path)
        return
    values = _parse_values(path)
    adapter = _select_adapter(values, from_)
    yield from _apply(adapter, values, str(path))


@dataclass
class ImportSummary:
    inserted: int = 0
    skipped_duplicate: int = 0
    skipped_conflict: int = 0
    invalid: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _tally(summary: ImportSummary, result: ImportResult) -> None:
    if result == "inserted":
        summary.inserted += 1
    elif result == "skipped_duplicate":
        summary.skipped_duplicate += 1
    else:
        summary.skipped_conflict += 1


def import_file(
    conn: Any,
    path: Path,
    from_: str = "auto",
    on_conflict: Literal["fail", "skip"] = "fail",
    skip_invalid: bool = False,
    as_documents: bool = False,
) -> ImportSummary:
    summary = ImportSummary()
    file = str(path)

    if as_documents:
        adapter: Adapter | None = None
        stream = _iter_documents(path)
        source_name = "documents"
    else:
        values = _parse_values(path)
        adapter = _select_adapter(values, from_)
        stream = _apply(adapter, values, file)
        source_name = adapter.name

    seen_ids: dict[str, int] = {}
    warned: set[str] = set()

    for line_no, ctf in stream:
        try:
            folded, unknown_warnings = fold_unknown_keys(ctf)
            for w in unknown_warnings:
                if w not in warned:  # once per key per file
                    warned.add(w)
                    warnings.warn(w, stacklevel=2)
            validate_ctf_line(folded, file, line_no)

            provided = folded.get("id")
            if provided is not None:
                if provided in seen_ids:
                    raise CtfError(
                        file,
                        line_no,
                        "Duplicate id within one file is not allowed.",
                        f"id {provided!r} also appears on line {seen_ids[provided]}.",
                        None,
                    )
                seen_ids[provided] = line_no

            result = import_trace(conn, folded, source_name, on_conflict)
            _tally(summary, result)
        except CtfError as e:
            if skip_invalid:
                summary.invalid.append(str(e))
                continue
            raise UserError(
                str(e) + "Run with --skip-invalid to import the other lines anyway.\n"
            ) from e

    if isinstance(adapter, LooseAdapter):
        summary.notes = adapter.notes()
    return summary
