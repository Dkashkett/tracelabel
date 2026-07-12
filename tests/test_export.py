import csv
import io
import json

import pytest

from tracelabel.config.models import ResolvedTaskConfig
from tracelabel.db.database import Database, default_db_path
from tracelabel.errors import UserError
from tracelabel.exporting.serializers import CsvSerializer, JsonlSerializer
from tracelabel.exporting.service import ExportService

FIELDS = [
    {"name": "verdict", "type": "single_select", "options": ["pass", "fail"]},
    {"name": "tags", "type": "multi_select", "options": ["hallucination", "formatting"]},
]


def export_annotations(database, task, format, joined, out, status="all"):
    service = ExportService(database.tasks, database.annotations, database.traces)
    return service.export(task, format, joined, out, status)


def make_cfg(tmp_path, *, name="task", level="turn", fields=None) -> ResolvedTaskConfig:
    return ResolvedTaskConfig(
        name=name,
        level=level,
        fields=fields if fields is not None else FIELDS,
        label_roles=["assistant"],
        shuffle=False,
        annotator="alice",
        schema_hash="h1",
        data_path=tmp_path / "traces.jsonl",
        llm=None,
        suggest_instructions=None,
    )


def ctf_trace(*, id, messages=None):
    return {
        "id": id,
        "messages": messages
        or [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ],
    }


@pytest.fixture
def conn(tmp_path):
    c = Database(default_db_path(tmp_path))
    yield c
    c.close()


@pytest.fixture
def seeded(conn, tmp_path):
    """2 traces, a turn-level task with a multi-select field, 3 annotations
    (one skipped, one with prefill_model), and one suggestion that must not
    appear in export output."""
    conn.traces.import_trace(ctf_trace(id="t1"), "jsonl")
    conn.traces.import_trace(
        ctf_trace(
            id="t2",
            messages=[
                {"role": "user", "content": "q2"},
                {"role": "assistant", "content": "a2"},
            ],
        ),
        "jsonl",
    )
    cfg = make_cfg(tmp_path, name="task")
    conn.tasks.open(cfg, assume_yes=True)

    conn.annotations.upsert_annotation(
        task="task",
        target_type="turn",
        target_id="t1#1",
        status="labeled",
        values={"verdict": "pass", "tags": ["hallucination", "formatting"]},
        annotator="alice",
        schema_hash="h1",
        prefill_model="gpt-4",
    )
    conn.annotations.upsert_annotation(
        task="task",
        target_type="turn",
        target_id="t2#1",
        status="skipped",
        values={},
        annotator="alice",
        schema_hash="h1",
        prefill_model=None,
    )
    conn.annotations.upsert_annotation(
        task="task",
        target_type="turn",
        target_id="t1#0",
        status="labeled",
        values={"verdict": "fail"},
        annotator="bob",
        schema_hash="h1",
        prefill_model=None,
    )
    conn.annotations.upsert_suggestion(
        task="task",
        target_type="turn",
        target_id="t2#1",
        values={"verdict": "pass"},
        model="claude",
        raw_response=None,
    )
    return conn


# EXP-01


def test_columns_stable_snapshot(seeded, tmp_path):
    out = tmp_path / "out.csv"
    export_annotations(seeded, "task", "csv", joined=False, out=out)
    with out.open(newline="") as f:
        header = next(csv.reader(f))
    assert header == [
        "task",
        "trace_id",
        "target_type",
        "target_id",
        "turn_index",
        "annotator",
        "status",
        "prefill_model",
        "schema_hash",
        "created_at",
        "updated_at",
        "value.verdict",
        "value.tags",
    ]


def test_serializers_write_to_injected_streams():
    row = {
        "task": "task",
        "trace_id": "trace",
        "target_type": "trace",
        "target_id": "trace",
        "turn_index": None,
        "annotator": "alice",
        "status": "labeled",
        "prefill_model": None,
        "schema_hash": "hash",
        "created_at": "created",
        "updated_at": "updated",
        "values": {"tags": ["a", "b"]},
    }
    jsonl_stream = io.StringIO()
    JsonlSerializer().write([row], jsonl_stream)
    assert json.loads(jsonl_stream.getvalue()) == row

    csv_stream = io.StringIO()
    CsvSerializer(["tags"], "trace", joined=False).write([row], csv_stream)
    parsed = next(csv.DictReader(io.StringIO(csv_stream.getvalue())))
    assert json.loads(parsed["value.tags"]) == ["a", "b"]


# EXP-02


def test_csv_multiselect_json_array(seeded, tmp_path):
    out = tmp_path / "out.csv"
    export_annotations(seeded, "task", "csv", joined=False, out=out)
    with out.open(newline="") as f:
        rows = list(csv.DictReader(f))
    row = next(r for r in rows if r["target_id"] == "t1#1")
    assert json.loads(row["value.tags"]) == ["hallucination", "formatting"]


# EXP-03


def test_joined_turn_level(seeded, tmp_path):
    out = tmp_path / "out.jsonl"
    export_annotations(seeded, "task", "jsonl", joined=True, out=out)
    rows = [json.loads(line) for line in out.read_text().splitlines()]
    row = next(r for r in rows if r["target_id"] == "t1#1")
    assert row["role"] == "assistant"
    assert row["content"] == "hello"
    assert row["content_type"] == "text"


def test_joined_trace_level(conn, tmp_path):
    conn.traces.import_trace(
        {
            "id": "t1",
            "metadata": {"env": "prod"},
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
            ],
        },
        "jsonl",
    )
    cfg = make_cfg(tmp_path, name="tracetask", level="trace")
    conn.tasks.open(cfg, assume_yes=True)
    conn.annotations.upsert_annotation(
        task="tracetask",
        target_type="trace",
        target_id="t1",
        status="labeled",
        values={"verdict": "pass"},
        annotator="alice",
        schema_hash="h1",
        prefill_model=None,
    )
    out = tmp_path / "out.jsonl"
    export_annotations(conn, "tracetask", "jsonl", joined=True, out=out)
    rows = [json.loads(line) for line in out.read_text().splitlines()]
    assert len(rows) == 1
    row = rows[0]
    assert row["turn_index"] is None
    assert row["trace_id"] == "t1"
    assert row["trace_metadata"] == {"env": "prod"}
    assert row["messages"] == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]


# EXP-04


def test_status_filter(seeded, tmp_path):
    out = tmp_path / "out.jsonl"
    n = export_annotations(seeded, "task", "jsonl", joined=False, out=out, status="labeled")
    rows = [json.loads(line) for line in out.read_text().splitlines()]
    assert n == 2
    assert all(r["status"] == "labeled" for r in rows)

    out_all = tmp_path / "out_all.jsonl"
    n_all = export_annotations(seeded, "task", "jsonl", joined=False, out=out_all, status="all")
    rows_all = [json.loads(line) for line in out_all.read_text().splitlines()]
    assert n_all == 3
    skipped = next(r for r in rows_all if r["status"] == "skipped")
    assert skipped["values"] == {"verdict": None, "tags": None}


# EXP-05


def test_out_stdout_and_default_name(seeded, tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    n = export_annotations(seeded, "task", "jsonl", joined=False, out=None)
    assert n == 3
    default_path = tmp_path / "task-annotations.jsonl"
    assert default_path.exists()

    from pathlib import Path

    n2 = export_annotations(seeded, "task", "jsonl", joined=False, out=Path("-"))
    captured = capsys.readouterr()
    assert n2 == 3
    stdout_rows = [json.loads(line) for line in captured.out.splitlines()]
    assert len(stdout_rows) == 3
    # row count + path go to stderr, keeping stdout clean data-only
    assert "3" in captured.err


def test_unknown_task_lists_existing(seeded, tmp_path):
    with pytest.raises(UserError) as ei:
        export_annotations(seeded, "nope", "jsonl", joined=False, out=tmp_path / "x.jsonl")
    assert "task" in str(ei.value)


# EXP-07


def test_suggestions_not_exported(seeded, tmp_path):
    out = tmp_path / "out.jsonl"
    export_annotations(seeded, "task", "jsonl", joined=False, out=out)
    rows = [json.loads(line) for line in out.read_text().splitlines()]
    assert all(r["target_id"] != "t2#1" or r["status"] == "skipped" for r in rows)
    # the suggestion's model never leaks into any row
    assert all("model" not in r for r in rows)
    assert len(rows) == 3
