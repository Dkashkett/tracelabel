import json
from pathlib import Path

import pytest

from tracelabel.ctf.content import content_type_of, detect_content_type, serialize_content
from tracelabel.ctf.hashing import derive_trace_id
from tracelabel.ctf.validation import CtfError, CtfValidator

_validator = CtfValidator()
fold_unknown_keys = _validator.fold_unknown_keys
validate_ctf_line = _validator.validate_line

FIXTURES = Path(__file__).parent / "fixtures" / "ctf"


def _line(name: str, idx: int = 0) -> dict:
    with (FIXTURES / name).open(encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    return rows[idx]


def _validate(name: str) -> None:
    validate_ctf_line(_line(name), name, 1)


# --- CTF-01 ------------------------------------------------------------------


def test_reject_missing_messages():
    with pytest.raises(CtfError):
        _validate("reject_missing_messages.jsonl")


def test_reject_empty_messages():
    with pytest.raises(CtfError):
        _validate("reject_empty_messages.jsonl")


# --- CTF-02 ------------------------------------------------------------------


def test_reject_bad_role():
    with pytest.raises(CtfError):
        _validate("reject_bad_role.jsonl")


def test_reject_missing_content():
    with pytest.raises(CtfError):
        _validate("reject_missing_content.jsonl")


# --- CTF-03 / CTF-04 ---------------------------------------------------------


def test_reject_tool_calls_on_user():
    with pytest.raises(CtfError):
        _validate("reject_tool_calls_on_user.jsonl")


def test_reject_tool_call_id_on_assistant():
    with pytest.raises(CtfError):
        _validate("reject_tool_call_id_on_assistant.jsonl")


# --- CTF-05 ------------------------------------------------------------------


def test_reject_empty_content_without_tool_calls():
    with pytest.raises(CtfError):
        _validate("reject_empty_content_without_tool_calls.jsonl")


def test_accept_empty_content_with_tool_calls():
    obj = {
        "messages": [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"id": "c1", "type": "function", "function": {"name": "f", "arguments": "{}"}}
                ],
            }
        ]
    }
    trace = validate_ctf_line(obj, "x", 1)
    assert trace.messages[0].content == ""


# --- CTF-06 ------------------------------------------------------------------


def test_reject_document_in_multi_message_trace():
    with pytest.raises(CtfError):
        _validate("reject_document_in_multi_message_trace.jsonl")


# --- CTF-07 ------------------------------------------------------------------


def test_reject_future_format_version():
    with pytest.raises(CtfError) as excinfo:
        _validate("reject_future_format_version.jsonl")
    assert "upgrade" in str(excinfo.value).lower()


# --- CTF-08 ------------------------------------------------------------------


def test_ctf_error_includes_location_and_fixed_example():
    obj = _line("reject_bad_role.jsonl")
    with pytest.raises(CtfError) as excinfo:
        validate_ctf_line(obj, "traces.jsonl", 47)
    msg = str(excinfo.value)
    assert "traces.jsonl:47" in msg
    assert "Fixed, it would be:" in msg
    # The hint is appended by the P4 pipeline, never by CtfError itself.
    assert "--skip-invalid" not in msg


# --- CTF-09 ------------------------------------------------------------------


def test_fix_example_for_legacy_function_role():
    obj = _line("reject_bad_role.jsonl")
    with pytest.raises(CtfError) as excinfo:
        validate_ctf_line(obj, "traces.jsonl", 47)
    msg = str(excinfo.value)
    assert '"role": "tool"' in msg
    assert "tool_call_id" in msg


# --- CTF-10 ------------------------------------------------------------------


def test_detect_content_type_matrix():
    assert detect_content_type("just text") == "text"
    assert detect_content_type('{"a": 1}') == "json"
    assert detect_content_type("  [1, 2, 3]  ") == "json"
    assert detect_content_type("<!DOCTYPE html><html></html>") == "html"
    assert detect_content_type("<html><body>hi</body></html>") == "html"
    # Looks like json but does not parse → text.
    assert detect_content_type("{not json") == "text"
    # A leading brace only becomes json when it parses.
    assert content_type_of("plain") == "text"


# --- CTF-11 ------------------------------------------------------------------


def test_parts_content_roundtrip_verbatim():
    obj = _line("valid.jsonl", 2)
    trace = validate_ctf_line(obj, "valid.jsonl", 3)
    content = obj["messages"][0]["content"]
    assert content_type_of(content) == "parts"
    # Inner strings are stored verbatim; only the wrapper array is serialized.
    serialized = serialize_content(content)
    assert json.loads(serialized)[1]["json_string"] == '{"user": 42}'
    assert trace.messages[0].content[1].json_string == '{"user": 42}'


# --- CTF-12 ------------------------------------------------------------------


def test_unknown_trace_keys_preserved_into_raw():
    obj = {
        "extra_top": {"k": "v"},
        "messages": [{"role": "user", "content": "hi", "weird": 1}],
    }
    folded, warnings = fold_unknown_keys(obj)
    assert folded["raw"] == {"extra_top": {"k": "v"}}
    assert folded["messages"][0]["raw"] == {"weird": 1}
    assert "extra_top" not in folded
    assert "weird" not in folded["messages"][0]
    assert any("extra_top" in w for w in warnings)
    assert any("weird" in w for w in warnings)
    # Folded output still validates (models are extra="allow" either way).
    validate_ctf_line(folded, "x", 1)


# --- CTF-13 ------------------------------------------------------------------


def test_derive_trace_id():
    messages = [{"role": "user", "content": "hi"}]
    tid = derive_trace_id(messages)
    assert tid.startswith("t_")
    assert len(tid) == 2 + 32


def test_provided_id_verbatim():
    # A provided id is used verbatim; validation never rewrites it.
    obj = _line("valid.jsonl", 0)
    trace = validate_ctf_line(obj, "valid.jsonl", 1)
    assert trace.id == "conv_1"
