"""Tests for /api/projects/{project}/tasks/* (api/routes/tasks.py).

Builds a real Workspace + FastAPI app (create_app) and drives it with TestClient,
so these tests exercise the actual routing, dependency wiring, and error-handler
mapping (NotFoundError -> 404, UserError -> 422) set up in api/app.py — not just the
route functions in isolation.
"""

import pytest
from fastapi.testclient import TestClient

from tracelabel.api.app import create_app
from tracelabel.workspace.workspace import Workspace


@pytest.fixture
def client(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    workspace.create_project("Demo Project")
    app = create_app(workspace)
    return TestClient(app)


FIELDS = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]


def create_task(client, name="triage", **overrides):
    body = {"name": name, "level": "trace", "fields": FIELDS}
    body.update(overrides)
    return client.post("/api/projects/demo-project/tasks", json=body)


# ── list ─────────────────────────────────────────────────────────────────────


def test_list_tasks_empty(client):
    r = client.get("/api/projects/demo-project/tasks")
    assert r.status_code == 200
    assert r.json() == []


def test_list_tasks_after_create(client):
    create_task(client)
    r = client.get("/api/projects/demo-project/tasks")
    assert r.status_code == 200
    [summary] = r.json()
    assert summary["name"] == "triage"
    assert summary["total"] == 0
    assert summary["addressed"] == 0
    assert "compat_hash" in summary and summary["compat_hash"]
    assert summary["queue_scope"] == {"type": "all"}


# ── create ───────────────────────────────────────────────────────────────────


def test_create_task_with_explicit_fields(client):
    r = create_task(client)
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "triage"
    assert body["level"] == "trace"
    assert body["fields"] == FIELDS
    assert body["shuffle"] is False
    assert body["queue_scope"] == {"type": "all"}
    assert body["schema_hash"]
    assert body["compat_hash"]
    assert body["created_at"] and body["updated_at"]


def test_create_task_without_fields_uses_default(client):
    r = client.post(
        "/api/projects/demo-project/tasks",
        json={"name": "no-fields", "level": "trace"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["fields"]  # DEFAULT_FIELDS was applied, not an empty list
    assert body["fields"][0]["name"] == "verdict"
    assert body["fields"][0]["type"] == "single_select"


def test_create_task_duplicate_name_is_422(client):
    create_task(client)
    r = create_task(client)
    assert r.status_code == 422


# ── get ──────────────────────────────────────────────────────────────────────


def test_get_task(client):
    create_task(client)
    r = client.get("/api/projects/demo-project/tasks/triage")
    assert r.status_code == 200
    assert r.json()["name"] == "triage"


def test_get_task_404(client):
    r = client.get("/api/projects/demo-project/tasks/nope")
    assert r.status_code == 404


# ── patch (non-schema) ────────────────────────────────────────────────────────


def test_patch_task_updates_only_given_fields(client):
    create_task(client, annotator="alice")
    r = client.patch(
        "/api/projects/demo-project/tasks/triage",
        json={"suggest_instructions": "be terse"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["suggest_instructions"] == "be terse"
    # Untouched fields keep their original values — a partial patch must not clobber.
    assert body["annotator"] == "alice"
    assert body["fields"] == FIELDS


def test_patch_task_annotator(client):
    create_task(client, annotator="alice")
    r = client.patch(
        "/api/projects/demo-project/tasks/triage",
        json={"annotator": "bob"},
    )
    assert r.status_code == 200
    assert r.json()["annotator"] == "bob"


def test_patch_task_404(client):
    r = client.patch("/api/projects/demo-project/tasks/nope", json={"annotator": "bob"})
    assert r.status_code == 404


# ── schema ───────────────────────────────────────────────────────────────────


def test_get_schema(client):
    create_task(client)
    r = client.get("/api/projects/demo-project/tasks/triage/schema")
    assert r.status_code == 200
    body = r.json()
    assert body["fields"] == FIELDS
    assert body["schema_hash"]
    assert body["compat_hash"]


def test_patch_schema_non_breaking_applies_without_confirm(client):
    create_task(client)
    old_schema_hash = client.get("/api/projects/demo-project/tasks/triage/schema").json()[
        "schema_hash"
    ]

    new_fields = FIELDS + [{"name": "notes", "type": "text"}]
    r = client.patch(
        "/api/projects/demo-project/tasks/triage/schema",
        json={"fields": new_fields},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["fields"] == new_fields
    assert body["schema_hash"] != old_schema_hash


def test_patch_schema_breaking_without_confirm_returns_409(client, tmp_path):
    create_task(client)
    # Label an annotation using the 'verdict' field, then remove it — breaking. The
    # labeling PUT route (api/routes/labeling.py) is a different packet's stub, still
    # 501 at this point in the refactor, so write the annotation straight through the
    # repository instead of over HTTP.
    schema_hash = client.get("/api/projects/demo-project/tasks/triage/schema").json()["schema_hash"]
    workspace = Workspace(tmp_path / ".tracelabel")
    database = workspace.open_database("demo-project")
    database.annotations.upsert_annotation(
        task="triage",
        target_type="trace",
        target_id="some-trace",
        status="labeled",
        values={"verdict": "pass"},
        annotator="alice",
        schema_hash=schema_hash,
        prefill_model=None,
    )

    new_fields = [{"name": "notes", "type": "text"}]
    r = client.patch(
        "/api/projects/demo-project/tasks/triage/schema",
        json={"fields": new_fields},
    )
    assert r.status_code == 409
    body = r.json()
    assert body["breaking"] is True
    assert body["removed_fields"] == ["verdict"]
    assert body["affected_annotations"] == 1
    assert body["retyped_fields"] == []
    assert body["removed_options"] == {}

    # Nothing was written: the schema is unchanged.
    unchanged = client.get("/api/projects/demo-project/tasks/triage/schema").json()
    assert unchanged["fields"] == FIELDS


def test_patch_schema_breaking_with_confirm_applies_and_keeps_old_annotation_hash(client, tmp_path):
    create_task(client)
    old_schema_hash = client.get("/api/projects/demo-project/tasks/triage/schema").json()[
        "schema_hash"
    ]
    workspace = Workspace(tmp_path / ".tracelabel")
    database = workspace.open_database("demo-project")
    database.annotations.upsert_annotation(
        task="triage",
        target_type="trace",
        target_id="some-trace",
        status="labeled",
        values={"verdict": "pass"},
        annotator="alice",
        schema_hash=old_schema_hash,
        prefill_model=None,
    )

    new_fields = [{"name": "notes", "type": "text"}]
    r = client.patch(
        "/api/projects/demo-project/tasks/triage/schema?confirm=true",
        json={"fields": new_fields},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["fields"] == new_fields
    assert body["schema_hash"] != old_schema_hash

    # The task's schema_hash moved forward, but the annotation written under the old
    # schema keeps its original schema_hash — that's the whole point of compat_hash
    # existing separately (docs/refactor-plan.md §4, W0-BE section).
    stored_annotation = database.connection.execute(
        "SELECT schema_hash FROM annotations WHERE task=? AND target_id=?",
        ("triage", "some-trace"),
    ).fetchone()
    assert stored_annotation["schema_hash"] == old_schema_hash
