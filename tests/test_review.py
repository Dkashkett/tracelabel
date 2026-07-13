import json
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tracelabel.api.app import create_app
from tracelabel.config.models import CliArgs, RawConfig, ResolvedTaskConfig
from tracelabel.config.resolver import ConfigResolver
from tracelabel.db.database import Database, default_db_path
from tracelabel.errors import UserError
from tracelabel.imports.labels import LabelIngestService

FIELDS = [
    {
        "name": "verdict",
        "label": "Verdict",
        "type": "single_select",
        "required": True,
        "options": ["pass", "fail"],
    },
    {"name": "reasoning", "label": "Reasoning", "type": "text", "required": False},
]

# Trace-level source lines carrying a judge label under the default "judge" key.
SOURCE_LINES = [
    {
        "id": "t1",
        "messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hey"}],
        "judge": {"verdict": "pass", "reasoning": "greeted back"},
    },
    {
        "id": "t2",
        "messages": [{"role": "user", "content": "2+2?"}, {"role": "assistant", "content": "5"}],
        "judge": {"verdict": "pass", "reasoning": "answered"},
    },
]


def _write_source(tmp_path: Path) -> Path:
    path = tmp_path / "traces.jsonl"
    path.write_text("\n".join(json.dumps(line) for line in SOURCE_LINES), encoding="utf-8")
    return path


def _cfg(tmp_path: Path, *, annotator="me", review_of="gpt-4o", labels_from="judge"):
    return ResolvedTaskConfig(
        name="task",
        level="trace",
        fields=FIELDS,
        label_roles=["assistant"],
        shuffle=False,
        annotator=annotator,
        schema_hash="sh_test",
        data_path=tmp_path / "traces.jsonl",
        llm=None,
        suggest_instructions=None,
        review_of=review_of,
        review_labels_from=labels_from,
    )


def _build(tmp_path: Path):
    source = _write_source(tmp_path)
    db = Database(default_db_path(tmp_path))
    for line in SOURCE_LINES:
        db.traces.import_trace(line, "loose")
    cfg = _cfg(tmp_path)
    db.tasks.open(cfg, assume_yes=True)
    LabelIngestService(db.annotations).ingest(source, cfg)
    queue = db.tasks.build_queue(cfg.name)
    client = TestClient(create_app(db, cfg, queue))
    return db, cfg, client


# ── ingest ───────────────────────────────────────────────────────────────────


def test_ingest_writes_judge_annotations(tmp_path):
    db, cfg, _client = _build(tmp_path)
    rows = db.annotations.annotations_for_trace(cfg.name, "gpt-4o", "t1")
    assert len(rows) == 1
    row = rows[0]
    assert row["annotator"] == "gpt-4o"
    assert row["target_type"] == "trace"
    assert row["prefill_model"] == "gpt-4o"
    assert json.loads(row["values"]) == {"verdict": "pass", "reasoning": "greeted back"}


def test_ingest_missing_id_errors(tmp_path):
    source = tmp_path / "traces.jsonl"
    source.write_text(json.dumps({"messages": [], "judge": {"verdict": "pass"}}), encoding="utf-8")
    db = Database(default_db_path(tmp_path))
    cfg = _cfg(tmp_path)
    db.tasks.open(cfg, assume_yes=True)
    with pytest.raises(UserError, match="needs an 'id'"):
        LabelIngestService(db.annotations).ingest(source, cfg)


def test_ingest_invalid_value_errors(tmp_path):
    source = tmp_path / "traces.jsonl"
    source.write_text(
        json.dumps({"id": "t1", "messages": [], "judge": {"verdict": "maybe"}}), encoding="utf-8"
    )
    db = Database(default_db_path(tmp_path))
    cfg = _cfg(tmp_path)
    db.tasks.open(cfg, assume_yes=True)
    with pytest.raises(UserError, match="is invalid"):
        LabelIngestService(db.annotations).ingest(source, cfg)


def test_ingest_turn_level_unsupported(tmp_path):
    source = _write_source(tmp_path)
    db = Database(default_db_path(tmp_path))
    cfg = replace(_cfg(tmp_path), level="turn")
    db.tasks.open(cfg, assume_yes=True)
    with pytest.raises(UserError, match="trace-level"):
        LabelIngestService(db.annotations).ingest(source, cfg)


# ── review session ───────────────────────────────────────────────────────────


def test_session_reports_review_mode(tmp_path):
    _db, _cfg_, client = _build(tmp_path)
    body = client.get("/api/session").json()
    assert body["mode"] == "review"
    assert body["review_of"] == "gpt-4o"


def test_queue_counts_are_scoped_to_judge_targets(tmp_path):
    _db, _cfg_, client = _build(tmp_path)
    entries = {e["trace_id"]: e for e in client.get("/api/queue").json()}
    # both traces carry a judge label ⇒ each is one review target, none reviewed yet
    assert entries["t1"]["n_targets"] == 1
    assert entries["t1"]["n_labeled"] == 0
    assert entries["t2"]["n_targets"] == 1


def test_trace_detail_exposes_judge_label(tmp_path):
    _db, _cfg_, client = _build(tmp_path)
    body = client.get("/api/traces/t1").json()
    assert body["review_of"]["t1"]["values"] == {"verdict": "pass", "reasoning": "greeted back"}
    assert body["annotations"] == {}  # reviewer hasn't committed yet


def test_review_commit_preserves_judge_and_counts(tmp_path):
    db, cfg, client = _build(tmp_path)
    # reviewer corrects t2 (judge said pass, human says fail)
    r = client.put(
        "/api/annotations",
        json={
            "target_type": "trace",
            "target_id": "t2",
            "status": "labeled",
            "values": {"verdict": "fail", "reasoning": "wrong answer"},
            "prefill_model": "gpt-4o",
        },
    )
    assert r.status_code == 200
    # judge annotation is untouched; reviewer annotation coexists
    judge = db.annotations.annotations_for_trace(cfg.name, "gpt-4o", "t2")[0]
    reviewer = db.annotations.annotations_for_trace(cfg.name, "me", "t2")[0]
    assert json.loads(judge["values"])["verdict"] == "pass"
    assert json.loads(reviewer["values"])["verdict"] == "fail"
    # progress now counts one reviewed of two judge targets
    progress = client.get("/api/progress").json()
    assert progress["total"] == 2
    assert progress["labeled"] == 1


# ── resolver guard ───────────────────────────────────────────────────────────


def test_resolver_rejects_reviewer_equals_judge(tmp_path):
    raw = RawConfig(data=tmp_path / "traces.jsonl")
    cli = CliArgs(annotator="gpt-4o", review_of="gpt-4o")
    with pytest.raises(UserError, match="must differ"):
        ConfigResolver().resolve(raw, cli)
