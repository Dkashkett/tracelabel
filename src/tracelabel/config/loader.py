from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]
from pydantic import ValidationError

from tracelabel.errors import UserError

from .models import RawConfig
from .validation import format_config_validation_error


def load_config(path: Path) -> RawConfig:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise UserError(f"{path}: cannot read config file: {error}") from error
    try:
        data: Any = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise UserError(f"{path}: invalid YAML: {error}") from error
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise UserError(f"{path}: top level must be a mapping of keys")
    try:
        raw = RawConfig.model_validate(data)
    except ValidationError as error:
        raise format_config_validation_error(error, str(path)) from error
    if raw.data is not None and not raw.data.is_absolute():
        raw = raw.model_copy(update={"data": (path.parent / raw.data).resolve()})
    return raw


def raw_config_for_target(target: Path) -> RawConfig:
    suffix = target.suffix.lower()
    if suffix in (".yaml", ".yml"):
        return load_config(target)
    if suffix in (".jsonl", ".json"):
        return RawConfig(data=target.resolve())
    raise UserError(
        f"{target}: unsupported target type '{suffix}'. "
        "Pass a config (.yaml/.yml) or a data file (.jsonl/.json)."
    )
