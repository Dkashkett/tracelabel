import hashlib
import json
from typing import Any, Callable, Literal, NamedTuple

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .errors import UserError

Json = dict[str, Any]

VALID_ROLES = ("system", "user", "assistant", "tool", "document")

# The generic tool-use snippet from 01 §8, used as the fallback fixed example.
GENERIC_FIXED_EXAMPLE = (
    '{"role":"assistant","content":"","tool_calls":[{"id":"c1","type":"function",'
    '"function":{"name":"quote","arguments":"{\\"ticker\\":\\"AAPL\\"}"}}]}'
)


def canonical_json(x: Any) -> str:
    return json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _parses_as_json(t: str) -> bool:
    try:
        json.loads(t)
        return True
    except (ValueError, TypeError):
        return False


def detect_content_type(s: str) -> Literal["text", "json", "html"]:
    t = s.strip()
    if t.startswith(("{", "[")) and _parses_as_json(t):
        return "json"
    if t[:15].lower().startswith(("<!doctype html", "<html")):
        return "html"
    return "text"


def content_type_of(content: str | list[Json]) -> Literal["text", "json", "html", "parts"]:
    if isinstance(content, str):
        return detect_content_type(content)
    return "parts"


def serialize_content(content: str | list[Json]) -> str:
    # Strings are stored byte-for-byte (invariant #1); only the parts array *wrapper* is ours
    # to serialize deterministically — the strings inside the parts are never touched.
    if isinstance(content, str):
        return content
    return canonical_json(content)


def derive_trace_id(messages: list[Json]) -> str:
    # Hash input is the parsed post-adapter message dicts, never a Pydantic dump (01 §6).
    return "t_" + sha256_hex(canonical_json(messages))[:32]


def content_hash(messages: list[Json]) -> str:
    return sha256_hex(canonical_json(messages))


class ToolCallFunction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    arguments: str


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    type: Literal["function"]
    function: ToolCallFunction


class ContentPart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["text", "json", "html"]
    text: str | None = None
    json_string: str | None = None
    html: str | None = None

    @model_validator(mode="after")
    def _exactly_matching_field(self) -> "ContentPart":
        field = {"text": "text", "json": "json_string", "html": "html"}[self.type]
        for name in ("text", "json_string", "html"):
            value = getattr(self, name)
            if name == field and value is None:
                raise ValueError(f'part of type "{self.type}" must set "{field}"')
            if name != field and value is not None:
                raise ValueError(f'part of type "{self.type}" must not set "{name}"')
        return self


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    role: Literal["system", "user", "assistant", "tool", "document"]
    content: str | list[ContentPart]
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    metadata: Json = {}
    raw: Json | None = None


class TraceIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    format_version: int = 1
    id: str | None = None
    source: str | None = None
    metadata: Json = {}
    messages: list[MessageIn] = Field(min_length=1)
    raw: Json | None = None


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
            lines.append("Fixed, it would be:")
            lines.append("")
            lines.append(f"  {self.fixed_example}")
        return "\n".join(lines) + "\n"


class MistakePattern(NamedTuple):
    matcher: Callable[[Any], bool]
    rule_name: str
    fixed_example: Callable[[Any], str]


def _is_message(obj: Any) -> bool:
    return isinstance(obj, dict)


KNOWN_MISTAKES: list[MistakePattern] = [
    MistakePattern(
        matcher=lambda o: _is_message(o) and o.get("role") == "function",
        rule_name="legacy_function_role",
        fixed_example=lambda o: '{"role": "tool", "tool_call_id": "call_abc", "content": "{...}"}',
    ),
    MistakePattern(
        matcher=lambda o: isinstance(o, dict) and isinstance(o.get("messages"), str),
        rule_name="stringified_messages",
        fixed_example=lambda o: '{"messages": [{"role": "user", "content": "..."}]}',
    ),
    MistakePattern(
        matcher=lambda o: _is_message(o) and "role" in o and "content" not in o,
        rule_name="missing_content",
        fixed_example=lambda o: canonical_json({**o, "content": "..."}),
    ),
]


def _fixed_example_for(obj_or_msg: Any) -> str:
    for pattern in KNOWN_MISTAKES:
        if pattern.matcher(obj_or_msg):
            return pattern.fixed_example(obj_or_msg)
    return GENERIC_FIXED_EXAMPLE


TRACE_KEYS = {"format_version", "id", "source", "metadata", "messages", "raw"}
MESSAGE_KEYS = {"role", "content", "tool_calls", "tool_call_id", "name", "metadata", "raw"}


def fold_unknown_keys(obj: Json) -> tuple[Json, list[str]]:
    warnings: list[str] = []
    folded: Json = {}
    extra_raw: Json = {}
    for key, value in obj.items():
        if key in TRACE_KEYS:
            folded[key] = value
        else:
            extra_raw[key] = value
            warnings.append(f'unknown trace key "{key}" moved to raw')

    messages = folded.get("messages")
    if isinstance(messages, list):
        new_messages: list[Any] = []
        for msg in messages:
            if isinstance(msg, dict):
                new_messages.append(_fold_message(msg, warnings))
            else:
                new_messages.append(msg)
        folded["messages"] = new_messages

    if extra_raw:
        existing = folded.get("raw")
        folded["raw"] = {**extra_raw, **existing} if isinstance(existing, dict) else extra_raw

    return folded, warnings


def _fold_message(msg: Json, warnings: list[str]) -> Json:
    folded: Json = {}
    extra_raw: Json = {}
    for key, value in msg.items():
        if key in MESSAGE_KEYS:
            folded[key] = value
        else:
            extra_raw[key] = value
            warnings.append(f'unknown message key "{key}" moved to raw')
    if extra_raw:
        existing = folded.get("raw")
        folded["raw"] = {**extra_raw, **existing} if isinstance(existing, dict) else extra_raw
    return folded


def validate_ctf_line(obj: Json, file: str, line_no: int) -> TraceIn:
    # Rule 6 (duplicate id within one file) needs file scope and lives in the P4 pipeline's
    # import_file, not here.
    def fail(rule: str, detail: str, fixed_from: Any) -> CtfError:
        return CtfError(file, line_no, rule, detail, _fixed_example_for(fixed_from))

    if not isinstance(obj, dict):
        raise fail(
            "Each line must be a JSON object (a trace).",
            "line is not a JSON object.",
            obj,
        )

    # format_version first: a v2 file should say "upgrade tracelabel", not fail rule 1
    # (01 §7.5, §9).
    fv = obj.get("format_version", 1)
    if fv != 1:
        if isinstance(fv, int) and fv > 1:
            raise fail(
                "This build understands format_version 1. Please upgrade tracelabel.",
                f"format_version is {fv}, which is newer than this build understands.",
                obj,
            )
        raise fail(
            "format_version, if present, must equal 1.",
            f"format_version is {fv!r}, which is not 1.",
            obj,
        )

    # Rule 1: messages present, non-empty, every element has a valid role and a content key.
    messages = obj.get("messages")
    if "messages" not in obj:
        raise fail(
            "A trace must have a non-empty messages array.",
            "trace has no messages key.",
            obj,
        )
    if isinstance(messages, str):
        raise fail(
            "messages must be an array of message objects, not a string.",
            "messages is a JSON string, not an array.",
            obj,
        )
    if not isinstance(messages, list) or len(messages) == 0:
        raise fail(
            "A trace must have a non-empty messages array.",
            "messages is empty.",
            obj,
        )
    for i, msg in enumerate(messages):
        if not isinstance(msg, dict):
            raise fail(
                "Every message must be a JSON object.",
                f"message[{i}] is not an object.",
                msg,
            )
        role = msg.get("role")
        if role not in VALID_ROLES:
            raise fail(
                f"Valid roles: {', '.join(VALID_ROLES)}.",
                f"message[{i}] has role {role!r}, which is not a valid role.",
                msg,
            )
        if "content" not in msg:
            raise fail(
                'Every message must have a "content" key.',
                f"message[{i}] has no content key.",
                msg,
            )

    # Rule 2: tool_calls only on assistant; tool_call_id only on tool.
    for i, msg in enumerate(messages):
        role = msg.get("role")
        if msg.get("tool_calls") is not None and role != "assistant":
            raise fail(
                "tool_calls may only appear on assistant messages.",
                f"message[{i}] has role {role!r} but carries tool_calls.",
                msg,
            )
        if msg.get("tool_call_id") is not None and role != "tool":
            raise fail(
                "tool_call_id may only appear on tool messages.",
                f"message[{i}] has role {role!r} but carries tool_call_id.",
                msg,
            )

    # Rule 3: content == "" only when tool_calls is present and non-empty.
    for i, msg in enumerate(messages):
        if msg.get("content") == "":
            tool_calls = msg.get("tool_calls")
            if not (isinstance(tool_calls, list) and len(tool_calls) > 0):
                raise fail(
                    'content may be "" only on an assistant message carrying tool_calls.',
                    f"message[{i}] has empty content but no tool_calls.",
                    msg,
                )

    # Rule 4: a document role may only appear in single-message traces.
    if any(msg.get("role") == "document" for msg in messages) and len(messages) > 1:
        raise fail(
            "A document may only appear as the single message of a trace.",
            "a document role appears in a multi-message trace.",
            obj,
        )

    try:
        return TraceIn(**obj)
    except ValueError as e:
        raise fail(
            "messages must follow the CTF v1 shape.",
            f"trace does not match the CTF v1 schema: {e}",
            obj,
        ) from e
