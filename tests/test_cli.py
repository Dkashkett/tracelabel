import json
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

import tracelabel.cli.app as cli
import tracelabel.cli.commands as commands
from tracelabel.config.loader import raw_config_for_target
from tracelabel.config.models import CliArgs
from tracelabel.config.resolver import ConfigResolver
from tracelabel.ctf.validation import CtfValidator
from tracelabel.db.database import Database, default_db_path
from tracelabel.errors import EnvError
from tracelabel.imports.adapters.base import AdapterRegistry
from tracelabel.imports.service import ImportService

runner = CliRunner()


def resolve(raw, args):
    return ConfigResolver().resolve(raw, args)


def import_file(database, path):
    service = ImportService(AdapterRegistry.default(), CtfValidator(), database.traces)
    return service.import_file(path)


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
    # Stop before the blocking event loop / browser for every serve-path test. The real lock is
    # released via atexit when the process ends; in-process that never fires, so stub it out
    # (lock semantics are covered by P3's test_db) to keep repeated serves from self-colliding.
    calls = {}

    def fake_uvicorn(app, host, port):
        calls["host"] = host
        calls["port"] = port

    monkeypatch.setattr(commands.uvicorn, "run", fake_uvicorn)
    monkeypatch.setattr(commands.webbrowser, "open", lambda url: calls.setdefault("browser", url))
    monkeypatch.setattr(commands, "port_is_available", lambda _host, _port: True)
    return calls


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
    assert _run_cli(monkeypatch, ["serve", str(bad), "--no-browser", "--yes"]) == 1


def test_exit_code_env_error(tmp_path, monkeypatch):
    data = _write_data(tmp_path)
    monkeypatch.setattr(
        commands.ServerRunner,
        "pick_port",
        lambda _self, requested=8377: (_ for _ in ()).throw(EnvError("no ports")),
    )
    assert _run_cli(monkeypatch, ["serve", str(data), "--no-browser", "--yes"]) == 2


# ── CLI-02: port fallback + exhaustion ────────────────────────────────────────


def test_pick_port_fallback_and_exhaustion():
    busy = {8377, 8378, 8379}
    chosen = commands.pick_port(8377, probe=lambda _host, port: port not in busy)
    assert chosen == 8380

    with pytest.raises(EnvError):
        commands.pick_port(9000, probe=lambda _host, _port: False)


# ── CLI-03: import summary line ───────────────────────────────────────────────


def test_import_summary_output(tmp_path):
    second = {"id": "t_two", "messages": [{"role": "user", "content": "x"}]}
    data = _write_data(tmp_path, TRACE, second)
    r = runner.invoke(cli.app, ["import", str(data)])
    assert r.exit_code == 0
    assert "imported traces.jsonl: 2 inserted, 0 skipped (duplicate), 0 conflicts" in r.stdout
    # Idempotent re-import → both counted as duplicates.
    r2 = runner.invoke(cli.app, ["import", str(data)])
    assert "2 skipped (duplicate)" in r2.stdout


# ── CLI-04: tasks list table ──────────────────────────────────────────────────


def test_tasks_list_output(tmp_path):
    data = _write_data(tmp_path)
    db_path = default_db_path(tmp_path)
    conn = Database(db_path)
    import_file(conn, data)
    cfg = resolve(raw_config_for_target(data), CliArgs(task="mytask"))
    conn.tasks.open(cfg, assume_yes=True)
    conn.close()

    r = runner.invoke(cli.app, ["tasks", "list", "--db", str(db_path)])
    assert r.exit_code == 0
    assert "TASK" in r.stdout and "PROGRESS" in r.stdout
    assert "mytask" in r.stdout
    assert "traces" in r.stdout  # trace-level → native unit


# ── CLI-05: --yes bypasses drift confirm ──────────────────────────────────────


def test_yes_bypasses_confirm(tmp_path, monkeypatch):
    data = _write_data(tmp_path)
    # First serve creates the task (default schema).
    r1 = runner.invoke(cli.app, ["serve", str(data), "--task", "t", "--no-browser", "--yes"])
    assert r1.exit_code == 0
    # Second serve with a different schema (custom field via yaml) triggers drift; --yes proceeds.
    cfg_yaml = tmp_path / "config.yaml"
    cfg_yaml.write_text(
        "data: traces.jsonl\n"
        "task: t\n"
        "fields:\n"
        "  - name: rating\n"
        "    type: single_select\n"
        "    options: [good, bad]\n",
        encoding="utf-8",
    )
    r2 = runner.invoke(cli.app, ["serve", str(cfg_yaml), "--no-browser", "--yes"])
    assert r2.exit_code == 0


# ── CLI-06: TARGET routing ────────────────────────────────────────────────────


def test_target_routing(tmp_path):
    data = _write_data(tmp_path)
    # data file → implicit empty config (default task name derived from file stem).
    r1 = runner.invoke(cli.app, ["serve", str(data), "--no-browser", "--yes"])
    assert r1.exit_code == 0
    assert "traces-" in r1.stdout  # default_task_name uses the stem

    # yaml file → config loaded, custom task name honored.
    cfg_yaml = tmp_path / "config.yaml"
    cfg_yaml.write_text("data: traces.jsonl\ntask: named\n", encoding="utf-8")
    r2 = runner.invoke(cli.app, ["serve", str(cfg_yaml), "--no-browser", "--yes"])
    assert r2.exit_code == 0
    assert "task 'named'" in r2.stdout


# ── CLI-06b: serve scopes the queue to the served file, not the whole db ─────


def test_serve_scopes_queue_to_the_served_file(tmp_path):
    from fastapi.testclient import TestClient

    def _traces(*ids):
        return [
            {
                "id": tid,
                "messages": [
                    {"role": "user", "content": "hi"},
                    {"role": "assistant", "content": "hey"},
                ],
            }
            for tid in ids
        ]

    a = tmp_path / "a.jsonl"
    a.write_text(
        "\n".join(json.dumps(t) for t in _traces("a1", "a2", "a3")) + "\n", encoding="utf-8"
    )
    b = tmp_path / "b.jsonl"
    b.write_text("\n".join(json.dumps(t) for t in _traces("b1", "b2")) + "\n", encoding="utf-8")

    captured: dict = {}

    class CapturingRunner(commands.ServerRunner):
        def run(self, app, port, *, no_browser):
            # query while the db is still open (the `with database` block in
            # ServeCommand.execute closes it right after this call returns)
            with TestClient(app) as client:
                captured["queue"] = [row["trace_id"] for row in client.get("/api/queue").json()]

    cmd = commands.ServeCommand(server_runner=CapturingRunner())

    cfg_a = resolve(raw_config_for_target(a), CliArgs(task="empathy"))
    cmd.execute(cfg_a, tmp_path, None, 8377, True, True)
    assert sorted(captured["queue"]) == ["a1", "a2", "a3"]

    # serving b afterward scopes to just b's ids, even though a's traces are still in the db
    cfg_b = resolve(raw_config_for_target(b), CliArgs(task="empathy"))
    cmd.execute(cfg_b, tmp_path, None, 8377, True, True)
    assert sorted(captured["queue"]) == ["b1", "b2"]

    db_path = default_db_path(tmp_path)
    conn = Database(db_path)
    assert conn.connection.execute("SELECT count(*) FROM traces").fetchone()[0] == 5
    conn.close()


# ── CLI-06c: `serve --all` opts back into the whole-db queue ─────────────────


def test_serve_all_flag_scopes_to_whole_db(tmp_path):
    from fastapi.testclient import TestClient

    def _traces(*ids):
        return [
            {
                "id": tid,
                "messages": [
                    {"role": "user", "content": "hi"},
                    {"role": "assistant", "content": "hey"},
                ],
            }
            for tid in ids
        ]

    a = tmp_path / "a.jsonl"
    a.write_text(
        "\n".join(json.dumps(t) for t in _traces("a1", "a2", "a3")) + "\n", encoding="utf-8"
    )
    b = tmp_path / "b.jsonl"
    b.write_text("\n".join(json.dumps(t) for t in _traces("b1", "b2")) + "\n", encoding="utf-8")

    captured: dict = {}

    class CapturingRunner(commands.ServerRunner):
        def run(self, app, port, *, no_browser):
            with TestClient(app) as client:
                captured["queue"] = [row["trace_id"] for row in client.get("/api/queue").json()]

    cmd = commands.ServeCommand(server_runner=CapturingRunner())

    cfg_a = resolve(raw_config_for_target(a), CliArgs(task="empathy"))
    cmd.execute(cfg_a, tmp_path, None, 8377, True, True)
    assert sorted(captured["queue"]) == ["a1", "a2", "a3"]

    # `--all` still imports b.jsonl, but the queue is the whole db pool, not just b's ids
    cfg_b = resolve(raw_config_for_target(b), CliArgs(task="empathy"))
    cmd.execute(cfg_b, tmp_path, None, 8377, True, True, serve_all=True)
    assert sorted(captured["queue"]) == ["a1", "a2", "a3", "b1", "b2"]


def test_serve_all_cli_flag_end_to_end(tmp_path):
    data = _write_data(tmp_path)
    r = runner.invoke(cli.app, ["serve", str(data), "--no-browser", "--yes", "--all"])
    assert r.exit_code == 0
    assert "whole db" in r.stdout


def test_suggest_imports_target_file_and_scopes_to_it(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from tracelabel.config.models import LLMConfig, ResolvedTaskConfig

    def _trace(tid):
        return {
            "id": tid,
            "messages": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hey"},
            ],
        }

    a = tmp_path / "a.jsonl"
    a.write_text(json.dumps(_trace("a1")) + "\n", encoding="utf-8")
    b = tmp_path / "b.jsonl"
    b.write_text(json.dumps(_trace("b1")) + "\n", encoding="utf-8")

    cfg = ResolvedTaskConfig(
        name="task",
        level="turn",
        fields=[
            {
                "name": "verdict",
                "type": "single_select",
                "options": ["pass", "fail"],
                "required": True,
            }
        ],
        label_roles=["assistant"],
        shuffle=False,
        annotator="alice",
        schema_hash="h1",
        data_path=b,
        llm=LLMConfig(model="gpt-4o-mini"),
        suggest_instructions=None,
    )

    db_path = default_db_path(tmp_path)
    conn = Database(db_path)
    import_file(conn, a)  # a1 already in the pool from an earlier session
    conn.tasks.open(cfg, assume_yes=True)
    conn.close()

    calls: list[dict] = []

    class FakeLiteLLM:
        async def acompletion(self, **kwargs):
            calls.append(kwargs)
            content = '{"verdict": "pass"}'
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
            )

    monkeypatch.setitem(sys.modules, "litellm", FakeLiteLLM())

    summary = commands.SuggestCommand().execute(
        cfg, tmp_path, None, limit=None, overwrite=False, concurrency=1
    )

    # suggest imports its own target file (b1), on top of a1 already in the pool.
    conn = Database(db_path)
    assert conn.connection.execute("SELECT count(*) FROM traces").fetchone()[0] == 2
    conn.close()

    # ...but only suggests over b1's targets, not a1's (a1 predates this suggest session).
    assert summary.ok == 1
    assert len(calls) == 1


# ── CLI-07: errors → stderr, data → stdout ────────────────────────────────────


def test_stderr_stdout_separation(tmp_path):
    data = _write_data(tmp_path)
    db_path = default_db_path(tmp_path)
    conn = Database(db_path)
    import_file(conn, data)
    cfg = resolve(raw_config_for_target(data), CliArgs(task="t"))
    conn.tasks.open(cfg, assume_yes=True)
    conn.annotations.upsert_annotation(
        task="t",
        target_type="trace",
        target_id="t_one",
        status="labeled",
        values={"verdict": "pass"},
        annotator="me",
        schema_hash=cfg.schema_hash,
        prefill_model=None,
    )
    conn.close()

    r = runner.invoke(cli.app, ["export", "--task", "t", "--db", str(db_path), "--out", "-"])
    assert r.exit_code == 0
    # Data (the annotation row) lands on stdout…
    assert "t_one" in r.stdout
    # …while the "wrote N rows" message goes to stderr.
    assert "wrote" in r.stderr
    assert "wrote" not in r.stdout


# ── CLI-08: no --host flag; binds 127.0.0.1 ───────────────────────────────────


def test_no_host_flag_and_loopback_bind(tmp_path, _no_serve):
    help_txt = runner.invoke(cli.app, ["serve", "--help"]).stdout
    assert "--host" not in help_txt

    data = _write_data(tmp_path)
    r = runner.invoke(cli.app, ["serve", str(data), "--no-browser", "--yes"])
    assert r.exit_code == 0
    assert _no_serve["host"] == "127.0.0.1"
    assert "browser" not in _no_serve  # --no-browser suppressed the open


# ── CLI-09: directory targets (documents) ─────────────────────────────────────


def test_import_directory_of_documents(tmp_path):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "a.md").write_text("# Title\n", encoding="utf-8")
    (docs_dir / "b.txt").write_text("plain\n", encoding="utf-8")

    r = runner.invoke(cli.app, ["import", str(docs_dir)])
    assert r.exit_code == 0
    assert "2 inserted" in r.stdout
    # db is created inside the target directory, not the cwd
    assert default_db_path(docs_dir).exists()


def test_serve_directory_of_documents(tmp_path, _no_serve):
    docs_dir = tmp_path / "docs"
    docs_dir.mkdir()
    (docs_dir / "a.md").write_text("# Title\n", encoding="utf-8")

    r = runner.invoke(cli.app, ["serve", str(docs_dir), "--no-browser", "--yes"])
    assert r.exit_code == 0
    assert default_db_path(docs_dir).exists()


def test_single_document_file_rejected_by_cli(tmp_path, monkeypatch, capsys):
    md = tmp_path / "notes.md"
    md.write_text("# hi", encoding="utf-8")
    code = _run_cli(monkeypatch, ["serve", str(md), "--no-browser", "--yes"])
    assert code == 1
    captured = capsys.readouterr()
    assert "not a supported target" in captured.err
    assert "directory" in captured.err
