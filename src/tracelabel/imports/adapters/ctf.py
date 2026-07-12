from collections.abc import Iterator
from typing import Any

from tracelabel.ctf.models import Json


def _looks_like_ctf(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    messages = value.get("messages")
    if not isinstance(messages, list) or not messages:
        return False
    return all(isinstance(message, dict) and "role" in message for message in messages)


class CtfAdapter:
    name = "ctf"

    def sniff(self, first_values: list[Any]) -> bool:
        return bool(first_values) and _looks_like_ctf(first_values[0])

    def to_ctf(self, value: Any) -> Iterator[Json]:
        if isinstance(value, dict):
            yield value
