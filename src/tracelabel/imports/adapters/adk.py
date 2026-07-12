from collections.abc import Iterator
from typing import Any, cast

from tracelabel.ctf.hashing import canonical_json, sha256_hex
from tracelabel.ctf.models import Json

_SESSION_KNOWN = {"id", "appName", "userId", "events"}
_EVENT_KNOWN = {"author", "content", "invocationId", "invocation_id"}


def _is_adk(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    events = value.get("events")
    if not isinstance(events, list):
        return False
    if not events:
        return any(key in value for key in ("appName", "userId", "id"))
    return any(
        isinstance(event, dict)
        and ("author" in event or "invocationId" in event or "invocation_id" in event)
        for event in events
    )


def _raw_json_string(value: Any) -> str:
    if isinstance(value, str):
        return value
    return canonical_json(value)


def _synthesized_id(function_call: Json) -> str:
    return "call_" + sha256_hex(canonical_json(function_call))[:16]


def _unmapped(value: Json, known: set[str]) -> Json | None:
    extra = {key: item for key, item in value.items() if key not in known}
    return extra or None


def _matching_call_id(response: Json, messages: list[Json]) -> str | None:
    name = response.get("name")
    for message in reversed(messages):
        for call in message.get("tool_calls", []) or []:
            if call["function"]["name"] == name:
                return str(call["id"])
    return None


def _session_to_ctf(session: Json) -> Json:
    messages: list[Json] = []
    for event in session.get("events", []):
        if not isinstance(event, dict):
            continue
        author = event.get("author")
        role = "user" if author == "user" else "assistant"
        parts = (event.get("content") or {}).get("parts", []) or []
        text = "".join(part["text"] for part in parts if isinstance(part, dict) and "text" in part)
        calls: list[Json] = []
        for part in parts:
            if isinstance(part, dict) and "function_call" in part:
                function_call = part["function_call"]
                calls.append(
                    {
                        "id": function_call.get("id") or _synthesized_id(function_call),
                        "type": "function",
                        "function": {
                            "name": function_call["name"],
                            "arguments": _raw_json_string(function_call.get("args", {})),
                        },
                    }
                )
        responses = [
            part["function_response"]
            for part in parts
            if isinstance(part, dict) and "function_response" in part
        ]

        if text or calls:
            message: Json = {"role": role, "content": text}
            if calls:
                message["tool_calls"] = calls
            if role == "assistant" and author is not None:
                message["name"] = author
            invocation = event.get("invocationId") or event.get("invocation_id")
            if invocation is not None:
                message["metadata"] = {"invocation_id": invocation}
            raw = _unmapped(event, _EVENT_KNOWN)
            if raw is not None:
                message["raw"] = raw
            messages.append(message)

        for response in responses:
            tool_message: Json = {
                "role": "tool",
                "content": _raw_json_string(response.get("response")),
            }
            call_id = response.get("id") or _matching_call_id(response, messages)
            if call_id is not None:
                tool_message["tool_call_id"] = call_id
            if response.get("name") is not None:
                tool_message["name"] = response["name"]
            messages.append(tool_message)

    trace: Json = {"source": "adk", "messages": messages}
    if session.get("id") is not None:
        trace["id"] = session["id"]
    metadata = {
        key: value
        for key, value in (
            ("app_name", session.get("appName")),
            ("user_id", session.get("userId")),
        )
        if value is not None
    }
    if metadata:
        trace["metadata"] = metadata
    raw = _unmapped(session, _SESSION_KNOWN)
    if raw is not None:
        trace["raw"] = raw
    return trace


class AdkAdapter:
    name = "adk"

    def sniff(self, first_values: list[Any]) -> bool:
        return bool(first_values) and _is_adk(first_values[0])

    def to_ctf(self, value: Any) -> Iterator[Json]:
        yield _session_to_ctf(cast(Json, value))
