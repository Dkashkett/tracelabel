from collections.abc import Iterator
from typing import Any, cast

from tracelabel.ctf.hashing import canonical_json, sha256_hex
from tracelabel.ctf.models import Json

_SPAN_MAPPED_META = {"kind", "name", "input", "output"}


def _is_span(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("meta"), dict)
        and ("trace_id" in value or "traceId" in value)
    )


def _looks_datadog(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    spans = value.get("spans")
    if isinstance(spans, list):
        return any(_is_span(span) for span in spans)
    return _is_span(value)


def _extract_spans(value: Json) -> list[Json]:
    spans = value.get("spans")
    if isinstance(spans, list):
        extracted: list[Json] = []
        for span in spans:
            if isinstance(span, dict) and isinstance(span.get("spans"), list):
                extracted.extend(span["spans"])
            else:
                extracted.append(span)
        return extracted
    return [value]


def _raw_json_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    return canonical_json(value)


def _span_metadata(span: Json) -> Json:
    return {
        key: span.get(key)
        for key in ("span_id", "trace_id", "start_ns", "duration")
        if span.get(key) is not None
    }


def _content_key(role: Any, content: Any) -> str:
    return canonical_json([role, content])


def _tool_value(metadata: Json, side: str) -> Any:
    block = metadata.get(side) or {}
    if isinstance(block, dict) and "value" in block:
        return block["value"]
    return block


def _trace_from_spans(trace_id: str, spans: list[Json]) -> Json:
    ordered_spans = sorted(spans, key=lambda span: span.get("start_ns", 0))
    messages: list[Json] = []
    seen: set[str] = set()
    unmapped_metadata: Json = {}

    for span in ordered_spans:
        metadata = span.get("meta") or {}
        kind = metadata.get("kind")
        span_metadata = _span_metadata(span)
        if kind == "tool":
            call_id = span.get("span_id") or "call_" + sha256_hex(canonical_json(span))[:16]
            name = metadata.get("name") or span.get("name")
            function = {
                "name": name,
                "arguments": _raw_json_string(_tool_value(metadata, "input")),
            }
            call = {"id": call_id, "type": "function", "function": function}
            call_message: Json = {
                "role": "assistant",
                "content": "",
                "tool_calls": [call],
            }
            if span_metadata:
                call_message["metadata"] = span_metadata
            messages.append(call_message)
            tool_message: Json = {
                "role": "tool",
                "tool_call_id": call_id,
                "content": _raw_json_string(_tool_value(metadata, "output")),
            }
            if name is not None:
                tool_message["name"] = name
            if span_metadata:
                tool_message["metadata"] = span_metadata
            messages.append(tool_message)
        elif kind == "llm":
            for message in (metadata.get("input") or {}).get("messages", []) or []:
                key = _content_key(message.get("role"), message.get("content"))
                if key in seen:
                    continue
                seen.add(key)
                messages.append({"role": message.get("role"), "content": message.get("content")})
            for message in (metadata.get("output") or {}).get("messages", []) or []:
                key = _content_key(message.get("role"), message.get("content"))
                if key in seen:
                    continue
                seen.add(key)
                output_message: Json = {
                    "role": message.get("role"),
                    "content": message.get("content"),
                }
                if span_metadata:
                    output_message["metadata"] = span_metadata
                messages.append(output_message)
        else:
            extra = {key: item for key, item in metadata.items() if key not in _SPAN_MAPPED_META}
            if extra:
                unmapped_metadata[span.get("span_id") or trace_id] = extra

    trace: Json = {"id": trace_id, "source": "datadog", "messages": messages}
    if unmapped_metadata:
        trace["raw"] = {"datadog_spans": unmapped_metadata}
    return trace


class DatadogAdapter:
    name = "datadog"

    def sniff(self, first_values: list[Any]) -> bool:
        return bool(first_values) and _looks_datadog(first_values[0])

    def to_ctf(self, value: Any) -> Iterator[Json]:
        groups: dict[str, list[Json]] = {}
        order: list[str] = []
        for span in _extract_spans(cast(Json, value)):
            if not isinstance(span, dict):
                continue
            trace_id = str(span.get("trace_id") or span.get("traceId") or "")
            if trace_id not in groups:
                groups[trace_id] = []
                order.append(trace_id)
            groups[trace_id].append(span)
        for trace_id in order:
            yield _trace_from_spans(trace_id, groups[trace_id])
