"""Tests for /api/projects and /api/settings (W2-PROJECTS)."""

from fastapi.testclient import TestClient

from helpers import make_task_spec, temp_workspace
from tracelabel.api.app import create_app
from tracelabel.workspace.workspace import Workspace


def _client(workspace: Workspace) -> TestClient:
    return TestClient(create_app(workspace))


# ── projects: list / create ─────────────────────────────────────────────────


def test_list_projects_empty(tmp_path):
    client = _client(temp_workspace(tmp_path))
    r = client.get("/api/projects")
    assert r.status_code == 200
    assert r.json() == []


def test_create_project_returns_summary(tmp_path):
    client = _client(temp_workspace(tmp_path))
    r = client.post("/api/projects", json={"name": "Support Triage", "notes": "q1 backlog"})
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "support-triage"
    assert body["name"] == "Support Triage"
    assert body["task_count"] == 0
    assert body["source_count"] == 0
    assert "created_at" in body


def test_list_projects_after_create(tmp_path):
    client = _client(temp_workspace(tmp_path))
    client.post("/api/projects", json={"name": "Alpha"})
    client.post("/api/projects", json={"name": "Beta"})
    r = client.get("/api/projects")
    assert r.status_code == 200
    slugs = {p["slug"] for p in r.json()}
    assert slugs == {"alpha", "beta"}


# ── projects: get detail ─────────────────────────────────────────────────────


def test_get_project_detail_empty(tmp_path):
    client = _client(temp_workspace(tmp_path))
    client.post("/api/projects", json={"name": "Alpha", "notes": "hello"})
    r = client.get("/api/projects/alpha")
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "alpha"
    assert body["name"] == "Alpha"
    assert body["notes"] == "hello"
    assert body["tasks"] == []
    assert body["sources"] == []


def test_get_project_detail_counts_tasks_and_sources(tmp_path):
    workspace = temp_workspace(tmp_path)
    client = _client(workspace)
    client.post("/api/projects", json={"name": "Alpha"})

    database = workspace.open_database("alpha")
    database.tasks.create(make_task_spec(name="triage"))
    database.sources.record_import(
        name="import-1", path="/tmp/traces.jsonl", adapter="loose", trace_ids=[]
    )

    list_body = client.get("/api/projects").json()
    assert list_body[0]["task_count"] == 1
    assert list_body[0]["source_count"] == 1

    detail = client.get("/api/projects/alpha").json()
    assert len(detail["tasks"]) == 1
    task = detail["tasks"][0]
    assert task["name"] == "triage"
    assert "compat_hash" in task
    assert len(detail["sources"]) == 1
    assert detail["sources"][0]["name"] == "import-1"
    assert detail["sources"][0]["adapter"] == "loose"


def test_get_unknown_project_404(tmp_path):
    client = _client(temp_workspace(tmp_path))
    r = client.get("/api/projects/nope")
    assert r.status_code == 404


# ── projects: delete ─────────────────────────────────────────────────────────


def test_delete_project(tmp_path):
    client = _client(temp_workspace(tmp_path))
    client.post("/api/projects", json={"name": "Alpha"})
    r = client.delete("/api/projects/alpha")
    assert r.status_code == 204
    assert client.get("/api/projects/alpha").status_code == 404


def test_delete_unknown_project_404(tmp_path):
    client = _client(temp_workspace(tmp_path))
    r = client.delete("/api/projects/nope")
    assert r.status_code == 404


# ── settings ─────────────────────────────────────────────────────────────────


def test_get_settings_defaults(tmp_path):
    client = _client(temp_workspace(tmp_path))
    r = client.get("/api/settings")
    assert r.status_code == 200
    assert r.json() == {"annotator": None, "default_llm_model": None, "theme": "system"}


def test_patch_settings_sets_fields(tmp_path):
    client = _client(temp_workspace(tmp_path))
    r = client.patch("/api/settings", json={"annotator": "alice", "theme": "dark"})
    assert r.status_code == 200
    body = r.json()
    assert body["annotator"] == "alice"
    assert body["theme"] == "dark"
    assert body["default_llm_model"] is None


def test_patch_settings_partial_does_not_clobber_other_fields(tmp_path):
    client = _client(temp_workspace(tmp_path))
    client.patch("/api/settings", json={"annotator": "alice", "default_llm_model": "gpt-4"})
    r = client.patch("/api/settings", json={"theme": "light"})
    assert r.status_code == 200
    body = r.json()
    assert body["annotator"] == "alice"
    assert body["default_llm_model"] == "gpt-4"
    assert body["theme"] == "light"

    # confirm it persisted, not just returned
    follow_up = client.get("/api/settings").json()
    assert follow_up == body
