from pathlib import Path

import pytest
from pydantic import ValidationError

from tracelabel.config.loader import load_config, raw_config_for_target
from tracelabel.config.models import CliArgs, FieldDef, RawConfig
from tracelabel.config.presets import DEFAULT_FIELDS
from tracelabel.config.resolver import (
    ConfigResolver,
    canonical_field_dict,
    default_task_name,
    schema_hash,
)
from tracelabel.config.validation import AnnotationValidator, format_config_validation_error
from tracelabel.errors import UserError


def resolve(raw: RawConfig, cli: CliArgs):
    return ConfigResolver().resolve(raw, cli)


def validate_annotation_values(values, status, fields):
    AnnotationValidator(fields).validate(values, status)


def _pass_fail_yaml() -> RawConfig:
    return RawConfig.model_validate({"data": "traces.jsonl", "fields": [{"preset": "pass_fail"}]})


# CFG-01
def test_default_fields_when_absent():
    raw = RawConfig(data=Path("traces.jsonl"))
    cfg = resolve(raw, CliArgs())
    assert [f["name"] for f in cfg.fields] == ["verdict", "reasoning"]
    assert cfg.fields == [canonical_field_dict(f) for f in DEFAULT_FIELDS]


# CFG-02
def test_custom_fields_replace_defaults():
    raw = RawConfig.model_validate(
        {"data": "t.jsonl", "fields": [{"name": "notes", "type": "text"}]}
    )
    cfg = resolve(raw, CliArgs())
    assert [f["name"] for f in cfg.fields] == ["notes"]


# CFG-03
def test_preset_expansion_order():
    raw = RawConfig.model_validate(
        {"data": "t.jsonl", "fields": [{"preset": "pass_fail"}, {"name": "notes", "type": "text"}]}
    )
    cfg = resolve(raw, CliArgs())
    assert [f["name"] for f in cfg.fields] == ["verdict", "reasoning", "notes"]


# CFG-04
def test_schema_hash_noconfig_equals_pass_fail_preset():
    noconfig = resolve(RawConfig(data=Path("t.jsonl")), CliArgs())
    preset = resolve(_pass_fail_yaml(), CliArgs())
    assert noconfig.schema_hash == preset.schema_hash


# CFG-05
def test_schema_hash_field_order_significant():
    a = FieldDef(name="a", type="text")
    b = FieldDef(name="b", type="text")
    assert schema_hash([a, b]) != schema_hash([b, a])
    # key order inside the dict does not matter: canonical_field_dict + sort_keys guarantee it
    assert schema_hash([a, b]) == schema_hash([a, b])


# CFG-06
def test_fielddef_validation_matrix():
    with pytest.raises(ValidationError):
        FieldDef(name="x", type="single_select", options=["only"])
    with pytest.raises(ValidationError):
        FieldDef(name="x", type="single_select", options=["a", "a"])
    with pytest.raises(ValidationError):
        FieldDef(name="x", type="single_select", options=["a", "b"], placeholder="p")
    with pytest.raises(ValidationError):
        FieldDef(name="x", type="text", options=["a", "b"])
    # valid ones do not raise
    FieldDef(name="x", type="single_select", options=["a", "b"])
    FieldDef(name="x", type="text", placeholder="ok")


# CFG-07
def test_duplicate_field_names_rejected():
    raw = RawConfig.model_validate(
        {
            "data": "t.jsonl",
            "fields": [{"name": "notes", "type": "text"}, {"name": "notes", "type": "text"}],
        }
    )
    with pytest.raises(UserError):
        resolve(raw, CliArgs())


# CFG-08
def test_unknown_key_error_names_file_and_path(tmp_path):
    cfg_path = tmp_path / "config.yaml"
    cfg_path.write_text(
        "data: t.jsonl\nfields:\n  - type: multiselect\n    name: e\n", encoding="utf-8"
    )
    with pytest.raises(UserError) as ei:
        load_config(cfg_path)
    msg = str(ei.value)
    assert str(cfg_path) in msg
    assert "fields[0].type" in msg
    assert "multi_select" in msg


# CFG-09
def test_api_key_in_yaml_rejected():
    with pytest.raises(UserError) as ei:
        load_config_from_dict({"data": "t.jsonl", "llm": {"model": "gpt-4o", "api_key": "x"}})
    assert "api_key" in str(ei.value)


def load_config_from_dict(d: dict) -> RawConfig:
    from pydantic import ValidationError

    try:
        return RawConfig.model_validate(d)
    except ValidationError as e:
        raise format_config_validation_error(e, "config.yaml") from e


# CFG-10
def test_precedence_cli_over_yaml_over_default():
    raw = RawConfig.model_validate(
        {"data": "t.jsonl", "task": "yaml_task", "level": "turn", "annotator": "yaml_user"}
    )
    cli = CliArgs(task="cli_task", level="trace", annotator="cli_user", shuffle=True)
    cfg = resolve(raw, cli)
    assert cfg.name == "cli_task"
    assert cfg.level == "trace"
    assert cfg.annotator == "cli_user"
    assert cfg.shuffle is True
    # yaml over default
    cfg2 = resolve(raw, CliArgs())
    assert cfg2.name == "yaml_task"
    assert cfg2.level == "turn"
    assert cfg2.annotator == "yaml_user"


# CFG-11
def test_data_path_relative_to_config_file(tmp_path):
    cfg_path = tmp_path / "sub" / "config.yaml"
    cfg_path.parent.mkdir()
    cfg_path.write_text("data: traces.jsonl\n", encoding="utf-8")
    raw = load_config(cfg_path)
    assert raw.data == (tmp_path / "sub" / "traces.jsonl").resolve()


# CFG-12
def test_resolution_defaults(monkeypatch):
    monkeypatch.setenv("USER", "alice")
    monkeypatch.delenv("USERNAME", raising=False)
    raw = RawConfig(data=Path("mytraces.jsonl"))
    cfg = resolve(raw, CliArgs())
    assert cfg.name == default_task_name(Path("mytraces.jsonl"))
    assert cfg.name.startswith("mytraces-")
    assert cfg.label_roles == ["assistant", "document"]
    assert cfg.annotator == "alice"


def test_raw_config_for_target_bad_suffix(tmp_path):
    with pytest.raises(UserError):
        raw_config_for_target(tmp_path / "x.txt")


def test_raw_config_for_target_jsonl(tmp_path):
    raw = raw_config_for_target(tmp_path / "x.jsonl")
    assert raw.data == (tmp_path / "x.jsonl").resolve()


# CFG-13 — mirrors API-07…API-13 at the function level
def test_validate_values_matrix():
    fields = [
        canonical_field_dict(
            FieldDef(name="verdict", type="single_select", options=["pass", "fail"], required=True)
        ),
        canonical_field_dict(FieldDef(name="tags", type="multi_select", options=["a", "b", "c"])),
        canonical_field_dict(FieldDef(name="notes", type="text")),
    ]

    # API-07: skipped with values
    with pytest.raises(UserError):
        validate_annotation_values({"verdict": "pass"}, "skipped", fields)
    validate_annotation_values({}, "skipped", fields)  # ok

    # API-08: unknown field
    with pytest.raises(UserError):
        validate_annotation_values({"verdict": "pass", "bogus": "x"}, "labeled", fields)

    # API-09: single_select not in options
    with pytest.raises(UserError):
        validate_annotation_values({"verdict": "maybe"}, "labeled", fields)

    # API-10: multi_select — not a list
    with pytest.raises(UserError):
        validate_annotation_values({"verdict": "pass", "tags": "a"}, "labeled", fields)
    # bad member
    with pytest.raises(UserError):
        validate_annotation_values({"verdict": "pass", "tags": ["a", "z"]}, "labeled", fields)
    # duplicates
    with pytest.raises(UserError):
        validate_annotation_values({"verdict": "pass", "tags": ["a", "a"]}, "labeled", fields)

    # API-11: text not a string
    with pytest.raises(UserError):
        validate_annotation_values({"verdict": "pass", "notes": 5}, "labeled", fields)

    # API-12: required missing
    with pytest.raises(UserError):
        validate_annotation_values({"notes": "hi"}, "labeled", fields)

    # API-13: required empty string / empty list
    empty_str_fields = [canonical_field_dict(FieldDef(name="reason", type="text", required=True))]
    with pytest.raises(UserError):
        validate_annotation_values({"reason": ""}, "labeled", empty_str_fields)
    empty_list_fields = [
        canonical_field_dict(
            FieldDef(name="tags", type="multi_select", options=["a", "b"], required=True)
        )
    ]
    with pytest.raises(UserError):
        validate_annotation_values({"tags": []}, "labeled", empty_list_fields)

    # a valid labeled annotation passes
    validate_annotation_values(
        {"verdict": "pass", "tags": ["a", "b"], "notes": "ok"}, "labeled", fields
    )


def test_config_error_example_verbatim(tmp_path):
    # 03 §7 shape
    cfg_path = tmp_path / "config.yaml"
    cfg_path.write_text(
        "data: t.jsonl\nfields:\n  - name: e\n    type: multiselect\n", encoding="utf-8"
    )
    with pytest.raises(UserError) as ei:
        load_config(cfg_path)
    msg = str(ei.value)
    assert 'Did you mean "multi_select"?' in msg
    assert "single_select" in msg and "multi_select" in msg and "text" in msg
