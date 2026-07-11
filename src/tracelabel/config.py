import difflib
import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal

import yaml  # type: ignore[import-untyped]
from pydantic import BaseModel, ConfigDict, ValidationError, model_validator
from pydantic import Field as PydanticField

from .ctf import sha256_hex
from .errors import UserError

FieldType = Literal["single_select", "multi_select", "text"]
Level = Literal["turn", "trace"]
NAME_RE = r"^[a-z][a-z0-9_]{0,63}$"


class FieldDef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = PydanticField(pattern=NAME_RE)
    label: str | None = None
    type: FieldType
    options: list[str] | None = None
    required: bool = False
    placeholder: str | None = None
    help: str | None = None

    @model_validator(mode="after")
    def _rules(self) -> "FieldDef":
        if self.type in ("single_select", "multi_select"):
            if not self.options or len(self.options) < 2:
                raise ValueError("selects need ≥2 options")
            if len(self.options) != len(set(self.options)):
                raise ValueError("duplicate options")
            if self.placeholder:
                raise ValueError("placeholder is for text fields")
        elif self.options:
            raise ValueError("text fields take no options")
        return self


class PresetRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preset: Literal["pass_fail"]


class LLMConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")  # forbid api_key & friends by construction
    model: str
    temperature: float = 0.0
    max_tokens: int = 1024


class SuggestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instructions: str | None = None


class RawConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: Path | None = None
    task: str | None = None
    level: Level = "trace"
    shuffle: bool = False
    annotator: str | None = None
    label_roles: list[str] | None = None
    fields: list[PresetRef | FieldDef] | None = None
    llm: LLMConfig | None = None
    suggest: SuggestConfig | None = None


DEFAULT_FIELDS = [
    FieldDef(
        name="verdict",
        label="Verdict",
        type="single_select",
        options=["pass", "fail"],
        required=True,
    ),
    FieldDef(
        name="reasoning",
        label="Reasoning",
        type="text",
        placeholder="Why is this a pass or fail?",
        required=False,
    ),
]

PRESETS = {"pass_fail": DEFAULT_FIELDS}


def expand(items: list[PresetRef | FieldDef]) -> list[FieldDef]:
    out: list[FieldDef] = []
    for item in items:
        if isinstance(item, PresetRef):
            out.extend(PRESETS[item.preset])
        else:
            out.append(item)
    return out


def canonical_field_dict(f: FieldDef) -> dict[str, Any]:
    d: dict[str, Any] = {
        "name": f.name,
        "label": f.label or f.name.replace("_", " ").capitalize(),
        "type": f.type,
        "required": f.required,
    }
    if f.options:
        d["options"] = f.options  # order preserved (drives hotkey numbers)
    if f.placeholder:
        d["placeholder"] = f.placeholder
    if f.help:
        d["help"] = f.help
    return d


def schema_hash(fields: list[FieldDef]) -> str:
    return sha256_hex(
        json.dumps(
            [canonical_field_dict(f) for f in fields],
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
    )


def default_task_name(data: Path) -> str:
    return f"{data.stem}-{date.today().isoformat()}"


@dataclass(frozen=True)
class CliArgs:
    data: Path | None = None
    task: str | None = None
    level: Level | None = None
    annotator: str | None = None
    shuffle: bool | None = None
    db: Path | None = None
    yes: bool = False


@dataclass(frozen=True)
class ResolvedTaskConfig:
    name: str
    level: Level
    fields: list[dict[str, Any]]  # canonical field dicts, order significant
    label_roles: list[str]
    shuffle: bool
    annotator: str
    schema_hash: str
    data_path: Path
    llm: LLMConfig | None
    suggest_instructions: str | None


def _os_username() -> str:
    return os.environ.get("USER") or os.environ.get("USERNAME") or "annotator"


def _check_unique_names(fields: list[FieldDef]) -> None:
    seen: set[str] = set()
    for f in fields:
        if f.name in seen:
            raise UserError(f"duplicate field name '{f.name}'")
        seen.add(f.name)


def _parse_expected(expected: str) -> list[str]:
    # Pydantic renders `expected` as e.g.  'a', 'b' or 'c'  — pull the quoted values out.
    out: list[str] = []
    token = ""
    in_quote = False
    for ch in expected:
        if ch == "'":
            if in_quote:
                out.append(token)
                token = ""
            in_quote = not in_quote
        elif in_quote:
            token += ch
    return out


_MODEL_TAGS = {"PresetRef", "FieldDef", "LLMConfig", "SuggestConfig", "RawConfig"}


def _is_union_tag(seg: object) -> bool:
    # Pydantic labels each tried branch of a `X | Y` union with a tag segment
    # (the model name, or a `function-after[...]` wrapper for a model_validator).
    return isinstance(seg, str) and (seg in _MODEL_TAGS or "[" in seg or "function-" in seg)


def _human_loc(loc: tuple[int | str, ...]) -> str:
    parts: list[str] = []
    for seg in loc:
        if _is_union_tag(seg):
            continue
        if isinstance(seg, int):
            parts.append(f"[{seg}]")
        else:
            parts.append(("." if parts else "") + str(seg))
    return "".join(parts)


def _prefer_branch(errors: list[Any]) -> list[Any]:
    # A dict that fails a `PresetRef | FieldDef` union reports errors under every branch it
    # was tried against. Group by the item's index-prefix and keep only the branch with the
    # fewest complaints — the one the input actually resembles (03 §7 wants one clean line).
    groups: dict[tuple[int | str, ...], dict[str | None, list[Any]]] = {}
    order: list[tuple[int | str, ...]] = []
    for err in errors:
        loc = err["loc"]
        cut = 0
        for i, seg in enumerate(loc):
            if isinstance(seg, int):
                cut = i + 1
        prefix = tuple(loc[:cut])
        branch = loc[cut] if cut < len(loc) and _is_union_tag(loc[cut]) else None
        if prefix not in groups:
            groups[prefix] = {}
            order.append(prefix)
        groups[prefix].setdefault(branch, []).append(err)
    kept: list[Any] = []
    for prefix in order:
        branches = groups[prefix]
        if len(branches) <= 1:
            for errs in branches.values():
                kept.extend(errs)
        else:
            best = min(branches.values(), key=len)
            kept.extend(best)
    return kept


def _format_validation_error(exc: ValidationError, file: str) -> UserError:
    lines: list[str] = []
    for err in _prefer_branch(exc.errors()):
        detail = f"{file}: {_human_loc(err['loc'])}: {err['msg']}"
        ctx = err.get("ctx") or {}
        expected = ctx.get("expected")
        if err["type"] in ("literal_error", "enum") and isinstance(expected, str):
            allowed = _parse_expected(expected)
            given = err.get("input")
            if isinstance(given, str) and allowed:
                close = difflib.get_close_matches(given, allowed, n=1)
                if close:
                    detail += f'\nDid you mean "{close[0]}"?'
            if allowed:
                detail += f" Valid values: {', '.join(allowed)}."
        if detail not in lines:
            lines.append(detail)
    return UserError("\n".join(lines))


def load_config(path: Path) -> RawConfig:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        raise UserError(f"{path}: cannot read config file: {e}") from e
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise UserError(f"{path}: invalid YAML: {e}") from e
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise UserError(f"{path}: top level must be a mapping of keys")
    try:
        raw = RawConfig.model_validate(data)
    except ValidationError as e:
        raise _format_validation_error(e, str(path)) from e
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


def resolve(raw: RawConfig, cli: CliArgs) -> ResolvedTaskConfig:
    data = cli.data or raw.data
    if data is None:
        raise UserError("No data file given (arg or `data:` in YAML)")
    name = cli.task or raw.task or default_task_name(data)
    level = cli.level or raw.level
    fields = expand(raw.fields) if raw.fields is not None else DEFAULT_FIELDS
    _check_unique_names(fields)
    roles = raw.label_roles or ["assistant", "document"]
    return ResolvedTaskConfig(
        name=name,
        level=level,
        fields=[canonical_field_dict(f) for f in fields],
        label_roles=roles,
        shuffle=cli.shuffle if cli.shuffle is not None else raw.shuffle,
        annotator=cli.annotator or (raw.annotator or _os_username()),
        schema_hash=schema_hash(fields),
        data_path=data,
        llm=raw.llm,
        suggest_instructions=raw.suggest.instructions if raw.suggest else None,
    )


def _truthy(val: object) -> bool:
    if val is None:
        return False
    if isinstance(val, str | list):
        return len(val) > 0
    return bool(val)


def validate_annotation_values(
    values: Mapping[str, str | list[str]],
    status: Literal["labeled", "skipped"],
    fields: list[dict[str, Any]],
) -> None:
    by_name = {f["name"]: f for f in fields}
    if status == "skipped":
        if values:
            raise UserError("skipped annotations carry no values")
        return
    for name, val in values.items():
        f = by_name.get(name)
        if f is None:
            raise UserError(f"unknown field '{name}'")
        ftype = f["type"]
        if ftype == "single_select":
            if val not in f["options"]:
                raise UserError(f"'{val}' is not an option of '{name}'")
        elif ftype == "multi_select":
            if not isinstance(val, list):
                raise UserError(f"field '{name}' expects a list of options")
            if not set(val) <= set(f["options"]):
                bad = [v for v in val if v not in f["options"]]
                raise UserError(f"'{bad[0]}' is not an option of '{name}'")
            if len(val) != len(set(val)):
                raise UserError(f"field '{name}' has duplicate selections")
        elif ftype == "text":
            if not isinstance(val, str):
                raise UserError(f"field '{name}' expects a text string")
    for f in fields:
        if f["required"] and not _truthy(values.get(f["name"])):
            raise UserError(f"required field '{f['name']}' missing")
