import json
from pathlib import Path

from tracelabel.ctf import content_type_of, validate_ctf_line

TRACES_PATH = Path(__file__).parent.parent / "src" / "tracelabel" / "demo_data" / "traces.jsonl"


def _load_traces() -> list[dict]:
    with TRACES_PATH.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


# --- DEMO-01 -----------------------------------------------------------------


def test_demo_data_valid_and_representative():
    traces = _load_traces()

    for i, obj in enumerate(traces, start=1):
        validate_ctf_line(obj, str(TRACES_PATH), i)

    assert len(traces) >= 25

    ids = [t["id"] for t in traces]
    assert len(set(ids)) == len(ids)

    has_tool_calls = any(any(msg.get("tool_calls") for msg in t["messages"]) for t in traces)
    assert has_tool_calls

    has_named_assistant = any(
        any(msg.get("role") == "assistant" and msg.get("name") for msg in t["messages"])
        for t in traces
    )
    assert has_named_assistant

    document_content_types = [
        content_type_of(msg["content"])
        for t in traces
        for msg in t["messages"]
        if msg.get("role") == "document"
    ]
    assert "json" in document_content_types
    assert "html" in document_content_types

    has_parts_message = any(
        content_type_of(msg["content"]) == "parts" for t in traces for msg in t["messages"]
    )
    assert has_parts_message

    has_long_trace = any(len(t["messages"]) >= 40 for t in traces)
    assert has_long_trace
