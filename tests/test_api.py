import itertools

import pytest
from fastapi.testclient import TestClient

from tracelabel.api.app import create_app
from tracelabel.config.models import ResolvedTaskConfig
from tracelabel.db.database import Database, default_db_path

# ── fixtures ─────────────────────────────────────────────────────────────────

# Trace A: a tool-use conversation (user / assistant+tool_calls / tool / assistant).
TRACE_CONV = {
    "id": "t_conv",
    "source": "loose",
    "metadata": {"k": "v"},
    "messages": [
        {"role": "user", "content": "hi"},
        {
            "role": "assistant",
            "content": "let me check",
            "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": "f", "arguments": "{}"}}
            ],
        },
        {"role": "tool", "content": "result", "tool_call_id": "c1"},
        {"role": "assistant", "content": "done"},
    ],
}
# Trace B: a single document.
TRACE_DOC = {
    "id": "t_doc",
    "messages": [{"role": "document", "content": "a document"}],
}

FIELDS = [
    {
        "name": "verdict",
        "label": "Verdict",
        "type": "single_select",
        "required": True,
        "options": ["pass", "fail"],
    },
    {
        "name": "tags",
        "label": "Tags",
        "type": "multi_select",
        "required": False,
        "options": ["a", "b", "c"],
    },
    {"name": "notes", "label": "Notes", "type": "text", "required": False},
]

SCHEMA_HASH = "sh_test"


def _cfg(tmp_path, *, level="turn", label_roles=None, annotator="alice"):
    return ResolvedTaskConfig(
        name="task",
        level=level,
        fields=FIELDS,
        label_roles=label_roles if label_roles is not None else ["assistant", "document"],
        shuffle=False,
        annotator=annotator,
        schema_hash=SCHEMA_HASH,
        data_path=tmp_path / "traces.jsonl",
        llm=None,
        suggest_instructions=None,
    )


def build(tmp_path, *, level="turn", label_roles=None, annotator="alice", clock=None):
    conn = Database(default_db_path(tmp_path), clock=clock)
    conn.traces.import_trace(TRACE_CONV, "loose")
    conn.traces.import_trace(TRACE_DOC, "loose")
    cfg = _cfg(tmp_path, level=level, label_roles=label_roles, annotator=annotator)
    conn.tasks.open(cfg, assume_yes=True)
    queue = conn.tasks.build_queue(cfg.name)
    client = TestClient(create_app(conn, cfg, queue))
    return conn, cfg, client


@pytest.fixture
def turn_client(tmp_path):
    _conn, _cfg_, client = build(tmp_path)
    return client


# ── API-01 ───────────────────────────────────────────────────────────────────


def test_session_fields_in_order(turn_client):
    r = turn_client.get("/api/session")
    assert r.status_code == 200
    body = r.json()
    assert body["task"] == "task"
    assert body["level"] == "turn"
    assert body["annotator"] == "alice"
    assert body["schema_hash"] == SCHEMA_HASH
    assert [f["name"] for f in body["fields"]] == ["verdict", "tags", "notes"]


# ── API-02 ───────────────────────────────────────────────────────────────────


def test_queue_positions_and_counts(turn_client):
    r = turn_client.get("/api/queue")
    assert r.status_code == 200
    entries = r.json()
    by_id = {e["trace_id"]: e for e in entries}
    assert by_id["t_conv"]["position"] == 0
    assert by_id["t_doc"]["position"] == 1
    # turn level: labelable turns are the two assistant turns + the document turn.
    assert by_id["t_conv"]["n_targets"] == 2
    assert by_id["t_doc"]["n_targets"] == 1
    assert by_id["t_conv"]["n_labeled"] == 0
    assert by_id["t_conv"]["n_skipped"] == 0


# ── API-03 ───────────────────────────────────────────────────────────────────


def test_unknown_trace_404(turn_client):
    assert turn_client.get("/api/traces/nope").status_code == 404


def test_trace_detail_shape(turn_client):
    body = turn_client.get("/api/traces/t_conv").json()
    assert body["trace"]["id"] == "t_conv"
    assert body["trace"]["source"] == "loose"
    assert body["trace"]["metadata"] == {"k": "v"}
    assert [t["idx"] for t in body["turns"]] == [0, 1, 2, 3]
    labelable = {t["id"]: t["labelable"] for t in body["turns"]}
    assert labelable == {
        "t_conv#0": False,  # user
        "t_conv#1": True,  # assistant
        "t_conv#2": False,  # tool
        "t_conv#3": True,  # assistant
    }
    assert body["turns"][1]["tool_calls"][0]["id"] == "c1"


# ── API-04 ───────────────────────────────────────────────────────────────────


def test_target_type_must_match_level(turn_client):
    r = turn_client.put(
        "/api/annotations",
        json={"target_type": "trace", "target_id": "t_conv", "status": "labeled", "values": {}},
    )
    assert r.status_code == 422


# ── API-05 ───────────────────────────────────────────────────────────────────


def test_unknown_target_404(turn_client):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#99",
            "status": "labeled",
            "values": {"verdict": "pass"},
        },
    )
    assert r.status_code == 404


# ── API-06 ───────────────────────────────────────────────────────────────────


def test_non_labelable_turn_422(turn_client):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#0",  # user role ∉ label_roles
            "status": "labeled",
            "values": {"verdict": "pass"},
        },
    )
    assert r.status_code == 422


# ── API-07 ───────────────────────────────────────────────────────────────────


def test_skipped_with_values_422(turn_client):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "skipped",
            "values": {"verdict": "pass"},
        },
    )
    assert r.status_code == 422


# ── API-08 ───────────────────────────────────────────────────────────────────


def test_unknown_field_422(turn_client):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"bogus": "x"},
        },
    )
    assert r.status_code == 422


# ── API-09 ───────────────────────────────────────────────────────────────────


def test_single_select_bad_value_422(turn_client):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "maybe"},
        },
    )
    assert r.status_code == 422


# ── API-10 ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "tags",
    [
        "a",  # not a list
        ["z"],  # bad member
        ["a", "a"],  # duplicates
    ],
)
def test_multi_select_invalid_422(turn_client, tags):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "pass", "tags": tags},
        },
    )
    assert r.status_code == 422


# ── API-11 ───────────────────────────────────────────────────────────────────


def test_text_not_a_string_422(turn_client):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "pass", "notes": 123},
        },
    )
    assert r.status_code == 422


# ── API-12 ───────────────────────────────────────────────────────────────────


def test_required_field_missing_422(turn_client):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {},
        },
    )
    assert r.status_code == 422


# ── API-13 ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("value", ["", []])
def test_required_field_empty_422(turn_client, value):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": value},
        },
    )
    assert r.status_code == 422


# ── API-14 ───────────────────────────────────────────────────────────────────


def test_valid_labeled_commit(tmp_path):
    conn, cfg, client = build(tmp_path)
    r = client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "pass", "tags": ["a", "b"], "notes": "good"},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "labeled"
    assert body["schema_hash"] == SCHEMA_HASH
    assert body["annotator"] == "alice"
    row = conn.connection.execute(
        "SELECT * FROM annotations WHERE task=? AND target_id=?", (cfg.name, "t_conv#1")
    ).fetchone()
    assert row is not None
    assert row["schema_hash"] == SCHEMA_HASH


# ── API-15 ───────────────────────────────────────────────────────────────────


def test_second_commit_updates_row(tmp_path):
    stamps = (f"2026-07-11T00:00:{n:02d}Z" for n in itertools.count(1))
    conn, cfg, client = build(tmp_path, clock=lambda: next(stamps))
    first = client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "pass"},
        },
    ).json()
    second = client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "fail"},
        },
    ).json()
    assert second["updated_at"] > first["updated_at"]
    assert second["values"] == {"verdict": "fail"}
    n = conn.connection.execute(
        "SELECT count(*) FROM annotations WHERE task=? AND target_id=?", (cfg.name, "t_conv#1")
    ).fetchone()[0]
    assert n == 1


# ── API-16 ───────────────────────────────────────────────────────────────────


def test_valid_skip(turn_client):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "skipped",
            "values": {},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "skipped"
    assert body["values"] == {}


# ── API-17 ───────────────────────────────────────────────────────────────────


def test_prefill_model_persisted(tmp_path):
    conn, cfg, client = build(tmp_path)
    body = client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "pass"},
            "prefill_model": "gpt-4",
        },
    ).json()
    assert body["prefill_model"] == "gpt-4"
    row = conn.connection.execute(
        "SELECT prefill_model FROM annotations WHERE target_id=?", ("t_conv#1",)
    ).fetchone()
    assert row["prefill_model"] == "gpt-4"


# ── API-18 ───────────────────────────────────────────────────────────────────


def test_progress_reflects_commits(turn_client):
    turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "pass"},
        },
    )
    turn_client.put(
        "/api/annotations",
        json={"target_type": "turn", "target_id": "t_conv#3", "status": "skipped", "values": {}},
    )
    body = turn_client.get("/api/progress").json()
    assert body["unit"] == "turns"
    assert body["total"] == 3  # 2 assistant turns + 1 document turn
    assert body["labeled"] == 1
    assert body["skipped"] == 1


# ── API-19 ───────────────────────────────────────────────────────────────────


def test_suggestions_not_merged_into_annotations(tmp_path):
    conn, cfg, client = build(tmp_path)
    conn.annotations.upsert_suggestion(
        task=cfg.name,
        target_type="turn",
        target_id="t_conv#1",
        values={"verdict": "pass"},
        model="gpt-4",
        raw_response=None,
    )
    body = client.get("/api/traces/t_conv").json()
    assert "t_conv#1" in body["suggestions"]
    assert body["suggestions"]["t_conv#1"]["model"] == "gpt-4"
    assert "t_conv#1" not in body["annotations"]


# ── API-20 ───────────────────────────────────────────────────────────────────


def test_spa_fallback_and_api_404(tmp_path):
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "index.html").write_text("<!doctype html>MARKER", encoding="utf-8")
    conn = Database(default_db_path(tmp_path / "proj"))
    conn.traces.import_trace(TRACE_CONV, "loose")
    cfg = _cfg(tmp_path)
    conn.tasks.open(cfg, assume_yes=True)
    client = TestClient(create_app(conn, cfg, ["t_conv"], static_dir=static_dir))

    page = client.get("/some/spa/route")
    assert page.status_code == 200
    assert "MARKER" in page.text

    api = client.get("/api/nope")
    assert api.status_code == 404
    assert "detail" in api.json()


def test_missing_frontend_503(tmp_path):
    empty_static = tmp_path / "empty-static"
    empty_static.mkdir()
    conn, cfg, _ = build(tmp_path)
    queue = conn.tasks.build_queue(cfg.name)
    client = TestClient(create_app(conn, cfg, queue, static_dir=empty_static))
    r = client.get("/")
    assert r.status_code == 503
    assert "npm run build" in r.json()["detail"]


# ── API-21 ───────────────────────────────────────────────────────────────────


def test_extra_keys_rejected(turn_client):
    r = turn_client.put(
        "/api/annotations",
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "pass"},
            "surprise": 1,
        },
    )
    assert r.status_code == 422
