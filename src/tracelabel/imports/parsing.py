import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tracelabel.ctf.models import Json
from tracelabel.ctf.validation import CtfError
from tracelabel.errors import UserError

from .adapters.base import GENERIC_CTF_SNIPPET, Adapter, AdapterRegistry
from .adapters.loose import UnsupportedLooseInput

ParsedValue = tuple[int, Any]

DOCUMENT_EXTENSIONS = {
    ".md": "markdown",
    ".markdown": "markdown",
    ".txt": "text",
    ".text": "text",
    ".html": "html",
    ".htm": "html",
}


def parse_values(path: Path) -> list[ParsedValue]:
    text = path.read_text(encoding="utf-8")
    parsed: list[ParsedValue] = []
    jsonl_valid = True
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            parsed.append((line_number, json.loads(line)))
        except json.JSONDecodeError:
            jsonl_valid = False
            break
    if jsonl_valid and parsed:
        return parsed
    try:
        whole: Any = json.loads(text)
    except json.JSONDecodeError as error:
        raise UserError(f"{path}: file is not valid JSON or JSONL ({error}).") from error
    if isinstance(whole, list):
        return [(1, value) for value in whole]
    return [(1, whole)]


def apply_adapter(
    adapter: Adapter,
    values: list[ParsedValue],
    file: str,
) -> Iterator[tuple[int, Json]]:
    from .adapters.documents import DOCUMENT_CTF_SNIPPET, UnsupportedDocumentInput

    if adapter.name == "datadog":
        spans = [value for _, value in values]
        first_line = values[0][0] if values else 1
        for trace in adapter.to_ctf({"spans": spans}):
            yield first_line, trace
        return
    for line_number, value in values:
        try:
            traces = list(adapter.to_ctf(value))
        except UnsupportedDocumentInput as error:
            raise CtfError(
                file,
                line_number,
                'A document line must be a string, or an object with a string "content" field.',
                "could not interpret this line as a document.",
                DOCUMENT_CTF_SNIPPET,
            ) from error
        except UnsupportedLooseInput as error:
            raise CtfError(
                file,
                line_number,
                "This line does not match any known format.",
                "could not interpret this line as a trace.",
                GENERIC_CTF_SNIPPET,
            ) from error
        for trace in traces:
            yield line_number, trace


def document_object(
    content: str,
    *,
    doc_id: str | None = None,
    metadata: Json | None = None,
    content_type: str | None = None,
) -> Json:
    obj: Json = {"content": content}
    if doc_id is not None:
        obj["id"] = doc_id
    if metadata is not None:
        obj["metadata"] = metadata
    if content_type is not None:
        obj["content_type"] = content_type
    return obj


@dataclass
class SourcePlan:
    items: Iterator[tuple[str, int, Json]]
    source: str
    adapter: Adapter | None
    notes: list[str] = field(default_factory=list)


def _scan_directory(path: Path) -> tuple[Iterator[tuple[str, int, Json]], list[str]]:
    entries = sorted(entry for entry in path.iterdir() if entry.is_file())
    importable: list[Path] = []
    skipped = 0
    for entry in entries:
        if entry.name.startswith(".") or entry.suffix.lower() not in DOCUMENT_EXTENSIONS:
            skipped += 1
            continue
        importable.append(entry)
    if not importable:
        supported = ", ".join(sorted(DOCUMENT_EXTENSIONS))
        raise UserError(f"{path}: no importable files found (supported extensions: {supported}).")
    notes = [f"skipped {skipped} unsupported files"] if skipped else []

    def _items() -> Iterator[tuple[str, int, Json]]:
        for entry in importable:
            try:
                content = entry.read_text(encoding="utf-8")
            except UnicodeDecodeError as error:
                raise CtfError(
                    str(entry),
                    1,
                    "Document files must be UTF-8 encoded text.",
                    f"could not decode file as UTF-8 ({error}).",
                    None,
                ) from error
            obj = document_object(
                content,
                doc_id=entry.name.replace("#", "_"),
                metadata={"path": str(entry)},
                content_type=DOCUMENT_EXTENSIONS[entry.suffix.lower()],
            )
            yield str(entry), 1, obj

    return _items(), notes


def iter_target(
    path: Path,
    registry: AdapterRegistry,
    *,
    from_: str = "auto",
    as_documents: bool = False,
) -> SourcePlan:
    if path.is_dir():
        if from_ != "auto":
            raise UserError(
                "--from cannot be combined with a directory target; each file's extension "
                "already determines its content type."
            )
        items, notes = _scan_directory(path)
        return SourcePlan(items=items, source="documents", adapter=None, notes=notes)

    if path.suffix.lower() in DOCUMENT_EXTENSIONS:
        raise UserError(
            f"{path}: a single document file is not a supported target. "
            "Pass a .jsonl of documents or a directory of files."
        )

    values = parse_values(path)
    select_name = "documents" if as_documents else from_
    adapter = registry.select(select_name, [value for _, value in values[:5]])
    file = str(path)

    def _items() -> Iterator[tuple[str, int, Json]]:
        for line_number, trace in apply_adapter(adapter, values, file):
            yield file, line_number, trace

    return SourcePlan(items=_items(), source=adapter.name, adapter=adapter, notes=[])
