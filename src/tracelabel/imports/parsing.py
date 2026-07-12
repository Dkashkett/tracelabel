import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from tracelabel.ctf.models import Json
from tracelabel.ctf.validation import CtfError
from tracelabel.errors import UserError

from .adapters.base import GENERIC_CTF_SNIPPET, Adapter, AdapterRegistry
from .adapters.loose import UnsupportedLooseInput

ParsedValue = tuple[int, Any]


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
    if adapter.name == "datadog":
        spans = [value for _, value in values]
        first_line = values[0][0] if values else 1
        for trace in adapter.to_ctf({"spans": spans}):
            yield first_line, trace
        return
    for line_number, value in values:
        try:
            traces = list(adapter.to_ctf(value))
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


def document_trace(content: str) -> Json:
    return {
        "messages": [{"role": "document", "content": content}],
        "source": "documents",
    }


def iter_documents(path: Path) -> Iterator[tuple[int, Json]]:
    if path.suffix == ".jsonl":
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(),
            start=1,
        ):
            if not line.strip():
                continue
            try:
                parsed: Any = json.loads(line)
            except json.JSONDecodeError:
                parsed = None
            yield line_number, document_trace(parsed if isinstance(parsed, str) else line)
        return
    yield 1, document_trace(path.read_text(encoding="utf-8"))


def iter_source(
    path: Path,
    registry: AdapterRegistry,
    *,
    from_: str = "auto",
    as_documents: bool = False,
) -> Iterator[tuple[int, Json]]:
    if as_documents:
        yield from iter_documents(path)
        return
    values = parse_values(path)
    adapter = registry.select(from_, [value for _, value in values[:5]])
    yield from apply_adapter(adapter, values, str(path))
