import json
from typing import Literal

from .hashing import canonical_json
from .models import ContentType, Json


def _parses_as_json(value: str) -> bool:
    try:
        json.loads(value)
    except (ValueError, TypeError):
        return False
    return True


def detect_content_type(value: str) -> Literal["text", "json", "html"]:
    stripped = value.strip()
    if stripped.startswith(("{", "[")) and _parses_as_json(stripped):
        return "json"
    if stripped[:15].lower().startswith(("<!doctype html", "<html")):
        return "html"
    return "text"


def content_type_of(content: str | list[Json]) -> ContentType:
    if isinstance(content, str):
        return detect_content_type(content)
    return "parts"


def serialize_content(content: str | list[Json]) -> str:
    """Preserve content strings byte-for-byte; only serialize a parts-array wrapper."""
    if isinstance(content, str):
        return content
    return canonical_json(content)
