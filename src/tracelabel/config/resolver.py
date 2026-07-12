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
        return ResolvedTaskConfig(
            name=cli.task or raw.task or default_task_name(data),
            level=cli.level or raw.level,
            fields=[canonical_field_dict(field) for field in fields],
            label_roles=raw.label_roles or ["assistant", "document"],
            shuffle=cli.shuffle if cli.shuffle is not None else raw.shuffle,
            annotator=cli.annotator or raw.annotator or self._username_provider(),
            schema_hash=schema_hash(fields),
            data_path=data,
            llm=raw.llm,
            suggest_instructions=raw.suggest.instructions if raw.suggest else None,
        )

    @staticmethod
    def _check_unique_names(fields: list[FieldDef]) -> None:
        seen: set[str] = set()
        for field in fields:
            if field.name in seen:
                raise UserError(f"duplicate field name '{field.name}'")
            seen.add(field.name)
