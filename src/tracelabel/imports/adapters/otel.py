import json
import re
from collections import defaultdict
from collections.abc import Iterator
from datetime import datetime, timezone
from typing import Any, cast

from tracelabel.ctf.hashing import canonical_json, sha256_hex
from tracelabel.ctf.models import Json

# OTLP trace/span ids are hex-encoded byte strings: 16-byte trace id (32 hex chars),
# 8-byte span id (16 hex chars). Datadog spans always carry a `meta` dict and use
# decimal ids, so this never shadows DatadogAdapter's sniff.
_HEX_TRACE_ID = re.compile(r"^[0-9a-f]{32}$")
_HEX_SPAN_ID = re.compile(r"^[0-9a-f]{16}$")

_CHAT_OPERATIONS = {"chat", "generate_content", "text_completion"}
_RETRIEVAL_OPERATIONS = {"embeddings", "retrieve"}
_STATUS_CODE_ERROR = 2


def _is_bare_span(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and "meta" not in value
        and isinstance(value.get("traceId"), str)
        and bool(_HEX_TRACE_ID.match(value["traceId"]))
        and isinstance(value.get("spanId"), str)
        and bool(_HEX_SPAN_ID.match(value["spanId"]))
        and "startTimeUnixNano" in value
    )


def _looks_otel(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if isinstance(value.get("resourceSpans"), list):
        return True
    spans = value.get("spans")
    if isinstance(spans, list):
        return any(_is_bare_span(span) for span in spans)
    return _is_bare_span(value)


def _any_value(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    if "stringValue" in value:
        return value["stringValue"]
    if "intValue" in value:
        return int(value["intValue"])
    if "doubleValue" in value:
        return value["doubleValue"]
    if "boolValue" in value:
        return value["boolValue"]
    if "arrayValue" in value:
        return [_any_value(item) for item in value["arrayValue"].get("values", []) or []]
    if "kvlistValue" in value:
        return {
            kv["key"]: _any_value(kv.get("value"))
            for kv in value["kvlistValue"].get("values", []) or []
            if isinstance(kv, dict) and "key" in kv
        }
    return value


def _flatten_attrs(attrs: list[Json] | None) -> Json:
    result: Json = {}
    for kv in attrs or []:
        if isinstance(kv, dict) and "key" in kv:
            result[kv["key"]] = _any_value(kv.get("value"))
    return result


def _spans_from_envelope(envelope: Json) -> list[Json]:
    spans: list[Json] = []
    for resource_span in envelope.get("resourceSpans", []) or []:
        if not isinstance(resource_span, dict):
            continue
        for scope_span in resource_span.get("scopeSpans", []) or []:
            if not isinstance(scope_span, dict):
                continue
            spans.extend(s for s in scope_span.get("spans", []) or [] if isinstance(s, dict))
    return spans


def _collect_spans(value: Json) -> list[Json]:
    if isinstance(value.get("resourceSpans"), list):
        return _spans_from_envelope(value)
    spans = value.get("spans")
    if not isinstance(spans, list):
        return [value]
    # `spans` may hold whole OTLP envelopes (one per aggregated JSONL line) or
    # already-flat bare span dicts; unwrap whichever we find.
    collected: list[Json] = []
    for item in spans:
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("resourceSpans"), list):
            collected.extend(_spans_from_envelope(item))
        else:
            collected.append(item)
    return collected


def _start_nanos(span: Json) -> int:
    try:
        return int(span.get("startTimeUnixNano", 0))
    except (TypeError, ValueError):
        return 0


def _iso_from_unix_nano(nanos: Any) -> str | None:
    try:
        seconds = int(nanos) / 1_000_000_000
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _duration_ms(span: Json) -> float | None:
    start = span.get("startTimeUnixNano")
    end = span.get("endTimeUnixNano")
    if start is None or end is None:
        return None
    try:
        return (int(cast(Any, end)) - int(cast(Any, start))) / 1_000_000
    except (TypeError, ValueError):
        return None


def _as_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    return canonical_json(value)


def _parse_message_list(value: Any) -> list[Json]:
    parsed = value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
    if isinstance(parsed, list):
        return [message for message in parsed if isinstance(message, dict)]
    return []


def _normalize_semconv_message(raw: Json) -> Json:
    role = raw.get("role") or "user"
    content = raw.get("content")
    if isinstance(content, str):
        return {"role": role, "content": content}
    parts = raw.get("parts")
    if isinstance(parts, list):
        texts = [
            str(part.get("content", part.get("text", "")))
            for part in parts
            if isinstance(part, dict) and part.get("type") in (None, "text")
        ]
        return {"role": role, "content": "".join(texts)}
    return {"role": role, "content": _as_text(content) if content is not None else ""}


def _content_key(role: Any, content: Any) -> str:
    return canonical_json([role, content])


def _append_dedup(
    messages: list[Json],
    message: Json,
    seen: set[str],
    *,
    metadata: Json | None = None,
) -> None:
    key = _content_key(message.get("role"), message.get("content"))
    if key in seen:
        return
    seen.add(key)
    if metadata:
        message = {**message, "metadata": metadata}
    messages.append(message)


def _usage_metadata(attrs: Json) -> Json:
    metadata: Json = {}
    model = attrs.get("gen_ai.response.model") or attrs.get("gen_ai.request.model")
    tokens_in = attrs.get("gen_ai.usage.input_tokens")
    tokens_out = attrs.get("gen_ai.usage.output_tokens")
    if model is not None:
        metadata["model"] = model
    if tokens_in is not None:
        metadata["tokens_in"] = tokens_in
    if tokens_out is not None:
        metadata["tokens_out"] = tokens_out
    return metadata


def _chat_messages(span: Json, attrs: Json, seen: set[str]) -> list[Json]:
    messages: list[Json] = []
    usage = _usage_metadata(attrs)

    input_messages = _parse_message_list(attrs.get("gen_ai.input.messages"))
    output_messages = _parse_message_list(attrs.get("gen_ai.output.messages"))
    if input_messages or output_messages:
        for raw_message in input_messages:
            _append_dedup(messages, _normalize_semconv_message(raw_message), seen)
        for index, raw_message in enumerate(output_messages):
            is_last = index == len(output_messages) - 1
            _append_dedup(
                messages,
                _normalize_semconv_message(raw_message),
                seen,
                metadata=usage if is_last else None,
            )
        return messages

    # Legacy content capture: span events, one per prompt/completion turn.
    for event in span.get("events", []) or []:
        name = event.get("name")
        event_attrs = _flatten_attrs(event.get("attributes"))
        if name == "gen_ai.system.message":
            content = event_attrs.get("content")
            if content is not None:
                _append_dedup(messages, {"role": "system", "content": _as_text(content)}, seen)
        elif name == "gen_ai.user.message":
            content = event_attrs.get("content")
            if content is not None:
                _append_dedup(messages, {"role": "user", "content": _as_text(content)}, seen)
        elif name in ("gen_ai.assistant.message", "gen_ai.choice"):
            content = event_attrs.get("content") or event_attrs.get("message")
            if content is not None:
                _append_dedup(
                    messages,
                    {"role": "assistant", "content": _as_text(content)},
                    seen,
                    metadata=usage,
                )

    if not messages:
        prompt = attrs.get("gen_ai.content.prompt") or attrs.get("gen_ai.prompt")
        completion = attrs.get("gen_ai.content.completion") or attrs.get("gen_ai.completion")
        if prompt is not None:
            _append_dedup(messages, {"role": "user", "content": _as_text(prompt)}, seen)
        if completion is not None:
            _append_dedup(
                messages,
                {"role": "assistant", "content": _as_text(completion)},
                seen,
                metadata=usage,
            )
    return messages


def _tool_messages(span: Json, attrs: Json) -> list[Json]:
    name = attrs.get("gen_ai.tool.name") or span.get("name") or "tool"
    call_id = (
        attrs.get("gen_ai.tool.call.id")
        or span.get("spanId")
        or "call_" + sha256_hex(canonical_json(span))[:16]
    )
    arguments = attrs.get("gen_ai.tool.call.arguments")
    result = attrs.get("gen_ai.tool.call.result")
    call_message: Json = {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "id": call_id,
                "type": "function",
                "function": {
                    "name": name,
                    "arguments": _as_text(arguments) if arguments is not None else "{}",
                },
            }
        ],
    }
    tool_message: Json = {
        "role": "tool",
        "tool_call_id": call_id,
        "content": _as_text(result) if result is not None else "",
        "name": name,
    }
    return [call_message, tool_message]


def _agent_event(span: Json, attrs: Json) -> list[Json]:
    agent_name = attrs.get("gen_ai.agent.name") or span.get("name") or "agent"
    return [{"role": "event", "content": "", "kind": "agent", "name": agent_name}]


def _generic_event(span: Json, attrs: Json, kind: str) -> list[Json]:
    event: Json = {"role": "event", "content": "", "kind": kind, "name": span.get("name") or kind}
    if attrs:
        event["metadata"] = attrs
    return [event]


def _classify(attrs: Json, span_name: str | None) -> str:
    operation = attrs.get("gen_ai.operation.name")
    if operation in _CHAT_OPERATIONS:
        return "chat"
    if operation == "execute_tool" or span_name == "execute_tool":
        return "tool"
    if operation == "invoke_agent" or span_name == "invoke_agent":
        return "agent"
    if operation in _RETRIEVAL_OPERATIONS or "db.system" in attrs:
        return "retrieval"
    return "other"


def _span_to_messages(
    span: Json,
    attrs: Json,
    agent: str | None,
    seen: set[str],
    *,
    include_all_spans: bool,
) -> tuple[list[Json], Json | None]:
    kind = _classify(attrs, span.get("name"))
    if kind == "chat":
        messages = _chat_messages(span, attrs, seen)
    elif kind == "tool":
        messages = _tool_messages(span, attrs)
    elif kind == "agent":
        messages = _agent_event(span, attrs)
    elif kind == "retrieval":
        messages = _generic_event(span, attrs, "retrieval")
    elif include_all_spans:
        messages = _generic_event(span, attrs, "span")
    else:
        return [], ({span.get("name") or span.get("spanId") or "span": attrs} if attrs else None)

    common: Json = {}
    span_id = span.get("spanId")
    if span_id is not None:
        common["span_id"] = span_id
    parent_id = span.get("parentSpanId") or None
    if parent_id is not None:
        common["parent_id"] = parent_id
    started_at = _iso_from_unix_nano(span.get("startTimeUnixNano"))
    if started_at is not None:
        common["started_at"] = started_at
    duration_ms = _duration_ms(span)
    if duration_ms is not None:
        common["duration_ms"] = duration_ms
    if agent is not None:
        common["agent"] = agent

    status = span.get("status") or {}
    is_error = status.get("code") == _STATUS_CODE_ERROR
    if messages:
        messages[-1] = {**messages[-1], **common}
        if is_error:
            messages[-1]["status"] = "error"
            message_text = status.get("message")
            if isinstance(message_text, str):
                messages[-1]["status_message"] = message_text
        if agent is not None and kind == "tool":
            messages[0] = {**messages[0], "agent": agent}
    return messages, None


def _trace_from_spans(trace_id: str, spans: list[Json], *, include_all_spans: bool) -> Json:
    by_id = {span["spanId"]: span for span in spans if isinstance(span.get("spanId"), str)}
    children: dict[str | None, list[Json]] = defaultdict(list)
    parent_of: dict[str, str | None] = {}
    for span in spans:
        span_id = span.get("spanId")
        parent = span.get("parentSpanId") or None
        if parent not in by_id:
            parent = None
        if isinstance(span_id, str):
            parent_of[span_id] = parent
        children[parent].append(span)
    for group in children.values():
        group.sort(key=_start_nanos)

    agent_name_of: dict[str, str] = {}
    for span in spans:
        span_id = span.get("spanId")
        if not isinstance(span_id, str):
            continue
        attrs = _flatten_attrs(span.get("attributes"))
        agent_name = attrs.get("gen_ai.agent.name")
        if agent_name:
            agent_name_of[span_id] = str(agent_name)

    def agent_for(span_id: str | None) -> str | None:
        current = span_id
        seen_ids: set[str] = set()
        while current is not None and current not in seen_ids:
            seen_ids.add(current)
            if current in agent_name_of:
                return agent_name_of[current]
            current = parent_of.get(current)
        return None

    ordered: list[Json] = []

    def visit(span: Json) -> None:
        ordered.append(span)
        span_id = span.get("spanId")
        for child in children.get(span_id if isinstance(span_id, str) else None, []):
            visit(child)

    for root in children.get(None, []):
        visit(root)

    messages: list[Json] = []
    seen_content: set[str] = set()
    unmapped: Json = {}
    for span in ordered:
        attrs = _flatten_attrs(span.get("attributes"))
        span_id = span.get("spanId")
        rows, dropped = _span_to_messages(
            span,
            attrs,
            agent_for(span_id if isinstance(span_id, str) else None),
            seen_content,
            include_all_spans=include_all_spans,
        )
        messages.extend(rows)
        if dropped:
            unmapped.update(dropped)

    trace: Json = {"id": trace_id, "source": "otel", "messages": messages}
    if unmapped:
        trace["raw"] = {"otel_spans": unmapped}
    return trace


class OtelAdapter:
    name = "otel"
    aggregates_input = True

    def __init__(self, *, include_all_spans: bool = False) -> None:
        self._include_all_spans = include_all_spans

    def sniff(self, first_values: list[Any]) -> bool:
        return bool(first_values) and _looks_otel(first_values[0])

    def to_ctf(self, value: Any) -> Iterator[Json]:
        groups: dict[str, list[Json]] = {}
        order: list[str] = []
        for span in _collect_spans(cast(Json, value)):
            trace_id = str(span.get("traceId") or "")
            if trace_id not in groups:
                groups[trace_id] = []
                order.append(trace_id)
            groups[trace_id].append(span)
        for trace_id in order:
            yield _trace_from_spans(
                trace_id, groups[trace_id], include_all_spans=self._include_all_spans
            )
