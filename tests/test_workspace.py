import json
import os
import threading

import pytest

from tracelabel.db.database import Database
from tracelabel.errors import EnvError, NotFoundError
from tracelabel.workspace import Settings, Workspace, WorkspaceLock
from tracelabel.workspace.workspace import default_workspace_root, slugify

# ── default_workspace_root ───────────────────────────────────────────────────


def test_default_workspace_root_uses_dir_override(tmp_path):
    assert default_workspace_root(tmp_path) == tmp_path / ".tracelabel"


def test_default_workspace_root_uses_tracelabel_home(tmp_path, monkeypatch):
    monkeypatch.setenv("TRACELABEL_HOME", str(tmp_path))
    assert default_workspace_root() == tmp_path / ".tracelabel"


def test_default_workspace_root_falls_back_to_real_home(monkeypatch):
    monkeypatch.delenv("TRACELABEL_HOME", raising=False)
    assert default_workspace_root() == __import__("pathlib").Path.home() / ".tracelabel"


# ── slugify ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Support Triage", "support-triage"),
        ("  weird__Name!! ", "weird-name"),
        ("already-a-slug", "already-a-slug"),
        ("2026 Q1", "2026-q1"),
        ("!!!", "project"),
    ],
)
def test_slugify(name, expected):
    slug = slugify(name)
    assert slug == expected
    import re

    assert re.match(r"^[a-z0-9][a-z0-9-]*$", slug)


# ── settings ─────────────────────────────────────────────────────────────────


def test_read_settings_defaults_when_missing(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    assert workspace.read_settings() == Settings()


def test_write_then_read_settings_round_trips(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    written = workspace.write_settings(
        Settings(annotator="alice", default_llm_model="gpt-5", theme="dark")
    )
    assert written == Settings(annotator="alice", default_llm_model="gpt-5", theme="dark")
    reread = Workspace(tmp_path / ".tracelabel").read_settings()
    assert reread == Settings(annotator="alice", default_llm_model="gpt-5", theme="dark")


# ── projects ─────────────────────────────────────────────────────────────────


def test_create_project_writes_project_json(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    record = workspace.create_project("Support Triage", notes="first project")
    assert record.slug == "support-triage"
    assert record.name == "Support Triage"
    assert record.notes == "first project"

    project_json = workspace.project_dir("support-triage") / "project.json"
    assert project_json.exists()
    on_disk = json.loads(project_json.read_text())
    assert on_disk["slug"] == "support-triage"
    assert on_disk["name"] == "Support Triage"


def test_create_project_slug_collisions_get_suffix(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    first = workspace.create_project("Support Triage")
    second = workspace.create_project("Support Triage")
    third = workspace.create_project("Support Triage")
    assert first.slug == "support-triage"
    assert second.slug == "support-triage-2"
    assert third.slug == "support-triage-3"


def test_list_projects_empty_workspace(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    assert workspace.list_projects() == []


def test_list_projects_returns_all_created(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    workspace.create_project("Bravo")
    workspace.create_project("Alpha")
    slugs = [record.slug for record in workspace.list_projects()]
    assert set(slugs) == {"bravo", "alpha"}


def test_get_project_returns_none_when_missing(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    assert workspace.get_project("does-not-exist") is None


def test_get_project_returns_record(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    created = workspace.create_project("Support Triage")
    fetched = workspace.get_project("support-triage")
    assert fetched == created


def test_delete_project_removes_directory(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    workspace.create_project("Support Triage")
    assert workspace.project_dir("support-triage").exists()
    workspace.delete_project("support-triage")
    assert not workspace.project_dir("support-triage").exists()
    assert workspace.get_project("support-triage") is None


def test_delete_project_raises_not_found_for_unknown_slug(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    with pytest.raises(NotFoundError):
        workspace.delete_project("nope")


def test_open_database_raises_not_found_for_unknown_slug(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    with pytest.raises(NotFoundError):
        workspace.open_database("nope")


def test_open_database_returns_real_database(tmp_path):
    workspace = Workspace(tmp_path / ".tracelabel")
    workspace.create_project("Support Triage")
    database = workspace.open_database("support-triage")
    try:
        assert isinstance(database, Database)
        assert database.path == workspace.database_path("support-triage")
    finally:
        database.close()


def test_open_database_uses_injected_factory(tmp_path):
    calls = []

    def fake_factory(path):
        calls.append(path)
        return "not-a-real-database"

    workspace = Workspace(tmp_path / ".tracelabel", database_factory=fake_factory)
    workspace.create_project("Support Triage")
    result = workspace.open_database("support-triage")
    assert result == "not-a-real-database"
    assert calls == [workspace.database_path("support-triage")]


# ── WorkspaceLock ─────────────────────────────────────────────────────────────


def test_workspace_lock_acquire_writes_lock_file(tmp_path):
    lock = WorkspaceLock(tmp_path, 8377)
    lock.acquire()
    try:
        info = json.loads(lock.path.read_text())
        assert info["pid"] == os.getpid()
        assert info["port"] == 8377
    finally:
        lock.release()


def test_workspace_lock_stale_lock_reclaimed(tmp_path):
    lock_path = tmp_path / "lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(json.dumps({"pid": 999_999, "port": 1, "started_at": "x"}))
    lock = WorkspaceLock(tmp_path, 8377)
    lock.acquire()
    try:
        info = json.loads(lock_path.read_text())
        assert info["pid"] == os.getpid()
        assert info["port"] == 8377
    finally:
        lock.release()


def test_workspace_lock_live_lock_refused(tmp_path):
    lock_path = tmp_path / "lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(json.dumps({"pid": os.getpid(), "port": 8377, "started_at": "x"}))
    with pytest.raises(EnvError) as excinfo:
        WorkspaceLock(tmp_path, 9000).acquire()
    message = str(excinfo.value)
    assert str(os.getpid()) in message
    assert "8377" in message


def test_workspace_lock_release_is_idempotent(tmp_path):
    lock = WorkspaceLock(tmp_path, 8377)
    lock.release()  # no lock present -> no error
    lock.acquire()
    lock.release()
    lock.release()  # second release is a no-op


def test_workspace_lock_context_manager_cleans_up_on_error(tmp_path):
    lock_path = tmp_path / "lock"
    with pytest.raises(RuntimeError):
        with WorkspaceLock(tmp_path, 8377):
            assert lock_path.exists()
            raise RuntimeError("stop")
    assert not lock_path.exists()


# ── Database.transaction() thread safety ─────────────────────────────────────


def test_transaction_serializes_across_threads(tmp_path):
    database = Database(tmp_path / "tracelabel.db")
    try:
        database.connection.execute("CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER)")
        database.connection.execute("INSERT INTO counter (id, value) VALUES (1, 0)")
        database.connection.commit()

        def bump_many_times():
            for _ in range(50):
                with database.transaction() as connection:
                    current = connection.execute("SELECT value FROM counter WHERE id=1").fetchone()[
                        0
                    ]
                    connection.execute("UPDATE counter SET value=? WHERE id=1", (current + 1,))

        threads = [threading.Thread(target=bump_many_times) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        final = database.connection.execute("SELECT value FROM counter WHERE id=1").fetchone()[0]
        assert final == 200
    finally:
        database.close()
