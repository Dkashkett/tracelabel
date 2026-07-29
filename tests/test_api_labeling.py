"""Tests for the labeling routes (W2-LABELING), rehomed under
/api/projects/{project}/tasks/{task}/...

These exercise the real ``create_app(workspace)`` factory end-to-end: a project is
created on a fresh ``Workspace``, a task row is inserted via ``database.tasks.create``,
and traces are imported directly via ``database.traces`` — the same "construct
services directly" convention as the rest of this test suite (CLAUDE.md). This
supersedes the old flat-route coverage in ``tests/test_api.py`` (skipped, see its
xfail reason), which this module intentionally mirrors for edge cases.
"""

from fastapi.testclient import TestClient

from helpers import make_task_spec, temp_workspace
from tracelabel.api.app import create_app

# A tool-use conversation: user / assistant+tool_calls / tool / assistant.
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
# A single document trace: content lives on the trace row, zero turns.
TRACE_DOC = {
    "id": "t_doc",
    "content": "a document",
    "content_type": "text",
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
]


def _build(tmp_path, *, level="turn", label_roles=None, annotator="alice"):
    """A real workspace with one project, one open task, and two imported traces."""
    workspace = temp_workspace(tmp_path)
    project = workspace.create_project("Demo Project")
    database = workspace.open_database(project.slug)
    database.traces.import_trace(TRACE_CONV, "loose")
    database.traces.import_document(TRACE_DOC, "loose")
    spec = make_task_spec(
        name="task",
        level=level,
        fields=FIELDS,
        label_roles=label_roles if label_roles is not None else ["assistant"],
        annotator=annotator,
    )
    database.tasks.create(spec)
    client = TestClient(create_app(workspace))
    return project.slug, database, client


def _url(project: str, task: str, path: str) -> str:
    return f"/api/projects/{project}/tasks/{task}{path}"


# ── session ──────────────────────────────────────────────────────────────────


def test_session_reflects_task_config(tmp_path):
    project, _database, client = _build(tmp_path)
    body = client.get(_url(project, "task", "/session")).json()
    assert body["task"] == "task"
    assert body["level"] == "turn"
    assert body["annotator"] == "alice"
    assert [f["name"] for f in body["fields"]] == ["verdict", "tags"]
    assert body["mode"] == "labeling"


# ── queue ────────────────────────────────────────────────────────────────────


def test_queue_lists_imported_traces(tmp_path):
    project, _database, client = _build(tmp_path)
    entries = client.get(_url(project, "task", "/queue")).json()
    by_id = {e["trace_id"]: e for e in entries}
    assert set(by_id) == {"t_conv", "t_doc"}
    # turn level: the two assistant turns in t_conv are the labelable targets.
    assert by_id["t_conv"]["n_targets"] == 2
    assert by_id["t_doc"]["n_targets"] == 0


# ── trace detail ─────────────────────────────────────────────────────────────


def test_trace_detail_known_trace(tmp_path):
    project, _database, client = _build(tmp_path)
    body = client.get(_url(project, "task", "/traces/t_conv")).json()
    assert body["trace"]["id"] == "t_conv"
    assert body["trace"]["metadata"] == {"k": "v"}
    assert [t["idx"] for t in body["turns"]] == [0, 1, 2, 3]
    assert body["document"] is None


def test_trace_detail_unknown_trace_404(tmp_path):
    project, _database, client = _build(tmp_path)
    r = client.get(_url(project, "task", "/traces/nope"))
    assert r.status_code == 404


# ── put_annotation ───────────────────────────────────────────────────────────


def test_put_annotation_happy_path(tmp_path):
    project, _database, client = _build(tmp_path)
    r = client.put(
        _url(project, "task", "/annotations"),
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "pass", "tags": ["a"]},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "labeled"
    assert body["values"] == {"verdict": "pass", "tags": ["a"]}
    assert body["annotator"] == "alice"


def test_put_annotation_wrong_target_type_422(tmp_path):
    project, _database, client = _build(tmp_path)  # task level is "turn"
    r = client.put(
        _url(project, "task", "/annotations"),
        json={"target_type": "trace", "target_id": "t_conv", "status": "labeled", "values": {}},
    )
    assert r.status_code == 422


def test_put_annotation_unknown_target_404(tmp_path):
    project, _database, client = _build(tmp_path)
    r = client.put(
        _url(project, "task", "/annotations"),
        json={
            "target_type": "turn",
            "target_id": "t_conv#99",
            "status": "labeled",
            "values": {"verdict": "pass"},
        },
    )
    assert r.status_code == 404


def test_put_annotation_wrong_role_422(tmp_path):
    project, _database, client = _build(tmp_path)
    r = client.put(
        _url(project, "task", "/annotations"),
        json={
            "target_type": "turn",
            "target_id": "t_conv#0",  # user role, not in label_roles=["assistant"]
            "status": "labeled",
            "values": {"verdict": "pass"},
        },
    )
    assert r.status_code == 422


def test_put_annotation_invalid_value_422(tmp_path):
    project, _database, client = _build(tmp_path)
    r = client.put(
        _url(project, "task", "/annotations"),
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "maybe"},
        },
    )
    assert r.status_code == 422


def test_put_annotation_second_put_overwrites_first(tmp_path):
    project, database, client = _build(tmp_path)
    first = client.put(
        _url(project, "task", "/annotations"),
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "pass"},
        },
    ).json()
    second = client.put(
        _url(project, "task", "/annotations"),
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "fail"},
        },
    ).json()
    assert second["values"] == {"verdict": "fail"}
    assert second["updated_at"] >= first["updated_at"]
    count = database.connection.execute(
        "SELECT count(*) FROM annotations WHERE task='task' AND target_id='t_conv#1'"
    ).fetchone()[0]
    assert count == 1


# ── progress ─────────────────────────────────────────────────────────────────


def test_progress_counts_update_after_annotating(tmp_path):
    project, _database, client = _build(tmp_path)
    before = client.get(_url(project, "task", "/progress")).json()
    assert before == {"unit": "turns", "total": 2, "labeled": 0, "skipped": 0}

    client.put(
        _url(project, "task", "/annotations"),
        json={
            "target_type": "turn",
            "target_id": "t_conv#1",
            "status": "labeled",
            "values": {"verdict": "pass"},
        },
    )
    client.put(
        _url(project, "task", "/annotations"),
        json={"target_type": "turn", "target_id": "t_conv#3", "status": "skipped", "values": {}},
    )

    after = client.get(_url(project, "task", "/progress")).json()
    assert after == {"unit": "turns", "total": 2, "labeled": 1, "skipped": 1}


# ── deferred routes (Phase 2/3, not this wave) ───────────────────────────────


def test_items_route_still_stubbed_501(tmp_path):
    project, _database, client = _build(tmp_path)
    r = client.get(_url(project, "task", "/items"))
    assert r.status_code == 501


def test_stats_route_still_stubbed_501(tmp_path):
    project, _database, client = _build(tmp_path)
    r = client.get(_url(project, "task", "/stats"))
    assert r.status_code == 501
