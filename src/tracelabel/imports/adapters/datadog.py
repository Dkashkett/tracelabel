from collections.abc import Iterator
from datetime import datetime, timezone
from typing import Any, cast

from tracelabel.ctf.hashing import canonical_json, sha256_hex
from tracelabel.ctf.models import Json

_SPAN_MAPPED_META = {"kind", "name", "input", "output", "error.message", "error.type"}
_EVENT_KIND_MAP = {
    "workflow": "agent",
    "agent": "agent",
    "retrieval": "retrieval",
    "embedding": "retrieval",
}
# Kinds that mark an agent/orchestration boundary; their `name` becomes the `agent`
# on every descendant row (nearest enclosing span wins).
_AGENT_KINDS = {"workflow", "agent"}


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


def _started_at(span: Json) -> str | None:
    start_ns = span.get("start_ns")
    if not isinstance(start_ns, int | float):
        return None
    seconds = start_ns / 1_000_000_000
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _duration_ms(span: Json) -> float | None:
    duration = span.get("duration")
    if not isinstance(duration, int | float):
        return None
    return duration / 1_000_000


def _status(span: Json, metadata: Json) -> tuple[str | None, str | None]:
    error_message = metadata.get("error.message")
    if span.get("error") or error_message or metadata.get("error.type"):
        return "error", error_message if isinstance(error_message, str) else None
    return None, None


def _common_fields(span: Json) -> Json:
    common: Json = {}
    span_id = span.get("span_id")
    if span_id is not None:
        common["span_id"] = span_id
    parent_id = span.get("parent_id")
    if parent_id is not None:
        common["parent_id"] = parent_id
    started_at = _started_at(span)
    if started_at is not None:
        common["started_at"] = started_at
    duration_ms = _duration_ms(span)
    if duration_ms is not None:
        common["duration_ms"] = duration_ms
    return common


def _content_key(role: Any, content: Any) -> str:
    return canonical_json([role, content])


def _tool_value(metadata: Json, side: str) -> Any:
    block = metadata.get(side) or {}
    if isinstance(block, dict) and "value" in block:
        return block["value"]
    return block


def _agent_for(
    span_id: Any, parent_of: dict[Any, Any], agent_name_of: dict[Any, str]
) -> str | None:
    current = span_id
    seen: set[Any] = set()
    while current is not None and current not in seen:
        seen.add(current)
        if current in agent_name_of:
            return agent_name_of[current]
        current = parent_of.get(current)
    return None


def _trace_from_spans(trace_id: str, spans: list[Json]) -> Json:
    ordered_spans = sorted(spans, key=lambda span: span.get("start_ns", 0))

    parent_of: dict[Any, Any] = {}
    agent_name_of: dict[Any, str] = {}
    for span in ordered_spans:
        span_id = span.get("span_id")
        if span_id is not None and span.get("parent_id") is not None:
            parent_of[span_id] = span["parent_id"]
        metadata = span.get("meta") or {}
        if metadata.get("kind") in _AGENT_KINDS and span_id is not None:
            agent_name_of[span_id] = str(metadata.get("name") or span.get("name") or span_id)

    messages: list[Json] = []
    seen: set[str] = set()
    unmapped_metadata: Json = {}

    for span in ordered_spans:
        metadata = span.get("meta") or {}
        kind = metadata.get("kind")
        common = _common_fields(span)
        status, status_message = _status(span, metadata)
        agent = _agent_for(span.get("span_id"), parent_of, agent_name_of)

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
            if agent is not None:
                call_message["agent"] = agent
            messages.append(call_message)
            # Duration/status live on the result row: the frontend derives a tool
            # interaction's duration and status from its paired result turn.
            tool_message: Json = {
                "role": "tool",
                "tool_call_id": call_id,
                "content": _raw_json_string(_tool_value(metadata, "output")),
                **common,
            }
            if name is not None:
                tool_message["name"] = name
            if agent is not None:
                tool_message["agent"] = agent
            if status is not None:
                tool_message["status"] = status
                if status_message is not None:
                    tool_message["status_message"] = status_message
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
                    **common,
                }
                if agent is not None:
                    output_message["agent"] = agent
                if status is not None:
                    output_message["status"] = status
                    if status_message is not None:
                        output_message["status_message"] = status_message
                messages.append(output_message)
        elif kind in _EVENT_KIND_MAP:
            event: Json = {
                "role": "event",
                "content": "",
                "kind": _EVENT_KIND_MAP[kind],
                "name": metadata.get("name") or span.get("name") or kind,
                **common,
            }
            if agent is not None:
                event["agent"] = agent
            if status is not None:
                event["status"] = status
                if status_message is not None:
                    event["status_message"] = status_message
            extra = {key: item for key, item in metadata.items() if key not in _SPAN_MAPPED_META}
            if extra:
                event["metadata"] = extra
            messages.append(event)
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
    aggregates_input = True

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
