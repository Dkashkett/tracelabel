from collections.abc import Callable
from typing import Any, NamedTuple

from tracelabel.errors import UserError

from .hashing import canonical_json
from .models import DocumentIn, Json, TraceIn

VALID_ROLES = ("system", "user", "assistant", "tool")
DOCUMENT_CONTENT_TYPES = ("text", "json", "html", "markdown")
TRACE_KEYS = {"format_version", "id", "source", "metadata", "messages", "raw"}
DOCUMENT_KEYS = {"format_version", "id", "source", "metadata", "content", "content_type", "raw"}
MESSAGE_KEYS = {"role", "content", "tool_calls", "tool_call_id", "name", "metadata", "raw"}

GENERIC_FIXED_EXAMPLE = (
    '{"role":"assistant","content":"","tool_calls":[{"id":"c1","type":"function",'
    '"function":{"name":"quote","arguments":"{\\"ticker\\":\\"AAPL\\"}"}}]}'
)


class CtfError(UserError):
    def __init__(
        self,
        file: str,
        line: int,
        rule: str,
        detail: str,
        fixed_example: str | None = None,
    ) -> None:
        self.file = file
        self.line = line
        self.rule = rule
        self.detail = detail
        self.fixed_example = fixed_example
        super().__init__(str(self))

    def __str__(self) -> str:
        lines = [f"{self.file}:{self.line} — {self.detail}"]
        if self.rule:
            lines.append(self.rule)
        if self.fixed_example is not None:
            lines.extend(("Fixed, it would be:", "", f"  {self.fixed_example}"))
        return "\n".join(lines) + "\n"


class MistakePattern(NamedTuple):
    matcher: Callable[[Any], bool]
    fixed_example: Callable[[Any], str]


def _is_message(value: Any) -> bool:
    return isinstance(value, dict)


KNOWN_MISTAKES = (
    MistakePattern(
        matcher=lambda value: _is_message(value) and value.get("role") == "function",
        fixed_example=lambda _value: (
            '{"role": "tool", "tool_call_id": "call_abc", "content": "{...}"}'
        ),
    ),
    MistakePattern(
        matcher=lambda value: isinstance(value, dict) and isinstance(value.get("messages"), str),
        fixed_example=lambda _value: '{"messages": [{"role": "user", "content": "..."}]}',
    ),
    MistakePattern(
        matcher=lambda value: _is_message(value) and "role" in value and "content" not in value,
        fixed_example=lambda value: canonical_json({**value, "content": "..."}),
    ),
)


class CtfValidator:
    def fold_unknown_keys(self, trace: Json) -> tuple[Json, list[str]]:
        if "messages" not in trace and "content" in trace:
            return self._fold_document(trace)

        warnings: list[str] = []
        folded: Json = {}
        extra_raw: Json = {}
        for key, value in trace.items():
            if key in TRACE_KEYS:
                folded[key] = value
            else:
                extra_raw[key] = value
                warnings.append(f'unknown trace key "{key}" moved to raw')

        messages = folded.get("messages")
        if isinstance(messages, list):
            folded["messages"] = [
                self._fold_message(message, warnings) if isinstance(message, dict) else message
                for message in messages
            ]

        if extra_raw:
            existing = folded.get("raw")
            folded["raw"] = {**extra_raw, **existing} if isinstance(existing, dict) else extra_raw
        return folded, warnings

    @staticmethod
    def _fold_document(document: Json) -> tuple[Json, list[str]]:
        warnings: list[str] = []
        folded: Json = {}
        extra_raw: Json = {}
        for key, value in document.items():
            if key in DOCUMENT_KEYS:
                folded[key] = value
            else:
                extra_raw[key] = value
                warnings.append(f'unknown document key "{key}" moved to raw')
        if extra_raw:
            existing = folded.get("raw")
            folded["raw"] = {**extra_raw, **existing} if isinstance(existing, dict) else extra_raw
        return folded, warnings

    def validate_line(self, value: object, file: str, line_number: int) -> TraceIn | DocumentIn:
        def fail(rule: str, detail: str, fixed_from: Any) -> CtfError:
            return CtfError(
                file,
                line_number,
                rule,
                detail,
                self._fixed_example_for(fixed_from),
            )

        if not isinstance(value, dict):
            raise fail(
                "Each line must be a JSON object (a trace).",
                "line is not a JSON object.",
                value,
            )

        format_version = value.get("format_version", 1)
        if format_version != 1:
            if isinstance(format_version, int) and format_version > 1:
                raise fail(
                    "This build understands format_version 1. Please upgrade tracelabel.",
                    f"format_version is {format_version}, which is newer than this build "
                    "understands.",
                    value,
                )
            raise fail(
                "format_version, if present, must equal 1.",
                f"format_version is {format_version!r}, which is not 1.",
                value,
            )

        if "messages" not in value and "content" in value:
            return self._validate_document(value, fail)

        messages = value.get("messages")
        if "messages" not in value:
            raise fail(
                "A trace must have a non-empty messages array.",
                "trace has no messages key.",
                value,
            )
        if isinstance(messages, str):
            raise fail(
                "messages must be an array of message objects, not a string.",
                "messages is a JSON string, not an array.",
                value,
            )
        if not isinstance(messages, list) or not messages:
            raise fail(
                "A trace must have a non-empty messages array.",
                "messages is empty.",
                value,
            )

        for index, message in enumerate(messages):
            if not isinstance(message, dict):
                raise fail(
                    "Every message must be a JSON object.",
                    f"message[{index}] is not an object.",
                    message,
                )
            role = message.get("role")
            if role not in VALID_ROLES:
                raise fail(
                    f"Valid roles: {', '.join(VALID_ROLES)}.",
                    f"message[{index}] has role {role!r}, which is not a valid role.",
                    message,
                )
            if "content" not in message:
                raise fail(
                    'Every message must have a "content" key.',
                    f"message[{index}] has no content key.",
                    message,
                )

        for index, message in enumerate(messages):
            role = message.get("role")
            if message.get("tool_calls") is not None and role != "assistant":
                raise fail(
                    "tool_calls may only appear on assistant messages.",
                    f"message[{index}] has role {role!r} but carries tool_calls.",
                    message,
                )
            if message.get("tool_call_id") is not None and role != "tool":
                raise fail(
                    "tool_call_id may only appear on tool messages.",
                    f"message[{index}] has role {role!r} but carries tool_call_id.",
                    message,
                )

        for index, message in enumerate(messages):
            if message.get("content") == "":
                tool_calls = message.get("tool_calls")
                if not isinstance(tool_calls, list) or not tool_calls:
                    raise fail(
                        'content may be "" only on an assistant message carrying tool_calls.',
                        f"message[{index}] has empty content but no tool_calls.",
                        message,
                    )

        try:
            return TraceIn.model_validate(value)
        except ValueError as error:
            raise fail(
                "messages must follow the CTF v1 shape.",
                f"trace does not match the CTF v1 schema: {error}",
                value,
            ) from error

    @staticmethod
    def _validate_document(value: Json, fail: Callable[[str, str, Any], CtfError]) -> DocumentIn:
        content = value.get("content")
        if not isinstance(content, str):
            raise fail(
                'A document\'s "content" must be a string.',
                "content is not a string.",
                value,
            )

        content_type = value.get("content_type")
        if content_type is not None and content_type not in DOCUMENT_CONTENT_TYPES:
            raise fail(
                f"Valid content types: {', '.join(DOCUMENT_CONTENT_TYPES)}.",
                f"content_type is {content_type!r}, which is not valid.",
                value,
            )

        try:
            return DocumentIn.model_validate(value)
        except ValueError as error:
            raise fail(
                "content must follow the CTF v1 document shape.",
                f"document does not match the CTF v1 schema: {error}",
                value,
            ) from error

    @staticmethod
    def _fold_message(message: Json, warnings: list[str]) -> Json:
        folded: Json = {}
        extra_raw: Json = {}
        for key, value in message.items():
            if key in MESSAGE_KEYS:
                folded[key] = value
            else:
                extra_raw[key] = value
                warnings.append(f'unknown message key "{key}" moved to raw')
        if extra_raw:
            existing = folded.get("raw")
            folded["raw"] = {**extra_raw, **existing} if isinstance(existing, dict) else extra_raw
        return folded

    @staticmethod
    def _fixed_example_for(value: Any) -> str:
        for pattern in KNOWN_MISTAKES:
            if pattern.matcher(value):
                return pattern.fixed_example(value)
        return GENERIC_FIXED_EXAMPLE
