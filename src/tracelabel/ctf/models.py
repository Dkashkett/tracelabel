from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Json = dict[str, Any]
Role = Literal["system", "user", "assistant", "tool", "event"]
Kind = Literal["handoff", "retrieval", "agent", "guardrail", "span"]
Status = Literal["ok", "error"]
ContentType = Literal["text", "json", "html", "parts"]
DocumentContentType = Literal["text", "json", "html", "markdown"]


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
        matching_field = {"text": "text", "json": "json_string", "html": "html"}[self.type]
        for field_name in ("text", "json_string", "html"):
            value = getattr(self, field_name)
            if field_name == matching_field and value is None:
                raise ValueError(f'part of type "{self.type}" must set "{matching_field}"')
            if field_name != matching_field and value is not None:
                raise ValueError(f'part of type "{self.type}" must not set "{field_name}"')
        return self


class MessageIn(BaseModel):
    model_config = ConfigDict(extra="allow")

    role: Role
    content: str | list[ContentPart]
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    metadata: Json = Field(default_factory=dict)
    raw: Json | None = None
    span_id: str | None = None
    parent_id: str | None = None
    agent: str | None = None
    kind: Kind | None = None
    started_at: str | None = None
    duration_ms: float | None = None
    status: Status | None = None
    status_message: str | None = None

    @model_validator(mode="after")
    def _kind_required_iff_event(self) -> "MessageIn":
        if self.role == "event" and self.kind is None:
            raise ValueError('role "event" requires a "kind"')
        if self.role != "event" and self.kind is not None:
            raise ValueError('"kind" may only be set on role "event"')
        return self


class TraceIn(BaseModel):
    model_config = ConfigDict(extra="allow")

    format_version: int = 2
    id: str | None = None
    source: str | None = None
    metadata: Json = Field(default_factory=dict)
    messages: list[MessageIn] = Field(min_length=1)
    raw: Json | None = None


class DocumentIn(BaseModel):
    model_config = ConfigDict(extra="allow")

    format_version: int = 1
    id: str | None = None
    source: str | None = None
    metadata: Json = Field(default_factory=dict)
    content: str
    content_type: DocumentContentType | None = None
    raw: Json | None = None
