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
from tracelabel.imports.adapters.documents import DocumentsAdapter
from tracelabel.imports.adapters.loose import LooseAdapter
from tracelabel.imports.parsing import iter_target as parse_target
from tracelabel.imports.service import ImportService

GOLDEN = Path(__file__).parent / "golden"


def detect(values):
    return AdapterRegistry.default().detect(values)


def iter_target(path, from_="auto", as_documents=False):
    return parse_target(
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
    doc_string = "just some freeform text"
    doc_obj = {"content": "hi", "id": "d1"}

    assert isinstance(detect([ctf]), CtfAdapter)
    assert isinstance(detect([adk]), AdkAdapter)
    assert isinstance(detect([dd]), DatadogAdapter)
    assert isinstance(detect([doc_string]), DocumentsAdapter)
    assert isinstance(detect([doc_obj]), DocumentsAdapter)
    assert isinstance(detect([loose]), LooseAdapter)

    # ctf wins over loose when both could plausibly match (priority order)
    assert isinstance(detect([ctf, loose]), CtfAdapter)
    # documents wins over loose for bare strings (documents is earlier in priority order)
    assert isinstance(detect([doc_string, loose]), DocumentsAdapter)

    # a dict carrying "messages" or "role" must never be swallowed as a document
    trace_like = {
        "content": "not actually a document",
        "messages": [{"role": "user", "content": "hi"}],
    }
    assert not DocumentsAdapter().sniff([trace_like])
    assert isinstance(detect([trace_like]), CtfAdapter)  # ctf still wins overall


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
            return "inserted", "generated-id"

    validator = RecordingValidator()
    repository = RecordingRepository()
    service = ImportService(AdapterRegistry((FakeAdapter,)), validator, repository)
    summary = service.import_file(path)

    assert summary.inserted == 1
    assert summary.trace_ids == ["generated-id"]
    assert validator.validated[0][2] == 1
    assert repository.imported == [
        (
            {"messages": [{"role": "user", "content": "raw"}]},
            "fake",
            "fail",
        )
    ]


def test_import_summary_trace_ids_covers_all_known_results_deduped(conn, tmp_path):
    # pre-existing rows in the db: "dup" (will be re-imported unchanged) and "keep" (will
    # conflict on re-import with a different body, kept under --on-conflict skip)
    conn.traces.import_trace({"id": "dup", "messages": [{"role": "user", "content": "hi"}]}, "seed")
    conn.traces.import_trace(
        {"id": "keep", "messages": [{"role": "user", "content": "original"}]}, "seed"
    )

    # same content twice (no id) → both derive the same generated id: inserted, then
    # skipped_duplicate — trace_ids must only list it once (generated-id dedup)
    same_content = {"messages": [{"role": "user", "content": "twin"}]}
    path = write_lines(
        tmp_path / "input.jsonl",
        [
            {"id": "new", "messages": [{"role": "user", "content": "fresh"}]},
            {"id": "dup", "messages": [{"role": "user", "content": "hi"}]},
            {"id": "keep", "messages": [{"role": "user", "content": "different"}]},
            same_content,
            same_content,
        ],
    )
    summary = import_file(conn, path, on_conflict="skip")

    assert summary.inserted == 2  # "new" + the first copy of same_content
    assert summary.skipped_duplicate == 2  # "dup" + the second copy of same_content
    assert summary.skipped_conflict == 1  # "keep"
    assert summary.trace_ids[:3] == ["new", "dup", "keep"]
    assert len(summary.trace_ids) == 4  # same_content's generated id counted once


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
    ((_, _, ctf),) = list(iter_target(path).items)
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
    traces = [ctf for _, _, ctf in iter_target(path).items]
    assert traces[0]["messages"][0] == {"role": "user", "content": "a"}
    assert "conversation" not in traces[0]

    summary = import_file(conn, path)
    assert summary.inserted == 2
    assert any('interpreted "conversation" as "messages"' in n for n in summary.notes)
    assert any('interpreted "turns" as "messages"' in n for n in summary.notes)


# ── ADP-06 ──────────────────────────────────────────────────────────────────
# A bare string line no longer maps to a `role: "document"` message (that role was
# removed from the message Role enum). It now auto-detects as a DocumentsAdapter
# document; see test_golden_documents and the "documents" tests below.


def test_bare_string_line_auto_detects_as_document(tmp_path):
    path = write_lines(tmp_path / "d.jsonl", ["just some freeform text"])
    plan = iter_target(path)
    assert plan.adapter is not None and plan.adapter.name == "documents"
    ((_, _, doc),) = list(plan.items)
    assert doc == {"content": "just some freeform text", "content_type": "text"}


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
    ((_, _, ctf),) = list(iter_target(path).items)
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
    ((_, _, ctf),) = list(iter_target(path).items)
    assert [m["role"] for m in ctf["messages"]] == ["user", "assistant"]
    assert ctf["messages"][1]["content"] == "4"
    assert ctf["raw"]["run_id"] == "r1"  # extras → raw


# ── ADP-09 ──────────────────────────────────────────────────────────────────


def test_undetectable_input_dies_with_help(tmp_path):
    path = write_lines(tmp_path / "d.jsonl", [{"foo": "bar", "baz": 1}])
    with pytest.raises(UserError) as ei:
        list(iter_target(path).items)
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


def test_golden_documents():
    values = read_jsonl(GOLDEN / "documents" / "input.jsonl")
    produced = [next(iter(DocumentsAdapter().to_ctf(value))) for value in values]
    expected = read_jsonl(GOLDEN / "documents" / "expected.jsonl")
    assert produced == expected

    assert produced[0]["content_type"] == "text"  # bare string defaults to text
    assert produced[1]["id"] == "readme"
    assert produced[2]["metadata"] == {"path": "notes.txt"}


def test_as_documents_forced(tmp_path):
    path = write_lines(
        tmp_path / "docs.jsonl",
        [
            "a plain string",
            {"content": "explicit content", "id": "d1", "content_type": "markdown"},
        ],
    )
    plan = iter_target(path, as_documents=True)
    assert plan.adapter is not None and plan.adapter.name == "documents"
    docs = [ctf for _, _, ctf in plan.items]
    assert docs[0] == {"content": "a plain string", "content_type": "text"}
    assert docs[1] == {"content": "explicit content", "id": "d1", "content_type": "markdown"}


def test_as_documents_object_without_content_errors(tmp_path):
    # Pre-release, forced/documents mode used to fall back to keeping the raw line
    # verbatim for anything it couldn't interpret; that silently mislabeled malformed
    # lines, so an object with no "content" key now errors loudly instead.
    path = write_lines(tmp_path / "docs.jsonl", [{"messages": [{"role": "user", "content": "hi"}]}])
    with pytest.raises(UserError) as ei:
        list(iter_target(path, as_documents=True).items)
    assert "could not interpret this line as a document" in str(ei.value)


def test_single_document_file_rejected(tmp_path):
    md = tmp_path / "notes.md"
    md.write_text("# hi", encoding="utf-8")
    with pytest.raises(UserError) as ei:
        iter_target(md)
    msg = str(ei.value)
    assert "not a supported target" in msg
    assert "directory" in msg


def test_from_adapter_rejected_for_directory(tmp_path):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "a.md").write_text("# Title", encoding="utf-8")
    with pytest.raises(UserError) as ei:
        iter_target(docs_dir, from_="ctf")
    assert "--from cannot be combined with a directory target" in str(ei.value)


def test_directory_import(tmp_path, conn):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "a.md").write_text("# Title\n\n- item\n", encoding="utf-8")
    (docs_dir / "b.txt").write_text("plain text\n", encoding="utf-8")
    (docs_dir / "weird#name.txt").write_text("weird\n", encoding="utf-8")
    (docs_dir / ".hidden.md").write_text("hidden\n", encoding="utf-8")
    (docs_dir / "c.json").write_text('{"messages": []}', encoding="utf-8")
    (docs_dir / "d.unknownext").write_text("nope", encoding="utf-8")

    summary = import_file(conn, docs_dir)
    assert summary.inserted == 3
    assert any("skipped 3 unsupported files" in n for n in summary.notes)

    a = conn.traces.get("a.md")
    assert a is not None
    assert a["content"] == "# Title\n\n- item\n"
    assert a["content_type"] == "markdown"
    assert json.loads(a["metadata"])["path"] == str(docs_dir / "a.md")
    assert conn.traces.get_turns("a.md") == []

    b = conn.traces.get("b.txt")
    assert b is not None and b["content_type"] == "text"

    # '#' in a filename is sanitized (turn-id scheme is `{trace_id}#{idx}`)
    weird = conn.traces.get("weird_name.txt")
    assert weird is not None
    assert weird["content"] == "weird\n"

    # idempotent re-import
    again = import_file(conn, docs_dir)
    assert again.inserted == 0
    assert again.skipped_duplicate == 3


def test_directory_import_no_importable_files(tmp_path):
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    (empty_dir / "notes.json").write_text("{}", encoding="utf-8")
    with pytest.raises(UserError) as ei:
        iter_target(empty_dir)
    assert "no importable files found" in str(ei.value)


def test_directory_import_non_utf8_file_fails_fast(tmp_path, conn):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "bad.txt").write_bytes(b"\xff\xfe bad bytes")
    with pytest.raises(UserError) as ei:
        import_file(conn, docs_dir)
    assert "UTF-8" in str(ei.value)


def test_directory_import_non_utf8_file_skip_invalid(tmp_path, conn):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "a-good.txt").write_text("hello", encoding="utf-8")
    (docs_dir / "z-bad.txt").write_bytes(b"\xff\xfe bad bytes")

    summary = import_file(conn, docs_dir, skip_invalid=True)
    assert summary.inserted == 1
    assert len(summary.invalid) == 1
    assert "UTF-8" in summary.invalid[0]
    assert conn.traces.get("a-good.txt") is not None


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
            {"id": "t2", "content": "a doc", "content_type": "text"},
        ],
    )
    summary = import_file(conn, path)
    assert summary.inserted == 2

    trace = conn.traces.get("t1")
    assert trace is not None and trace["source"] == "ctf"
    turns = conn.traces.get_turns("t1")
    assert [t["role"] for t in turns] == ["user", "assistant"]
    assert [t["id"] for t in turns] == ["t1#0", "t1#1"]

    doc = conn.traces.get("t2")
    assert doc is not None and doc["content"] == "a doc" and doc["content_type"] == "text"
    assert conn.traces.get_turns("t2") == []

    # idempotent: importing again inserts nothing new
    again = import_file(conn, path)
    assert again.inserted == 0
    assert again.skipped_duplicate == 2
