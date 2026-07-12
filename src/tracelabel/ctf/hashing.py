import hashlib
import json
from typing import Any

from .models import Json


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def derive_trace_id(messages: list[Json]) -> str:
    """Derive an ID from parsed post-adapter messages, never from model output."""
    return "t_" + sha256_hex(canonical_json(messages))[:32]


def content_hash(messages: list[Json]) -> str:
    return sha256_hex(canonical_json(messages))


def derive_document_id(content: str) -> str:
    """Derive an ID from document content, never from a user-provided value."""
    return "d_" + sha256_hex(content)[:32]


def document_content_hash(content: str, content_type: str | None) -> str:
    return sha256_hex(canonical_json({"content": content, "content_type": content_type}))
