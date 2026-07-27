import json
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

import tracelabel.cli.app as cli
import tracelabel.cli.commands as commands
from helpers import make_task_spec
from tracelabel.config.models import LLMConfig
from tracelabel.db.database import Database, default_db_path
from tracelabel.errors import EnvError
from tracelabel.workspace.workspace import Workspace, default_workspace_root

runner = CliRunner()

TRACE = {
    "id": "t_one",
    "messages": [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ],
}


def _write_data(dir_: Path, *traces) -> Path:
    p = dir_ / "traces.jsonl"
    p.write_text("\n".join(json.dumps(t) for t in (traces or (TRACE,))) + "\n", encoding="utf-8")
    return p


@pytest.fixture(autouse=True)
def _no_serve(monkeypatch):
    # Stop before the blocking event loop / browser for every launcher-path test. The
    # real workspace lock is released via atexit when the process ends; in-process that
    # never fires, so stub it out to keep repeated launches from self-colliding.
    calls = {}

    def fake_uvicorn(app, host, port):
        calls["host"] = host
        calls["port"] = port

    monkeypatch.setattr(commands.uvicorn, "run", fake_uvicorn)
    monkeypatch.setattr(commands.webbrowser, "open", lambda url: calls.setdefault("browser", url))
    monkeypatch.setattr(commands, "port_is_available", lambda _host, _port: True)
    return calls


@pytest.fixture(autouse=True)
def _workspace_home(tmp_path, monkeypatch):
    # Keep every test off the real ~/.tracelabel — the CLI's own --dir/no-dir
    # resolution (default_workspace_root) is what's under test here, not a Workspace
    # constructed directly.
    monkeypatch.setenv("TRACELABEL_HOME", str(tmp_path))
    return tmp_path


def _run_cli(monkeypatch, args) -> int:
    # Drive the real run() wrapper (not CliRunner, which flattens every exception to exit 1) so
    # the TraceLabelError → exit-code mapping is what's under test.
    monkeypatch.setattr(sys, "argv", ["tracelabel", *args])
    try:
        cli.run()
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else 1
    return 0


# ── CLI-01: exit codes ────────────────────────────────────────────────────────


def test_exit_code_user_error(tmp_path, monkeypatch):
    # Unsupported target extension → UserError → exit 1.
    bad = tmp_path / "data.txt"
    bad.write_text("nope")
    assert _run_cli(monkeypatch, [str(bad), "--no-browser"]) == 1


def test_exit_code_env_error(tmp_path, monkeypatch):
    data = _write_data(tmp_path)
    monkeypatch.setattr(
        commands.ServerRunner,
        "pick_port",
        lambda _self, requested=8377: (_ for _ in ()).throw(EnvError("no ports")),
    )
    assert _run_cli(monkeypatch, [str(data), "--no-browser"]) == 2


# ── CLI-02: port fallback + exhaustion ────────────────────────────────────────


def test_pick_port_fallback_and_exhaustion():
    busy = {8377, 8378, 8379}
    chosen = commands.pick_port(8377, probe=lambda _host, port: port not in busy)
    assert chosen == 8380

    with pytest.raises(EnvError):
        commands.pick_port(9000, probe=lambda _host, _port: False)


# ── CLI-03: import summary line (adapted to --project) ───────────────────────


def test_import_summary_output(tmp_path):
    second = {"id": "t_two", "messages": [{"role": "user", "content": "x"}]}
    data = _write_data(tmp_path, TRACE, second)

    workspace = Workspace(default_workspace_root())
    workspace.create_project("My Project")

    r = runner.invoke(cli.app, ["import", str(data), "--project", "my-project"])
    assert r.exit_code == 0
    assert "imported traces.jsonl: 2 inserted, 0 skipped (duplicate), 0 conflicts" in r.stdout

    # Idempotent re-import → both counted as duplicates.
    r2 = runner.invoke(cli.app, ["import", str(data), "--project", "my-project"])
    assert "2 skipped (duplicate)" in r2.stdout


def test_import_unknown_project_is_a_user_error(tmp_path):
    data = _write_data(tmp_path)
    r = runner.invoke(cli.app, ["import", str(data), "--project", "nope"])
    assert r.exit_code != 0


# ── CLI-15: --from otel / --include-all-spans ─────────────────────────────────


def _otel_envelope(trace_id: str, span_id: str, attributes: list[dict]) -> dict:
    return {
        "resourceSpans": [
            {
                "scopeSpans": [
                    {
                        "spans": [
                            {
                                "traceId": trace_id,
                                "spanId": span_id,
                                "parentSpanId": "",
                                "name": "chat",
                                "startTimeUnixNano": "1700000000000000000",
                                "attributes": attributes,
                            }
                        ]
                    }
                ]
            }
        ]
    }


def test_import_from_otel_forced(tmp_path):
    envelope = _otel_envelope(
        "3" * 32,
        "4" * 16,
        [
            {"key": "gen_ai.operation.name", "value": {"stringValue": "chat"}},
            {
                "key": "gen_ai.input.messages",
                "value": {"stringValue": '[{"role":"user","content":"hi"}]'},
            },
        ],
    )
    data = tmp_path / "otel.json"
    data.write_text(json.dumps(envelope), encoding="utf-8")

    workspace = Workspace(default_workspace_root())
    workspace.create_project("Otel")

    r = runner.invoke(cli.app, ["import", str(data), "--project", "otel", "--from", "otel"])
    assert r.exit_code == 0
    assert "imported otel.json: 1 inserted" in r.stdout


# ── stdout/stderr separation on export (adapted to --project/--task) ─────────


def test_stderr_stdout_separation(tmp_path):
    workspace = Workspace(default_workspace_root())
    project = workspace.create_project("Export Test")
    with workspace.open_database(project.slug) as database:
        database.tasks.create(make_task_spec(name="t"))
        database.traces.import_trace(TRACE, "ctf", "fail")
        database.annotations.upsert_annotation(
            task="t",
            target_type="trace",
            target_id="t_one",
            status="labeled",
            values={"verdict": "pass"},
            annotator="me",
            schema_hash=database.tasks.get("t")["schema_hash"],
            prefill_model=None,
        )

    r = runner.invoke(
        cli.app,
        ["export", "--project", project.slug, "--task", "t", "--out", "-"],
    )
    assert r.exit_code == 0
    # Data (the annotation row) lands on stdout…
    assert "t_one" in r.stdout
    # …while the "wrote N rows" message goes to stderr.
    assert "wrote" in r.stderr
    assert "wrote" not in r.stdout


def test_export_requires_project_when_multiple_exist(tmp_path):
    workspace = Workspace(default_workspace_root())
    workspace.create_project("Alpha")
    workspace.create_project("Beta")
    r = runner.invoke(cli.app, ["export", "--task", "t"])
    assert r.exit_code != 0


def test_export_auto_detects_the_only_project(tmp_path):
    workspace = Workspace(default_workspace_root())
    project = workspace.create_project("Solo")
    with workspace.open_database(project.slug) as database:
        database.tasks.create(make_task_spec(name="t"))

    r = runner.invoke(cli.app, ["export", "--task", "t", "--out", "-"])
    assert r.exit_code == 0


# ── CLI-09: directory targets (documents) ─────────────────────────────────────


def test_import_directory_of_documents(tmp_path):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "a.md").write_text("# Title\n", encoding="utf-8")
    (docs_dir / "b.txt").write_text("plain\n", encoding="utf-8")

    workspace = Workspace(default_workspace_root())
    workspace.create_project("Docs")

    r = runner.invoke(cli.app, ["import", str(docs_dir), "--project", "docs"])
    assert r.exit_code == 0
    assert "2 inserted" in r.stdout


def test_single_document_file_rejected_by_cli(tmp_path, monkeypatch):
    md = tmp_path / "notes.md"
    md.write_text("# hi", encoding="utf-8")
    code = _run_cli(monkeypatch, [str(md), "--no-browser"])
    assert code == 1


# ── launcher: no TARGET → serves the whole workspace, opens "/" ─────────────


def test_launcher_with_no_target_serves_project_list(_no_serve):
    r = runner.invoke(cli.launcher_app, ["--no-browser"])
    assert r.exit_code == 0, r.stdout
    # No project or task should have been created.
    workspace = Workspace(default_workspace_root())
    assert workspace.list_projects() == []


def test_launcher_opens_browser_to_root_with_no_target(_no_serve):
    r = runner.invoke(cli.launcher_app, [])
    assert r.exit_code == 0, r.stdout
    assert _no_serve["browser"] == f"http://127.0.0.1:{_no_serve['port']}/"


# ── launcher: a TARGET → finds/creates a project+task, opens the label view ──


def test_launcher_with_target_creates_project_and_task(tmp_path, _no_serve):
    data = _write_data(tmp_path)
    r = runner.invoke(cli.launcher_app, [str(data)])
    assert r.exit_code == 0, r.stdout

    workspace = Workspace(default_workspace_root())
    projects = workspace.list_projects()
    assert len(projects) == 1
    assert projects[0].slug == "traces"

    assert "/p/traces/t/" in _no_serve["browser"]
    assert _no_serve["browser"].endswith("/label")


def test_launcher_with_target_twice_is_idempotent(tmp_path, _no_serve):
    data = _write_data(tmp_path)
    runner.invoke(cli.launcher_app, [str(data)])
    runner.invoke(cli.launcher_app, [str(data)])

    workspace = Workspace(default_workspace_root())
    assert len(workspace.list_projects()) == 1
    project = workspace.list_projects()[0]
    with workspace.open_database(project.slug) as database:
        assert len(database.tasks.list_summaries()) == 1
        assert database.connection.execute("SELECT count(*) FROM traces").fetchone()[0] == 1


# ── demo ───────────────────────────────────────────────────────────────────


def test_demo_launches_and_creates_demo_project(_no_serve):
    r = runner.invoke(cli.app, ["demo", "--no-browser"])
    assert r.exit_code == 0, r.stdout
    workspace = Workspace(default_workspace_root())
    slugs = [p.slug for p in workspace.list_projects()]
    assert "demo" in slugs


def test_demo_run_twice_reuses_the_same_project(_no_serve):
    runner.invoke(cli.app, ["demo", "--no-browser"])
    runner.invoke(cli.app, ["demo", "--no-browser"])
    workspace = Workspace(default_workspace_root())
    demo_projects = [p for p in workspace.list_projects() if p.slug == "demo"]
    assert len(demo_projects) == 1


# ── suggest ──────────────────────────────────────────────────────────────────


def test_suggest_over_a_project_and_task(monkeypatch):
    from types import SimpleNamespace

    workspace = Workspace(default_workspace_root())
    project = workspace.create_project("Suggest Test")
    with workspace.open_database(project.slug) as database:
        database.traces.import_trace(TRACE, "ctf", "fail")
        # SuggestionService validates the model's response via AnnotationValidator,
        # which requires every field dict to have a "required" key — make_task_spec's
        # default field omits it (fine for tests that never validate), so spell out a
        # complete field here.
        spec = make_task_spec(
            name="t",
            fields=[
                {
                    "name": "verdict",
                    "type": "single_select",
                    "options": ["pass", "fail"],
                    "required": True,
                }
            ],
        )
        spec = spec.__class__(**{**spec.__dict__, "llm": LLMConfig(model="gpt-4o-mini")})
        database.tasks.create(spec)

    calls: list[dict] = []

    class FakeLiteLLM:
        async def acompletion(self, **kwargs):
            calls.append(kwargs)
            content = '{"verdict": "pass"}'
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
            )

    monkeypatch.setitem(sys.modules, "litellm", FakeLiteLLM())

    r = runner.invoke(cli.app, ["suggest", "--project", project.slug, "--task", "t"])
    assert r.exit_code == 0, r.stdout
    assert "suggested" in r.stdout
    assert len(calls) == 1


# ── default_db_path / Database still work underneath (sanity) ───────────────


def test_default_db_path_still_importable():
    # Not used by the workspace-based CLI paths anymore, but still a public helper
    # other code may reference.
    assert default_db_path(Path("/tmp/x")) == Path("/tmp/x/.tracelabel/tracelabel.db")


def test_database_still_constructible(tmp_path):
    with Database(tmp_path / "db.sqlite") as db:
        assert db.tasks is not None
