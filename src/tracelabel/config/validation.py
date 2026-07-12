import difflib
from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from tracelabel.errors import UserError

from .models import AnnotationStatus, AnnotationValue

_MODEL_TAGS = {"PresetRef", "FieldDef", "LLMConfig", "SuggestConfig", "RawConfig"}


def _parse_expected(expected: str) -> list[str]:
    values: list[str] = []
    token = ""
    in_quote = False
    for character in expected:
        if character == "'":
            if in_quote:
                values.append(token)
                token = ""
            in_quote = not in_quote
        elif in_quote:
            token += character
    return values


def _is_union_tag(segment: object) -> bool:
    return isinstance(segment, str) and (
        segment in _MODEL_TAGS or "[" in segment or "function-" in segment
    )


def _human_location(location: tuple[int | str, ...]) -> str:
    parts: list[str] = []
    for segment in location:
        if _is_union_tag(segment):
            continue
        if isinstance(segment, int):
            parts.append(f"[{segment}]")
        else:
            parts.append(("." if parts else "") + str(segment))
    return "".join(parts)


def _prefer_union_branch(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[int | str, ...], dict[str | None, list[dict[str, Any]]]] = {}
    order: list[tuple[int | str, ...]] = []
    for error in errors:
        location = error["loc"]
        cut = 0
        for index, segment in enumerate(location):
            if isinstance(segment, int):
                cut = index + 1
        prefix = tuple(location[:cut])
        branch = location[cut] if cut < len(location) and _is_union_tag(location[cut]) else None
        if prefix not in groups:
            groups[prefix] = {}
            order.append(prefix)
        groups[prefix].setdefault(branch, []).append(error)

    preferred: list[dict[str, Any]] = []
    for prefix in order:
        branches = groups[prefix]
        if len(branches) == 1:
            preferred.extend(next(iter(branches.values())))
        else:
            best: list[dict[str, Any]] | None = None
            for branch_errors in branches.values():
                if best is None or len(branch_errors) < len(best):
                    best = branch_errors
            if best is not None:
                preferred.extend(best)
    return preferred


def format_config_validation_error(error: ValidationError, file: str) -> UserError:
    lines: list[str] = []
    raw_errors = [dict(item) for item in error.errors()]
    for item in _prefer_union_branch(raw_errors):
        location = tuple(item["loc"])
        detail = f"{file}: {_human_location(location)}: {item['msg']}"
        context = item.get("ctx") or {}
        expected = context.get("expected")
        if item["type"] in ("literal_error", "enum") and isinstance(expected, str):
            allowed = _parse_expected(expected)
            given = item.get("input")
            if isinstance(given, str) and allowed:
                close = difflib.get_close_matches(given, allowed, n=1)
                if close:
                    detail += f'\nDid you mean "{close[0]}"?'
            if allowed:
                detail += f" Valid values: {', '.join(allowed)}."
        if detail not in lines:
            lines.append(detail)
    return UserError("\n".join(lines))


class AnnotationValidator:
    def __init__(self, fields: list[dict[str, Any]]) -> None:
        self._fields = fields
        self._fields_by_name = {str(field["name"]): field for field in fields}

    def validate(
        self,
        values: Mapping[str, AnnotationValue],
        status: AnnotationStatus,
    ) -> None:
        if status == "skipped":
            if values:
                raise UserError("skipped annotations carry no values")
            return

        for name, value in values.items():
            field = self._fields_by_name.get(name)
            if field is None:
                raise UserError(f"unknown field '{name}'")
            field_type = field["type"]
            if field_type == "single_select":
                if value not in field["options"]:
                    raise UserError(f"'{value}' is not an option of '{name}'")
            elif field_type == "multi_select":
                if not isinstance(value, list):
                    raise UserError(f"field '{name}' expects a list of options")
                invalid = [item for item in value if item not in field["options"]]
                if invalid:
                    raise UserError(f"'{invalid[0]}' is not an option of '{name}'")
                if len(value) != len(set(value)):
                    raise UserError(f"field '{name}' has duplicate selections")
            elif field_type == "text" and not isinstance(value, str):
                raise UserError(f"field '{name}' expects a text string")

        for field in self._fields:
            if field["required"] and not self._is_truthy(values.get(field["name"])):
                raise UserError(f"required field '{field['name']}' missing")

    @staticmethod
    def _is_truthy(value: object) -> bool:
        if value is None:
            return False
        if isinstance(value, str | list):
            return bool(value)
        return bool(value)
