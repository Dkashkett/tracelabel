import os
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

from tracelabel.ctf.hashing import canonical_json, sha256_hex
from tracelabel.errors import UserError

from .models import CliArgs, FieldDef, RawConfig, ResolvedTaskConfig
from .presets import DEFAULT_FIELDS, expand_presets


def canonical_field_dict(field: FieldDef) -> dict[str, Any]:
    canonical: dict[str, Any] = {
        "name": field.name,
        "label": field.label or field.name.replace("_", " ").capitalize(),
        "type": field.type,
        "required": field.required,
    }
    if field.options:
        canonical["options"] = field.options
    if field.placeholder:
        canonical["placeholder"] = field.placeholder
    if field.help:
        canonical["help"] = field.help
    return canonical


def schema_hash(fields: list[FieldDef]) -> str:
    return sha256_hex(canonical_json([canonical_field_dict(field) for field in fields]))


def compat_hash(fields: list[dict[str, Any]]) -> str:
    """Hash only what can invalidate an existing annotation: field names and types.

    Cosmetic edits (label, help, placeholder, order) and additive edits (a new
    optional field, a new option on a select) leave this unchanged. This is a
    separate, narrower gate than ``schema_hash`` — the full ``schema_hash`` is still
    written onto every annotation (it's part of the documented export column
    contract), but ``compat_hash`` is what decides whether an existing annotation is
    still compatible with an edited rubric.
    """
    return sha256_hex(
        canonical_json(
            sorted(
                ({"name": field["name"], "type": field["type"]} for field in fields),
                key=lambda field: field["name"],
            )
        )
    )


def default_task_name(data: Path, today: date | None = None) -> str:
    current_date = today or date.today()
    return f"{data.stem}-{current_date.isoformat()}"


def os_username() -> str:
    return os.environ.get("USER") or os.environ.get("USERNAME") or "annotator"


class ConfigResolver:
    def __init__(self, username_provider: Callable[[], str] = os_username) -> None:
        self._username_provider = username_provider

    def resolve(self, raw: RawConfig, cli: CliArgs) -> ResolvedTaskConfig:
        data = cli.data or raw.data
        if data is None:
            raise UserError("No data file given (arg or `data:` in YAML)")
        fields = expand_presets(raw.fields) if raw.fields is not None else list(DEFAULT_FIELDS)
        self._check_unique_names(fields)
        annotator = cli.annotator or raw.annotator or self._username_provider()
        review_of = cli.review_of or (raw.review.of if raw.review else None)
        review_labels_from = (
            cli.review_labels_from or (raw.review.labels_from if raw.review else None) or "judge"
        )
        if review_of is not None and review_of == annotator:
            raise UserError(
                f"--review-of '{review_of}' must differ from the reviewer's annotator "
                f"'{annotator}' (else the review would overwrite the labels being reviewed). "
                "Pass a different --annotator."
            )
        label_roles = raw.label_roles or ["assistant"]
        if "event" in label_roles:
            raise UserError(
                "label_roles may not contain 'event' — event rows are structural "
                "(handoffs, spans, agent boundaries) and cannot be labeled."
            )
        return ResolvedTaskConfig(
            name=cli.task or raw.task or default_task_name(data),
            level=cli.level or raw.level,
            fields=[canonical_field_dict(field) for field in fields],
            label_roles=label_roles,
            shuffle=cli.shuffle if cli.shuffle is not None else raw.shuffle,
            annotator=annotator,
            schema_hash=schema_hash(fields),
            llm=raw.llm,
            suggest_instructions=raw.suggest.instructions if raw.suggest else None,
            review_of=review_of,
            review_labels_from=review_labels_from,
        )

    @staticmethod
    def _check_unique_names(fields: list[FieldDef]) -> None:
        seen: set[str] = set()
        for field in fields:
            if field.name in seen:
                raise UserError(f"duplicate field name '{field.name}'")
            seen.add(field.name)
