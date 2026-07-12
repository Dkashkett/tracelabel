import json
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

from tracelabel import cli
from tracelabel.config import CliArgs, raw_config_for_target, resolve
from tracelabel.db import default_db_path, open_db, open_task
from tracelabel.errors import EnvError

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
    # Stop before the blocking event loop / browser for every serve-path test. The real lock is
    # released via atexit when the process ends; in-process that never fires, so stub it out
    # (lock semantics are covered by P3's test_db) to keep repeated serves from self-colliding.
    calls = {}

    def fake_uvicorn(app, host, port):
        calls["host"] = host
        calls["port"] = port

    monkeypatch.setattr(cli.uvicorn, "run", fake_uvicorn)
    monkeypatch.setattr(cli.webbrowser, "open", lambda url: calls.setdefault("browser", url))
    monkeypatch.setattr(cli, "acquire_lock", lambda project_dir, port: None)
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
        cli, "pick_port", lambda requested=8377: (_ for _ in ()).throw(EnvError("no ports"))
    )
    assert _run_cli(monkeypatch, ["serve", str(data), "--no-browser", "--yes"]) == 2


# ── CLI-02: port fallback + exhaustion ────────────────────────────────────────


def test_pick_port_fallback_and_exhaustion():
    import socket

    held = []
    for base in range(8377, 8377 + 3):  # occupy first three ports of the range
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", base))
        held.append(s)
    try:
        chosen = cli.pick_port(8377)
        assert chosen == 8380  # skipped the three taken ones
    finally:
        for s in held:
            s.close()

    # Exhaust the whole 10-port window → EnvError.
    held = []
    try:
        for base in range(9000, 9010):
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.bind(("127.0.0.1", base))
            held.append(s)
        with pytest.raises(EnvError):
            cli.pick_port(9000)
    finally:
        for s in held:
            s.close()


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
    conn = open_db(db_path)
    from tracelabel.adapters import import_file

    import_file(conn, data)
    cfg = resolve(raw_config_for_target(data), CliArgs(task="mytask"))
    open_task(conn, cfg, assume_yes=True)
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


# ── CLI-07: errors → stderr, data → stdout ────────────────────────────────────


def test_stderr_stdout_separation(tmp_path):
    data = _write_data(tmp_path)
    db_path = default_db_path(tmp_path)
    conn = open_db(db_path)
    from tracelabel.adapters import import_file

    import_file(conn, data)
    cfg = resolve(raw_config_for_target(data), CliArgs(task="t"))
    open_task(conn, cfg, assume_yes=True)
    from tracelabel.db import upsert_annotation

    upsert_annotation(
        conn,
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
