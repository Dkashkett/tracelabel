from collections.abc import Iterator
from typing import Any

from ..ctf import Json, canonical_json, sha256_hex

_SESSION_KNOWN = {"id", "appName", "userId", "events"}
_EVENT_KNOWN = {"author", "content", "invocationId", "invocation_id"}


def _is_adk(o: Any) -> bool:
    if not isinstance(o, dict):
        return False
    events = o.get("events")
    if not isinstance(events, list):
        return False
    if not events:
        # empty events list still identifies an ADK session envelope
        return any(k in o for k in ("appName", "userId", "id"))
    return any(
        isinstance(e, dict) and ("author" in e or "invocationId" in e or "invocation_id" in e)
        for e in events
    )


def _raw_json_string(v: Any) -> str:
    # ADK gives parsed objects; the raw string is CREATED here (canonical_json), never a
    # reformat of an existing string — invariant #1 holds. An already-string value is kept
    # verbatim.
    if isinstance(v, str):
        return v
    return canonical_json(v)


def _synth_id(function_call: Json) -> str:
    return "call_" + sha256_hex(canonical_json(function_call))[:16]


def _unmapped(obj: Json, known: set[str]) -> Json | None:
    extra = {k: v for k, v in obj.items() if k not in known}
    return extra or None


def _match_call_id(response: Json, msgs: list[Json]) -> str | None:
    name = response.get("name")
    for m in reversed(msgs):
        for call in m.get("tool_calls", []) or []:
            if call["function"]["name"] == name:
                return str(call["id"])
    return None


def _session_to_ctf(session: Json) -> Json:
    msgs: list[Json] = []
    for ev in session.get("events", []):
        if not isinstance(ev, dict):
            continue
        author = ev.get("author")
        role = "user" if author == "user" else "assistant"
        parts = (ev.get("content") or {}).get("parts", []) or []

        text = "".join(p["text"] for p in parts if isinstance(p, dict) and "text" in p)
        calls: list[Json] = []
        for p in parts:
            if isinstance(p, dict) and "function_call" in p:
                fc = p["function_call"]
                calls.append(
                    {
                        "id": fc.get("id") or _synth_id(fc),
                        "type": "function",
                        "function": {
                            "name": fc["name"],
                            "arguments": _raw_json_string(fc.get("args", {})),
                        },
                    }
                )
        resps = [
            p["function_response"]
            for p in parts
            if isinstance(p, dict) and "function_response" in p
        ]

        if text or calls:
            msg: Json = {"role": role, "content": text}
            if calls:
                msg["tool_calls"] = calls
            if role == "assistant" and author is not None:
                msg["name"] = author
            inv = ev.get("invocationId") or ev.get("invocation_id")
            if inv is not None:
                msg["metadata"] = {"invocation_id": inv}
            raw = _unmapped(ev, _EVENT_KNOWN)
            if raw is not None:
                msg["raw"] = raw
            msgs.append(msg)

        for r in resps:
            tmsg: Json = {"role": "tool", "content": _raw_json_string(r.get("response"))}
            call_id = r.get("id") or _match_call_id(r, msgs)
            if call_id is not None:
                tmsg["tool_call_id"] = call_id
            if r.get("name") is not None:
                tmsg["name"] = r["name"]
            msgs.append(tmsg)

    trace: Json = {"source": "adk", "messages": msgs}
    if session.get("id") is not None:
        trace["id"] = session["id"]
    metadata = {
        k: v
        for k, v in (("app_name", session.get("appName")), ("user_id", session.get("userId")))
        if v is not None
    }
    if metadata:
        trace["metadata"] = metadata
    raw = _unmapped(session, _SESSION_KNOWN)
    if raw is not None:
        trace["raw"] = raw
    return trace


class AdkAdapter:
    name = "adk"

    def sniff(self, first_lines: list[Any]) -> bool:
        return bool(first_lines) and _is_adk(first_lines[0])

    def to_ctf(self, obj: Json) -> Iterator[Json]:
        yield _session_to_ctf(obj)
