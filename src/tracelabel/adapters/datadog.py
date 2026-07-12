from collections.abc import Iterator
from typing import Any

from ..ctf import Json, canonical_json, sha256_hex

_SPAN_MAPPED_META = {"kind", "name", "input", "output"}


def _is_span(o: Any) -> bool:
    return (
        isinstance(o, dict)
        and isinstance(o.get("meta"), dict)
        and ("trace_id" in o or "traceId" in o)
    )


def _looks_datadog(o: Any) -> bool:
    if not isinstance(o, dict):
        return False
    spans = o.get("spans")
    if isinstance(spans, list):
        return any(_is_span(s) for s in spans)
    return _is_span(o)


def _extract_spans(obj: Json) -> list[Json]:
    spans = obj.get("spans")
    if isinstance(spans, list):
        out: list[Json] = []
        for s in spans:
            if isinstance(s, dict) and isinstance(s.get("spans"), list):
                out.extend(s["spans"])
            else:
                out.append(s)
        return out
    return [obj]


def _raw_json_string(v: Any) -> str:
    if isinstance(v, str):
        return v
    return canonical_json(v)


def _span_metadata(s: Json) -> Json:
    md = {
        k: s.get(k) for k in ("span_id", "trace_id", "start_ns", "duration") if s.get(k) is not None
    }
    return md


def _content_key(role: Any, content: Any) -> str:
    return canonical_json([role, content])


def _tool_value(meta: Json, side: str) -> Any:
    block = meta.get(side) or {}
    if isinstance(block, dict):
        if "value" in block:
            return block["value"]
        return block
    return block


def _trace_from_spans(trace_id: str, spans: list[Json]) -> Json:
    spans = sorted(spans, key=lambda s: s.get("start_ns", 0))
    msgs: list[Json] = []
    seen: set[str] = set()
    unmapped_meta: Json = {}

    for s in spans:
        meta = s.get("meta") or {}
        kind = meta.get("kind")
        span_md = _span_metadata(s)

        if kind == "tool":
            call_id = s.get("span_id") or "call_" + sha256_hex(canonical_json(s))[:16]
            name = meta.get("name") or s.get("name")
            args = _raw_json_string(_tool_value(meta, "input"))
            result = _raw_json_string(_tool_value(meta, "output"))
            fn = {"name": name, "arguments": args}
            call = {"id": call_id, "type": "function", "function": fn}
            call_msg: Json = {"role": "assistant", "content": "", "tool_calls": [call]}
            if span_md:
                call_msg["metadata"] = span_md
            msgs.append(call_msg)
            tool_msg: Json = {"role": "tool", "tool_call_id": call_id, "content": result}
            if name is not None:
                tool_msg["name"] = name
            if span_md:
                tool_msg["metadata"] = span_md
            msgs.append(tool_msg)
        elif kind == "llm":
            for m in (meta.get("input") or {}).get("messages", []) or []:
                key = _content_key(m.get("role"), m.get("content"))
                if key in seen:
                    continue
                seen.add(key)
                msgs.append({"role": m.get("role"), "content": m.get("content")})
            for m in (meta.get("output") or {}).get("messages", []) or []:
                key = _content_key(m.get("role"), m.get("content"))
                if key in seen:
                    continue
                seen.add(key)
                out_msg: Json = {"role": m.get("role"), "content": m.get("content")}
                if span_md:
                    out_msg["metadata"] = span_md
                msgs.append(out_msg)
        else:
            extra = {k: v for k, v in meta.items() if k not in _SPAN_MAPPED_META}
            if extra:
                unmapped_meta[s.get("span_id") or trace_id] = extra

    trace: Json = {"id": trace_id, "source": "datadog", "messages": msgs}
    if unmapped_meta:
        trace["raw"] = {"datadog_spans": unmapped_meta}
    return trace


class DatadogAdapter:
    name = "datadog"

    def sniff(self, first_lines: list[Any]) -> bool:
        return bool(first_lines) and _looks_datadog(first_lines[0])

    def to_ctf(self, obj: Json) -> Iterator[Json]:
        groups: dict[str, list[Json]] = {}
        order: list[str] = []
        for s in _extract_spans(obj):
            if not isinstance(s, dict):
                continue
            tid = str(s.get("trace_id") or s.get("traceId") or "")
            if tid not in groups:
                groups[tid] = []
                order.append(tid)
            groups[tid].append(s)
        for tid in order:
            yield _trace_from_spans(tid, groups[tid])
