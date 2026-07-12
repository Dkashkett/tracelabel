import json
from pathlib import Path

from tracelabel.ctf.content import content_type_of
from tracelabel.ctf.validation import CtfValidator

validate_ctf_line = CtfValidator().validate_line

TRACES_PATH = Path(__file__).parent.parent / "src" / "tracelabel" / "demo_data" / "traces.jsonl"


def _load_traces() -> list[dict]:
    with TRACES_PATH.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


# --- DEMO-01 -----------------------------------------------------------------


def test_demo_data_valid_and_representative():
    traces = _load_traces()
    conversations = [trace for trace in traces if "messages" in trace]
    documents = [trace for trace in traces if "content" in trace]

    for i, obj in enumerate(traces, start=1):
        validate_ctf_line(obj, str(TRACES_PATH), i)

    assert len(traces) >= 25

    ids = [t["id"] for t in traces]
    assert len(set(ids)) == len(ids)

    has_tool_calls = any(
        any(msg.get("tool_calls") for msg in trace["messages"]) for trace in conversations
    )
    assert has_tool_calls

    has_named_assistant = any(
        any(msg.get("role") == "assistant" and msg.get("name") for msg in trace["messages"])
        for trace in conversations
    )
    assert has_named_assistant

    document_content_types = [document["content_type"] for document in documents]
    assert "json" in document_content_types
    assert "html" in document_content_types

    has_parts_message = any(
        content_type_of(msg["content"]) == "parts"
        for trace in conversations
        for msg in trace["messages"]
    )
    assert has_parts_message

    has_long_trace = any(len(trace["messages"]) >= 40 for trace in conversations)
    assert has_long_trace
