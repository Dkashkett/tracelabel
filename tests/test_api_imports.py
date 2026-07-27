"""Tests for the imports/jobs/sources API routes (packet W2-IMPORTS).

Exercises the real FastAPI app (``create_app(workspace)``) end to end: preview a
small trace over HTTP, submit a real import as a background job, poll
``GET /api/jobs/{id}`` until it finishes, then confirm ``GET .../sources`` reflects
the new source.
"""

import time
from pathlib import Path

from fastapi.testclient import TestClient

from helpers import temp_workspace
from tracelabel.api.app import create_app

VALID_JSONL = (Path(__file__).parent / "fixtures" / "ctf" / "valid.jsonl").read_text(
    encoding="utf-8"
)


def _client(tmp_path):
    workspace = temp_workspace(tmp_path)
    workspace.create_project("Demo Project")
    return TestClient(create_app(workspace)), workspace


def test_preview_returns_traces_without_writing(tmp_path):
    client, workspace = _client(tmp_path)

    response = client.post(
        "/api/projects/demo-project/imports/preview",
        json={"content": VALID_JSONL},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["trace_count"] == 3
    assert body["errors"] == []
    trace_ids = {trace["trace"]["id"] for trace in body["traces"]}
    assert "conv_1" in trace_ids

    # Nothing was actually imported.
    database = workspace.open_database("demo-project")
    assert database.sources.list_all() == []


def test_preview_reports_errors_without_raising(tmp_path):
    # A line the adapter can detect (it has `messages`) but that fails CTF validation
    # (a message with no `content` key). ImportService.preview() collects this as an
    # `errors` entry rather than raising — unlike malformed JSON/an undetectable
    # format, which fail before validation even starts and surface as a 422.
    client, _workspace = _client(tmp_path)
    reject_missing_content = (
        Path(__file__).parent / "fixtures" / "ctf" / "reject_missing_content.jsonl"
    ).read_text(encoding="utf-8")

    response = client.post(
        "/api/projects/demo-project/imports/preview",
        json={"content": reject_missing_content},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["errors"] != []
    assert body["traces"] == []


def test_import_job_completes_and_source_is_listed(tmp_path):
    client, _workspace = _client(tmp_path)

    start = client.post(
        "/api/projects/demo-project/imports",
        json={"content": VALID_JSONL, "name": "my import"},
    )
    assert start.status_code == 200
    job_id = start.json()["job_id"]

    deadline = time.monotonic() + 5
    status_body = None
    while time.monotonic() < deadline:
        status_response = client.get(f"/api/jobs/{job_id}")
        assert status_response.status_code == 200
        status_body = status_response.json()
        if status_body["state"] in ("done", "error"):
            break
        time.sleep(0.02)

    assert status_body is not None
    assert status_body["state"] == "done", status_body
    assert status_body["result"]["inserted"] == 3

    sources = client.get("/api/projects/demo-project/sources")
    assert sources.status_code == 200
    sources_body = sources.json()
    assert len(sources_body) == 1
    assert sources_body[0]["name"] == "my import"
    assert sources_body[0]["trace_count"] == 3


def test_unknown_job_id_404(tmp_path):
    client, _workspace = _client(tmp_path)
    response = client.get("/api/jobs/does-not-exist")
    assert response.status_code == 404


def test_unknown_project_404(tmp_path):
    client, _workspace = _client(tmp_path)
    response = client.post(
        "/api/projects/nope/imports/preview",
        json={"content": VALID_JSONL},
    )
    assert response.status_code == 404
