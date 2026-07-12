from collections.abc import Iterator
from typing import Any

from tracelabel.ctf.models import Json

from ..parsing import document_object

DOCUMENT_CTF_SNIPPET = '{"content": "# Title\\n\\nBody text.", "content_type": "markdown"}'


class UnsupportedDocumentInput(Exception):
    pass


def _looks_like_document(value: Any) -> bool:
    if isinstance(value, str):
        return True
    if isinstance(value, dict):
        return (
            isinstance(value.get("content"), str)
            and "messages" not in value
            and "role" not in value
        )
    return False


class DocumentsAdapter:
    name = "documents"

    def sniff(self, first_values: list[Any]) -> bool:
        return bool(first_values) and _looks_like_document(first_values[0])

    def to_ctf(self, value: Any) -> Iterator[Json]:
        if isinstance(value, str):
            yield document_object(value, content_type="text")
            return
        if isinstance(value, dict) and isinstance(value.get("content"), str):
            yield document_object(
                value["content"],
                doc_id=value.get("id"),
                metadata=value.get("metadata"),
                content_type=value.get("content_type"),
            )
            return
        raise UnsupportedDocumentInput
