from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

FieldType = Literal["single_select", "multi_select", "text"]
Level = Literal["turn", "trace"]
AnnotationStatus = Literal["labeled", "skipped"]
AnnotationValue = str | list[str]
AnnotationValues = dict[str, AnnotationValue]
NAME_PATTERN = r"^[a-z][a-z0-9_]{0,63}$"


class FieldDef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=NAME_PATTERN)
    label: str | None = None
    type: FieldType
    options: list[str] | None = None
    required: bool = False
    placeholder: str | None = None
    help: str | None = None

    @model_validator(mode="after")
    def _validate_rules(self) -> "FieldDef":
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
    model_config = ConfigDict(extra="forbid")

    model: str
    temperature: float = 0.0
    max_tokens: int = 1024


class SuggestConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instructions: str | None = None


class ReviewConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Annotator name whose labels are being reviewed (the judge, e.g. "gpt-4o").
    of: str
    # Key in each source line holding that annotator's values dict.
    labels_from: str = "judge"


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
    review: ReviewConfig | None = None


@dataclass(frozen=True)
class CliArgs:
    data: Path | None = None
    task: str | None = None
    level: Level | None = None
    annotator: str | None = None
    shuffle: bool | None = None
    db: Path | None = None
    yes: bool = False
    review_of: str | None = None
    review_labels_from: str | None = None


@dataclass(frozen=True)
class ResolvedTaskConfig:
    name: str
    level: Level
    fields: list[dict[str, Any]]
    label_roles: list[str]
    shuffle: bool
    annotator: str
    schema_hash: str
    data_path: Path
    llm: LLMConfig | None
    suggest_instructions: str | None
    # Review mode: the annotator whose labels are being reviewed (None = normal labeling),
    # and the source-line key those labels are read from.
    review_of: str | None = None
    review_labels_from: str = "judge"
