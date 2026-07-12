import json
from pathlib import Path

import pytest

from tracelabel.ctf.validation import CtfValidator
from tracelabel.db.database import Database, default_db_path
from tracelabel.errors import UserError
from tracelabel.imports.adapters.adk import AdkAdapter
from tracelabel.imports.adapters.base import AdapterRegistry
from tracelabel.imports.adapters.ctf import CtfAdapter
from tracelabel.imports.adapters.datadog import DatadogAdapter
from tracelabel.imports.adapters.loose import LooseAdapter
from tracelabel.imports.parsing import iter_source as parse_source
from tracelabel.imports.service import ImportService

GOLDEN = Path(__file__).parent / "golden"


def detect(values):
    return AdapterRegistry.default().detect(values)


def iter_source(path, from_="auto", as_documents=False):
    return parse_source(
        path,
        AdapterRegistry.default(),
        from_=from_,
        as_documents=as_documents,
    )


def import_file(database, path, **kwargs):
    service = ImportService(AdapterRegistry.default(), CtfValidator(), database.traces)
    return service.import_file(path, **kwargs)


# ── helpers ─────────────────────────────────────────────────────────────────


@pytest.fixture
def conn(tmp_path):
    database = Database(default_db_path(tmp_path))
    yield database
    database.close()


def write_lines(path: Path, objs) -> Path:
    path.write_text(
        "".join(json.dumps(o, ensure_ascii=False) + "\n" for o in objs), encoding="utf-8"
    )
    return path


def read_jsonl(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def assert_content_bytes_equal(produced: list[dict], expected: list[dict]) -> None:
    # ADP-13: adapters never reformat content strings; every stored content string is
    # byte-for-byte what the mapping produced.
    for pt, et in zip(produced, expected, strict=True):
        for pm, em in zip(pt["messages"], et["messages"], strict=True):
            assert type(pm["content"]) is type(em["content"])
            assert pm["content"] == em["content"]


# ── ADP-01 ──────────────────────────────────────────────────────────────────


def test_detect_priority_order():
    ctf = {"messages": [{"role": "user", "content": "hi"}]}
    adk = {"events": [{"author": "user", "invocationId": "i"}]}
    dd = {"trace_id": "t", "meta": {"input": {"messages": []}}}
    loose = {"conversation": [{"role": "user", "content": "hi"}]}

    assert isinstance(detect([ctf]), CtfAdapter)
    assert isinstance(detect([adk]), AdkAdapter)
    assert isinstance(detect([dd]), DatadogAdapter)
    assert isinstance(detect([loose]), LooseAdapter)

    # ctf wins over loose when both could plausibly match (priority order)
    assert isinstance(detect([ctf, loose]), CtfAdapter)


def test_registry_honors_injected_order_and_returns_fresh_adapters():
    calls = []

    class FakeAdapter:
        def __init__(self, name, matches):
            self.name = name
            self._matches = matches

        def sniff(self, first_values):
            calls.append(self.name)
            return self._matches

        def to_ctf(self, value):
            yield value

    registry = AdapterRegistry(
        (
            lambda: FakeAdapter("first", False),
            lambda: FakeAdapter("second", True),
            lambda: FakeAdapter("third", True),
        )
    )
    selected = registry.detect([{"value": 1}])
    assert selected.name == "second"
    assert calls == ["first", "second"]
    assert registry.select("second", []) is not registry.select("second", [])


def test_import_service_orchestrates_injected_dependencies(tmp_path):
    path = write_lines(tmp_path / "input.jsonl", [{"value": "raw"}])

    class FakeAdapter:
        name = "fake"

        def sniff(self, first_values):
            return True

        def to_ctf(self, value):
            yield {"messages": [{"role": "user", "content": value["value"]}]}

    class RecordingValidator:
        def __init__(self):
            self.validated = []

        def fold_unknown_keys(self, trace):
            return trace, []

        def validate_line(self, trace, file, line_number):
            self.validated.append((trace, file, line_number))

    class RecordingRepository:
        def __init__(self):
            self.imported = []

        def import_trace(self, trace, source, on_conflict):
            self.imported.append((trace, source, on_conflict))
            return "inserted"

    validator = RecordingValidator()
    repository = RecordingRepository()
    service = ImportService(AdapterRegistry((FakeAdapter,)), validator, repository)
    summary = service.import_file(path)

    assert summary.inserted == 1
    assert validator.validated[0][2] == 1
    assert repository.imported == [
        (
            {"messages": [{"role": "user", "content": "raw"}]},
            "fake",
            "fail",
        )
    ]


# ── ADP-02 / ADP-13 ─────────────────────────────────────────────────────────


def test_golden_adk():
    session = json.loads((GOLDEN / "adk" / "input.json").read_text(encoding="utf-8"))
    produced = list(AdkAdapter().to_ctf(session))
    expected = read_jsonl(GOLDEN / "adk" / "expected.jsonl")
    assert produced == expected
    assert_content_bytes_equal(produced, expected)

    # tool_calls are inline on the assistant turn; results are separate tool turns
    msgs = produced[0]["messages"]
    assert msgs[1]["tool_calls"][0]["function"]["name"] == "get_weather"
    assert msgs[2]["role"] == "tool"
    # multi-agent authors surface as the `name` chip
    assert {m.get("name") for m in msgs if m["role"] == "assistant"} == {"planner", "responder"}


# ── ADP-03 / ADP-13 ─────────────────────────────────────────────────────────


def test_golden_datadog():
    spans = read_jsonl(GOLDEN / "datadog" / "input.jsonl")
    produced = list(DatadogAdapter().to_ctf({"spans": spans}))
    expected = read_jsonl(GOLDEN / "datadog" / "expected.jsonl")
    assert produced == expected
    assert_content_bytes_equal(produced, expected)

    # grouped into two traces, span ids/timings land in turn metadata
    assert [t["id"] for t in produced] == ["ta", "tb"]
    assert produced[0]["messages"][1]["metadata"]["span_id"] == "s1"


# ── ADP-04 ──────────────────────────────────────────────────────────────────


def test_loose_bare_message_list(tmp_path):
    path = write_lines(tmp_path / "d.jsonl", [[{"role": "user", "content": "hi"}]])
    ((line_no, ctf),) = list(iter_source(path))
    assert ctf == {"messages": [{"role": "user", "content": "hi"}], "source": "loose"}


# ── ADP-05 ──────────────────────────────────────────────────────────────────


def test_loose_alias_keys(tmp_path, conn):
    path = write_lines(
        tmp_path / "d.jsonl",
        [
            {
                "conversation": [
                    {"role": "user", "content": "a"},
                    {"role": "assistant", "content": "b"},
                ]
            },
            {"turns": [{"role": "user", "content": "c"}, {"role": "assistant", "content": "d"}]},
        ],
    )
    traces = [ctf for _, ctf in iter_source(path)]
    assert traces[0]["messages"][0] == {"role": "user", "content": "a"}
    assert "conversation" not in traces[0]

    summary = import_file(conn, path)
    assert summary.inserted == 2
    assert any('interpreted "conversation" as "messages"' in n for n in summary.notes)
    assert any('interpreted "turns" as "messages"' in n for n in summary.notes)


# ── ADP-06 ──────────────────────────────────────────────────────────────────


def test_loose_plain_string_document(tmp_path):
    path = write_lines(tmp_path / "d.jsonl", ["just some freeform text"])
    ((_, ctf),) = list(iter_source(path))
    assert ctf == {
        "messages": [{"role": "document", "content": "just some freeform text"}],
        "source": "loose",
    }


# ── ADP-07 ──────────────────────────────────────────────────────────────────


def test_loose_role_synonyms(tmp_path, conn):
    path = write_lines(
        tmp_path / "d.jsonl",
        [
            [
                {"speaker": "human", "content": "hi"},
                {"from": "ai", "content": "hello"},
                {"speaker": "bot", "content": "still me"},
                {"from": "agent", "content": "and me"},
            ]
        ],
    )
    ((_, ctf),) = list(iter_source(path))
    roles = [m["role"] for m in ctf["messages"]]
    assert roles == ["user", "assistant", "assistant", "assistant"]
    assert "speaker" not in ctf["messages"][0]

    summary = import_file(conn, path)
    assert summary.inserted == 1
    assert any("role synonyms" in n for n in summary.notes)


# ── ADP-08 ──────────────────────────────────────────────────────────────────


def test_loose_langsmith(tmp_path):
    path = write_lines(
        tmp_path / "d.jsonl",
        [
            {
                "inputs": {"messages": [{"role": "user", "content": "2+2?"}]},
                "outputs": {"messages": [{"role": "assistant", "content": "4"}]},
                "run_id": "r1",
            }
        ],
    )
    ((_, ctf),) = list(iter_source(path))
    assert [m["role"] for m in ctf["messages"]] == ["user", "assistant"]
    assert ctf["messages"][1]["content"] == "4"
    assert ctf["raw"]["run_id"] == "r1"  # extras → raw


# ── ADP-09 ──────────────────────────────────────────────────────────────────


def test_undetectable_input_dies_with_help(tmp_path):
    path = write_lines(tmp_path / "d.jsonl", [{"foo": "bar", "baz": 1}])
    with pytest.raises(UserError) as ei:
        list(iter_source(path))
    assert "docs/trace-format.md" in str(ei.value)


# ── ADP-10 ──────────────────────────────────────────────────────────────────


def test_duplicate_id_in_file_names_both_lines(tmp_path, conn):
    path = write_lines(
        tmp_path / "d.jsonl",
        [
            {"id": "dup", "messages": [{"role": "user", "content": "one"}]},
            {"id": "dup", "messages": [{"role": "user", "content": "two"}]},
        ],
    )
    with pytest.raises(UserError) as ei:
        import_file(conn, path)
    msg = str(ei.value)
    assert "dup" in msg and ":2" in msg and "line 1" in msg


# ── ADP-11 ──────────────────────────────────────────────────────────────────


def test_skip_invalid_summary(tmp_path, conn):
    path = write_lines(
        tmp_path / "d.jsonl",
        [
            {"messages": [{"role": "user", "content": "ok1"}]},
            {"messages": [{"role": "function", "content": "bad"}]},
            {"messages": [{"role": "user", "content": "ok2"}]},
        ],
    )
    summary = import_file(conn, path, skip_invalid=True)
    assert summary.inserted == 2
    assert len(summary.invalid) == 1
    assert "not a valid role" in summary.invalid[0]

    # fail-fast (default) appends the --skip-invalid hint
    with pytest.raises(UserError) as ei:
        import_file(conn, path)
    assert "--skip-invalid" in str(ei.value)


# ── ADP-12 ──────────────────────────────────────────────────────────────────


def test_as_documents_modes(tmp_path):
    jsonl = tmp_path / "docs.jsonl"
    jsonl.write_text('"a plain string"\n{"role":"user","content":"x"}\n', encoding="utf-8")
    docs = [ctf for _, ctf in iter_source(jsonl, as_documents=True)]
    assert docs[0]["messages"][0]["content"] == "a plain string"
    # a non-string line keeps its raw text verbatim
    assert docs[1]["messages"][0]["content"] == '{"role":"user","content":"x"}'
    assert all(m["messages"][0]["role"] == "document" for m in docs)

    txt = tmp_path / "page.txt"
    body = "Line one.\nLine two.\n\n  trailing spaces   \n"
    txt.write_text(body, encoding="utf-8")
    ((_, whole),) = list(iter_source(txt, as_documents=True))
    assert whole["messages"][0]["content"] == body  # byte-for-byte, incl. trailing whitespace

    html = tmp_path / "page.html"
    html_body = "<html><body><h1>Hi</h1></body></html>"
    html.write_text(html_body, encoding="utf-8")
    ((_, whole_html),) = list(iter_source(html, as_documents=True))
    assert whole_html["messages"][0]["content"] == html_body


# ── ADP-14 (requires P3) ─────────────────────────────────────────────────────


def test_import_file_pipeline(tmp_path, conn):
    path = write_lines(
        tmp_path / "traces.jsonl",
        [
            {
                "id": "t1",
                "messages": [
                    {"role": "user", "content": "hi"},
                    {"role": "assistant", "content": "yo"},
                ],
            },
            {"id": "t2", "messages": [{"role": "document", "content": "a doc"}]},
        ],
    )
    summary = import_file(conn, path)
    assert summary.inserted == 2

    trace = conn.traces.get("t1")
    assert trace is not None and trace["source"] == "ctf"
    turns = conn.traces.get_turns("t1")
    assert [t["role"] for t in turns] == ["user", "assistant"]
    assert [t["id"] for t in turns] == ["t1#0", "t1#1"]

    # idempotent: importing again inserts nothing new
    again = import_file(conn, path)
    assert again.inserted == 0
    assert again.skipped_duplicate == 2
