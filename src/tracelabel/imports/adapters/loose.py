from collections import Counter
from collections.abc import Iterator
from typing import Any

from tracelabel.ctf.models import Json

_ROLE_SYNONYMS = {
    "human": "user",
    "ai": "assistant",
    "bot": "assistant",
    "agent": "assistant",
}
_ALIAS_KEYS = ("conversation", "turns", "chat")


class UnsupportedLooseInput(Exception):
    pass


def _deduplicate(notes: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for note in notes:
        if note not in seen:
            seen.add(note)
            unique.append(note)
    return unique


def _normalize_message(message: Any) -> tuple[Any, list[str]]:
    notes: list[str] = []
    if not isinstance(message, dict):
        return message, notes
    normalized = dict(message)
    if "role" not in normalized:
        for key in ("speaker", "from"):
            if key in normalized:
                normalized["role"] = normalized.pop(key)
                notes.append(f'interpreted "{key}" as "role"')
                break
    role = normalized.get("role")
    if isinstance(role, str):
        mapped = _ROLE_SYNONYMS.get(role.lower())
        if mapped is not None and mapped != role:
            normalized["role"] = mapped
            notes.append("mapped role synonyms to CTF roles")
    return normalized, notes


def _langsmith_output(outputs: Any) -> Any:
    if isinstance(outputs, str):
        return outputs
    if isinstance(outputs, dict):
        messages = outputs.get("messages")
        if isinstance(messages, list) and messages and isinstance(messages[-1], dict):
            if "content" in messages[-1]:
                return messages[-1]["content"]
        if isinstance(outputs.get("content"), str):
            return outputs["content"]
        if isinstance(outputs.get("output"), str):
            return outputs["output"]
    return None


def _map(value: Any) -> tuple[Json, list[str]]:
    if isinstance(value, str):
        return {
            "messages": [{"role": "document", "content": value}],
            "source": "loose",
        }, ["interpreted plain strings as documents"]
    if isinstance(value, list):
        return _finish(value, ["interpreted a bare message list as a trace"], None)
    if isinstance(value, dict):
        for key in _ALIAS_KEYS:
            if isinstance(value.get(key), list):
                extra = {name: item for name, item in value.items() if name != key}
                return _finish(
                    value[key],
                    [f'interpreted "{key}" as "messages"'],
                    extra or None,
                )
        if isinstance(value.get("messages"), list):
            extra = {key: item for key, item in value.items() if key != "messages"}
            return _finish(value["messages"], [], extra or None)
        if isinstance(value.get("inputs"), dict) or "outputs" in value:
            return _langsmith(value)
    raise UnsupportedLooseInput


def _finish(messages: Any, notes: list[str], extra_raw: Json | None) -> tuple[Json, list[str]]:
    output_messages: list[Any] = []
    for message in messages:
        normalized, message_notes = _normalize_message(message)
        notes.extend(message_notes)
        output_messages.append(normalized)
    trace: Json = {"messages": output_messages, "source": "loose"}
    if extra_raw:
        trace["raw"] = extra_raw
    return trace, _deduplicate(notes)


def _langsmith(value: Json) -> tuple[Json, list[str]]:
    notes = ["interpreted a LangSmith run as messages"]
    output_messages: list[Any] = []
    inputs = value.get("inputs") or {}
    for message in inputs.get("messages", []) or []:
        normalized, message_notes = _normalize_message(message)
        notes.extend(message_notes)
        output_messages.append(normalized)
    text = _langsmith_output(value.get("outputs"))
    if text is not None:
        output_messages.append({"role": "assistant", "content": text})
    raw = {key: item for key, item in value.items() if key not in ("inputs", "outputs")}
    if isinstance(inputs, dict):
        input_extras = {key: item for key, item in inputs.items() if key != "messages"}
        if input_extras:
            raw["inputs"] = input_extras
    trace: Json = {"messages": output_messages, "source": "loose"}
    if raw:
        trace["raw"] = raw
    return trace, _deduplicate(notes)


class LooseAdapter:
    name = "loose"

    def __init__(self) -> None:
        self._counts: Counter[str] = Counter()

    def sniff(self, first_values: list[Any]) -> bool:
        if not first_values:
            return False
        try:
            _map(first_values[0])
        except UnsupportedLooseInput:
            return False
        return True

    def to_ctf(self, value: Any) -> Iterator[Json]:
        trace, notes = _map(value)
        for note in notes:
            self._counts[note] += 1
        yield trace

    def notes(self) -> list[str]:
        return [
            f"{note} on {count} line{'s' if count != 1 else ''}"
            for note, count in self._counts.items()
        ]
