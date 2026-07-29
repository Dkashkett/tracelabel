import csv
import io
import json

from fastapi.testclient import TestClient

from helpers import make_task_spec, temp_workspace
from tracelabel.api.app import create_app


def build_client(tmp_path):
    workspace = temp_workspace(tmp_path)
    project = workspace.create_project("Demo")
    database = workspace.open_database(project.slug)
    database.tasks.create(make_task_spec(name="task"))
    database.tasks.create(make_task_spec(name="empty-task"))
    database.traces.import_trace(
        {
            "id": "t1",
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
            ],
        },
        "jsonl",
    )
    database.traces.import_trace(
        {
            "id": "t2",
            "messages": [
                {"role": "user", "content": "q2"},
                {"role": "assistant", "content": "a2"},
            ],
        },
        "jsonl",
    )
    task_row = database.tasks.get("task")
    schema_hash = task_row["schema_hash"]
    database.annotations.upsert_annotation(
        task="task",
        target_type="turn",
        target_id="t1#1",
        status="labeled",
        values={"verdict": "pass"},
        annotator="alice",
        schema_hash=schema_hash,
        prefill_model=None,
    )
    database.annotations.upsert_annotation(
        task="task",
        target_type="turn",
        target_id="t2#1",
        status="skipped",
        values={},
        annotator="alice",
        schema_hash=schema_hash,
        prefill_model=None,
    )
    database.close()
    client = TestClient(create_app(workspace))
    return client, project.slug


def test_export_jsonl_default(tmp_path):
    client, slug = build_client(tmp_path)
    response = client.get(f"/api/projects/{slug}/tasks/task/export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert 'filename="task-annotations.jsonl"' in response.headers["content-disposition"]
    rows = [json.loads(line) for line in response.text.splitlines()]
    assert len(rows) == 2
    assert {row["target_id"] for row in rows} == {"t1#1", "t2#1"}


def test_export_csv(tmp_path):
    client, slug = build_client(tmp_path)
    response = client.get(f"/api/projects/{slug}/tasks/task/export", params={"format": "csv"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert 'filename="task-annotations.csv"' in response.headers["content-disposition"]
    reader = csv.DictReader(io.StringIO(response.text))
    rows = list(reader)
    assert len(rows) == 2
    assert "role" not in reader.fieldnames


def test_export_joined_includes_trace_columns(tmp_path):
    client, slug = build_client(tmp_path)
    response = client.get(
        f"/api/projects/{slug}/tasks/task/export",
        params={"format": "csv", "joined": "true"},
    )
    assert response.status_code == 200
    reader = csv.DictReader(io.StringIO(response.text))
    assert "role" in reader.fieldnames
    assert "content" in reader.fieldnames


def test_export_status_filter_labeled(tmp_path):
    client, slug = build_client(tmp_path)
    response = client.get(
        f"/api/projects/{slug}/tasks/task/export",
        params={"status": "labeled"},
    )
    rows = [json.loads(line) for line in response.text.splitlines()]
    assert len(rows) == 1
    assert rows[0]["target_id"] == "t1#1"
    assert rows[0]["status"] == "labeled"


def test_export_status_filter_skipped(tmp_path):
    client, slug = build_client(tmp_path)
    response = client.get(
        f"/api/projects/{slug}/tasks/task/export",
        params={"status": "skipped"},
    )
    rows = [json.loads(line) for line in response.text.splitlines()]
    assert len(rows) == 1
    assert rows[0]["target_id"] == "t2#1"


def test_export_empty_result_is_valid_empty_body(tmp_path):
    client, slug = build_client(tmp_path)
    # "empty-task" has no annotations at all, so this should return an empty (but
    # successful) body rather than an error.
    response = client.get(f"/api/projects/{slug}/tasks/empty-task/export")
    assert response.status_code == 200
    assert response.text == ""


def test_export_unknown_task_is_an_error(tmp_path):
    client, slug = build_client(tmp_path)
    response = client.get(f"/api/projects/{slug}/tasks/no-such-task/export")
    assert response.status_code == 422
    assert "no-such-task" in response.json()["detail"]


def test_export_unknown_project_returns_404(tmp_path):
    client, _slug = build_client(tmp_path)
    response = client.get("/api/projects/no-such-project/tasks/task/export")
    assert response.status_code == 404
