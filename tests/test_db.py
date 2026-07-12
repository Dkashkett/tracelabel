import json
import sqlite3

import pytest

from tracelabel.config.models import ResolvedTaskConfig
from tracelabel.ctf.hashing import derive_document_id
from tracelabel.db.database import Database, default_db_path
from tracelabel.db.locking import ProjectLock
from tracelabel.errors import EnvError, UserError

# ── helpers ─────────────────────────────────────────────────────────────────


def make_cfg(
    tmp_path,
    *,
    name="task",
    level="turn",
    fields=None,
    label_roles=None,
    shuffle=False,
    annotator="alice",
    schema_hash="h1",
) -> ResolvedTaskConfig:
    return ResolvedTaskConfig(
        name=name,
        level=level,
        fields=fields
        if fields is not None
        else [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}],
        label_roles=label_roles if label_roles is not None else ["assistant"],
        shuffle=shuffle,
        annotator=annotator,
        schema_hash=schema_hash,
        data_path=tmp_path / "traces.jsonl",
        llm=None,
        suggest_instructions=None,
    )


def ctf_trace(*, id=None, messages=None):
    obj = {
        "messages": messages
        or [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
    }
    if id is not None:
        obj["id"] = id
    return obj


def ctf_document(*, id=None, content="doc body", content_type=None):
    obj = {"content": content}
    if id is not None:
        obj["id"] = id
    if content_type is not None:
        obj["content_type"] = content_type
    return obj


@pytest.fixture
def conn(tmp_path):
    c = Database(default_db_path(tmp_path))
    yield c
    c.close()


# ── DB-01 ───────────────────────────────────────────────────────────────────


def test_open_db_pragmas(conn):
    assert conn.connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    assert conn.connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.connection.execute("PRAGMA busy_timeout").fetchone()[0] == 5000


# ── DB-02 ───────────────────────────────────────────────────────────────────


def test_migration_001_schema(conn):
    assert conn.connection.execute("PRAGMA user_version").fetchone()[0] == 1
    tables = {
        r[0] for r in conn.connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert {"traces", "turns", "tasks", "annotations", "suggestions"} <= tables
    indexes = {
        r[0] for r in conn.connection.execute("SELECT name FROM sqlite_master WHERE type='index'")
    }
    assert "idx_turns_trace" in indexes
    assert "idx_annotations_task" in indexes
    # CHECK constraints are live: an illegal role is rejected.
    conn.connection.execute(
        "INSERT INTO traces (id, content_hash, source, metadata, raw, imported_at) "
        "VALUES ('t','h',NULL,'{}',NULL,'2026-01-01T00:00:00Z')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.connection.execute(
            "INSERT INTO turns VALUES ('t#0','t',0,'bogus','x','text',NULL,NULL,NULL,'{}',NULL)"
        )
    # "document" was removed from the message Role enum; a turn may never carry it.
    with pytest.raises(sqlite3.IntegrityError):
        conn.connection.execute(
            "INSERT INTO turns VALUES ('t#0','t',0,'document','x','text',NULL,NULL,NULL,'{}',NULL)"
        )
    # content_type CHECK on traces accepts the four document content types.
    conn.connection.execute(
        "INSERT INTO traces (id, content_hash, source, metadata, raw, imported_at, "
        "content, content_type) VALUES ('d','h2',NULL,'{}',NULL,'2026-01-01T00:00:00Z',"
        "'hi','markdown')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.connection.execute(
            "INSERT INTO traces (id, content_hash, source, metadata, raw, imported_at, "
            "content, content_type) VALUES ('d2','h3',NULL,'{}',NULL,"
            "'2026-01-01T00:00:00Z','hi','yaml')"
        )


# ── DB-03 ───────────────────────────────────────────────────────────────────


def test_newer_db_refused(tmp_path):
    path = default_db_path(tmp_path)
    c = Database(path)
    c.connection.execute("PRAGMA user_version = 99")
    c.connection.commit()
    c.close()
    with pytest.raises(EnvError) as ei:
        Database(path)
    msg = str(ei.value)
    assert "newer" in msg
    assert "pip install -U tracelabel" in msg


# ── DB-04 ───────────────────────────────────────────────────────────────────


def test_import_twice_skipped_duplicate(conn):
    t = ctf_trace(id="x")
    assert conn.traces.import_trace(t, "jsonl") == ("inserted", "x")

    def snapshot():
        traces = conn.connection.execute("SELECT * FROM traces ORDER BY id").fetchall()
        turns = conn.connection.execute("SELECT * FROM turns ORDER BY id").fetchall()
        return [tuple(r) for r in traces], [tuple(r) for r in turns]

    before = snapshot()
    assert conn.traces.import_trace(t, "jsonl") == ("skipped_duplicate", "x")
    after = snapshot()
    # twice ≡ once: table state is byte-identical.
    assert before == after
    assert conn.connection.execute("SELECT count(*) FROM traces").fetchone()[0] == 1
    assert conn.connection.execute("SELECT count(*) FROM turns").fetchone()[0] == 2


# ── DB-05 ───────────────────────────────────────────────────────────────────


def test_import_conflict_fails_loud(conn):
    conn.traces.import_trace(ctf_trace(id="x"), "jsonl")
    other = ctf_trace(id="x", messages=[{"role": "user", "content": "DIFFERENT"}])
    with pytest.raises(UserError) as ei:
        conn.traces.import_trace(other, "jsonl")
    msg = str(ei.value)
    assert "differs" in msg
    assert "--on-conflict skip" in msg


# ── DB-06 ───────────────────────────────────────────────────────────────────


def test_import_conflict_skip(conn):
    conn.traces.import_trace(ctf_trace(id="x"), "jsonl")
    stored_hash = conn.connection.execute(
        "SELECT content_hash FROM traces WHERE id='x'"
    ).fetchone()[0]
    other = ctf_trace(id="x", messages=[{"role": "user", "content": "DIFFERENT"}])
    with pytest.warns(UserWarning, match="keeping stored version"):
        assert conn.traces.import_trace(other, "jsonl", on_conflict="skip") == (
            "skipped_conflict",
            "x",
        )
    # stored version untouched
    assert (
        conn.connection.execute("SELECT content_hash FROM traces WHERE id='x'").fetchone()[0]
        == stored_hash
    )
    assert conn.connection.execute("SELECT content FROM turns WHERE id='x#0'").fetchone()[0] == "hi"


# ── documents (import_document) ────────────────────────────────────────────


def test_import_document_writes_content_zero_turns(conn):
    result = conn.traces.import_document(
        ctf_document(id="d1", content="# Title", content_type="markdown"), "documents"
    )
    assert result == ("inserted", "d1")
    trace = conn.traces.get("d1")
    assert trace["content"] == "# Title"
    assert trace["content_type"] == "markdown"
    assert conn.traces.get_turns("d1") == []


def test_import_document_derives_id_from_content_when_absent(conn):
    result = conn.traces.import_document(ctf_document(content="hello world"), "documents")
    expected_id = derive_document_id("hello world")
    assert result == ("inserted", expected_id)
    trace = conn.traces.get(expected_id)
    assert trace is not None
    assert trace["content"] == "hello world"
    assert trace["content_type"] is None


def test_import_document_twice_skipped_duplicate(conn):
    doc = ctf_document(id="d1", content="body", content_type="text")
    assert conn.traces.import_document(doc, "documents") == ("inserted", "d1")
    assert conn.traces.import_document(doc, "documents") == ("skipped_duplicate", "d1")
    assert conn.connection.execute("SELECT count(*) FROM traces").fetchone()[0] == 1


def test_import_document_edited_content_conflicts(conn):
    conn.traces.import_document(ctf_document(id="d1", content="original"), "documents")
    edited = ctf_document(id="d1", content="edited")
    with pytest.raises(UserError) as ei:
        conn.traces.import_document(edited, "documents")
    msg = str(ei.value)
    assert "differs" in msg
    assert "--on-conflict skip" in msg


def test_import_document_edited_content_conflict_skip(conn):
    conn.traces.import_document(ctf_document(id="d1", content="original"), "documents")
    edited = ctf_document(id="d1", content="edited")
    with pytest.warns(UserWarning, match="keeping stored version"):
        result = conn.traces.import_document(edited, "documents", on_conflict="skip")
    assert result == ("skipped_conflict", "d1")
    assert conn.traces.get("d1")["content"] == "original"


# an explicit content_type participates in the hash, so the same content string
# under a different content_type is a distinct idempotency fingerprint
def test_import_document_content_type_participates_in_hash(conn):
    conn.traces.import_document(ctf_document(id="d1", content="same"), "documents")
    with pytest.raises(UserError):
        conn.traces.import_document(
            ctf_document(id="d1", content="same", content_type="markdown"), "documents"
        )


def test_repository_writes_join_outer_transaction(conn):
    with pytest.raises(RuntimeError):
        with conn.transaction():
            conn.traces.import_trace(ctf_trace(id="one"), "jsonl")
            conn.traces.import_trace(ctf_trace(id="two"), "jsonl")
            raise RuntimeError("roll back both")
    assert conn.connection.execute("SELECT count(*) FROM traces").fetchone()[0] == 0


# ── DB-07 ───────────────────────────────────────────────────────────────────


def test_turn_rows_verbatim_and_ids(conn):
    messages = [
        {"role": "user", "content": '{"a": 1}'},  # json-looking, stored verbatim
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "part one"},
            ],
        },
    ]
    conn.traces.import_trace(ctf_trace(id="tid", messages=messages), "jsonl")
    rows = conn.traces.get_turns("tid")
    assert [r["id"] for r in rows] == ["tid#0", "tid#1"]
    # string content byte-for-byte, never reformatted (invariant #1)
    assert rows[0]["content"] == '{"a": 1}'
    assert rows[0]["content_type"] == "json"
    # parts array serialized deterministically via canonical_json
    assert rows[1]["content_type"] == "parts"
    assert rows[1]["content"] == '[{"text":"part one","type":"text"}]'


# ── DB-08 ───────────────────────────────────────────────────────────────────


def test_open_task_seed_only_when_shuffle(conn, tmp_path):
    conn.tasks.open(make_cfg(tmp_path, name="seq", shuffle=False), assume_yes=True)
    conn.tasks.open(make_cfg(tmp_path, name="shuf", shuffle=True), assume_yes=True)
    assert conn.tasks.get("seq")["shuffle_seed"] is None
    assert conn.tasks.get("shuf")["shuffle_seed"] is not None


# ── DB-09 ───────────────────────────────────────────────────────────────────


def test_open_task_level_mismatch(conn, tmp_path):
    conn.tasks.open(make_cfg(tmp_path, name="t", level="turn"), assume_yes=True)
    with pytest.raises(UserError) as ei:
        conn.tasks.open(make_cfg(tmp_path, name="t", level="trace"), assume_yes=True)
    assert "level=turn" in str(ei.value)


# ── DB-10 ───────────────────────────────────────────────────────────────────


def test_drift_declined_aborts(conn, tmp_path):
    conn.tasks.open(make_cfg(tmp_path, name="t", schema_hash="h1"), assume_yes=True)
    with pytest.raises(UserError) as ei:
        conn.tasks.open(
            make_cfg(tmp_path, name="t", schema_hash="h2"),
            assume_yes=False,
            confirm=lambda _prompt: False,
        )
    assert "Aborted" in str(ei.value)
    # unchanged
    assert conn.tasks.get("t")["schema_hash"] == "h1"


def test_drift_confirmed_updates(conn, tmp_path):
    conn.tasks.open(make_cfg(tmp_path, name="t", schema_hash="h1"), assume_yes=True)
    new_fields = [{"name": "quality", "type": "text"}]
    conn.tasks.open(
        make_cfg(tmp_path, name="t", schema_hash="h2", fields=new_fields),
        assume_yes=False,
        confirm=lambda _prompt: True,
    )
    row = conn.tasks.get("t")
    assert row["schema_hash"] == "h2"
    assert json.loads(row["resolved_schema"]) == new_fields

    # --yes also updates without a confirm callback being consulted
    conn.tasks.open(
        make_cfg(tmp_path, name="t", schema_hash="h3"),
        assume_yes=True,
        confirm=lambda _prompt: pytest.fail("confirm must not be called with --yes"),
    )
    assert conn.tasks.get("t")["schema_hash"] == "h3"


# ── DB-11 ───────────────────────────────────────────────────────────────────


def test_upsert_annotation_lww(conn, tmp_path):
    conn.tasks.open(make_cfg(tmp_path, name="t"), assume_yes=True)

    def up(annotator, values, status="labeled"):
        return conn.annotations.upsert_annotation(
            task="t",
            target_type="turn",
            target_id="x#0",
            status=status,
            values=values,
            annotator=annotator,
            schema_hash="h1",
            prefill_model=None,
        )

    first = up("alice", {"verdict": "pass"})
    up("alice", {"verdict": "fail"}, status="skipped")
    # last write wins: one row, updated values/status, created_at preserved
    rows = conn.connection.execute(
        "SELECT * FROM annotations WHERE task='t' AND target_id='x#0'"
    ).fetchall()
    assert len(rows) == 1
    assert json.loads(rows[0]["values"]) == {"verdict": "fail"}
    assert rows[0]["status"] == "skipped"
    assert rows[0]["created_at"] == first["created_at"]

    # a different annotator is a distinct row (unique per task,type,id,annotator)
    up("bob", {"verdict": "pass"})
    assert (
        conn.connection.execute(
            "SELECT count(*) FROM annotations WHERE task='t' AND target_id='x#0'"
        ).fetchone()[0]
        == 2
    )


# ── DB-12 ───────────────────────────────────────────────────────────────────


def test_upsert_suggestion_replaces(conn, tmp_path):
    conn.tasks.open(make_cfg(tmp_path, name="t"), assume_yes=True)

    def up(model, values):
        conn.annotations.upsert_suggestion(
            task="t",
            target_type="turn",
            target_id="x#0",
            values=values,
            model=model,
            raw_response=None,
        )

    up("gpt-4", {"verdict": "pass"})
    up("claude", {"verdict": "fail"})
    rows = conn.connection.execute("SELECT * FROM suggestions WHERE task='t'").fetchall()
    assert len(rows) == 1  # one live suggestion
    assert rows[0]["model"] == "claude"
    assert json.loads(rows[0]["values"]) == {"verdict": "fail"}


# ── DB-13 ───────────────────────────────────────────────────────────────────


def test_build_queue_stable_across_reopen(tmp_path):
    path = default_db_path(tmp_path)
    conn = Database(path)
    for i in range(20):
        conn.traces.import_trace(ctf_trace(id=f"t{i:02d}"), "jsonl")
    conn.tasks.open(make_cfg(tmp_path, name="t", shuffle=True), assume_yes=True)
    q1 = conn.tasks.build_queue("t")
    conn.close()

    conn2 = Database(path)
    q2 = conn2.tasks.build_queue("t")
    conn2.close()

    assert q1 == q2  # deterministic across resume (stored seed)
    assert sorted(q1) == [f"t{i:02d}" for i in range(20)]  # a permutation of all ids
    assert q1 != [f"t{i:02d}" for i in range(20)]  # actually shuffled


def test_build_queue_scoped_to_trace_ids_in_given_order(conn, tmp_path):
    for i in range(5):
        conn.traces.import_trace(ctf_trace(id=f"t{i:02d}"), "jsonl")
    conn.tasks.open(make_cfg(tmp_path, name="t", shuffle=False), assume_yes=True)

    # scoped + unshuffled: exact subset, in the order given (not imported_at/id order)
    scoped = conn.tasks.build_queue("t", ["t03", "t00", "t04"])
    assert scoped == ["t03", "t00", "t04"]

    # None still falls back to the whole db, db-wide order
    whole = conn.tasks.build_queue("t", None)
    assert whole == [f"t{i:02d}" for i in range(5)]
    assert conn.tasks.build_queue("t") == whole


def test_build_queue_shuffle_applies_on_top_of_scoped_list(tmp_path):
    path = default_db_path(tmp_path)
    conn = Database(path)
    for i in range(20):
        conn.traces.import_trace(ctf_trace(id=f"t{i:02d}"), "jsonl")
    conn.tasks.open(make_cfg(tmp_path, name="t", shuffle=True), assume_yes=True)
    scoped_ids = [f"t{i:02d}" for i in range(10)]  # only half the pool is "in the file"

    q1 = conn.tasks.build_queue("t", scoped_ids)
    conn.close()

    conn2 = Database(path)
    q2 = conn2.tasks.build_queue("t", scoped_ids)
    conn2.close()

    assert sorted(q1) == scoped_ids  # scoping still excludes the other half
    assert q1 == q2  # deterministic across reopen (stored seed)
    assert q1 != scoped_ids  # actually shuffled


# ── DB-14 ───────────────────────────────────────────────────────────────────


def test_lock_stale_reclaimed(tmp_path):
    lock = tmp_path / ".tracelabel" / "lock"
    lock.parent.mkdir(parents=True)
    lock.write_text(json.dumps({"pid": 999_999, "port": 1, "started_at": "x"}))
    project_lock = ProjectLock(tmp_path, 8377, process_probe=lambda _pid: False)
    project_lock.acquire()
    info = json.loads(lock.read_text())
    assert info["pid"] == __import__("os").getpid()
    assert info["port"] == 8377
    project_lock.release()


def test_lock_live_refused(tmp_path):
    import os

    lock = tmp_path / ".tracelabel" / "lock"
    lock.parent.mkdir(parents=True)
    lock.write_text(json.dumps({"pid": os.getpid(), "port": 8377, "started_at": "x"}))
    with pytest.raises(EnvError) as ei:
        ProjectLock(tmp_path, 9000, process_probe=lambda _pid: True).acquire()
    msg = str(ei.value)
    assert str(os.getpid()) in msg
    assert "8377" in msg


def test_release_lock_idempotent(tmp_path):
    project_lock = ProjectLock(tmp_path, 8377)
    project_lock.release()  # no lock present → no error
    project_lock.acquire()
    project_lock.release()
    project_lock.release()  # second release is a no-op


def test_project_lock_context_cleans_up_on_error(tmp_path):
    lock_path = tmp_path / ".tracelabel" / "lock"
    with pytest.raises(RuntimeError):
        with ProjectLock(tmp_path, 8377):
            assert lock_path.exists()
            raise RuntimeError("stop")
    assert not lock_path.exists()


# ── DB-15 ───────────────────────────────────────────────────────────────────


def test_target_counts_turn_and_trace_level(conn, tmp_path):
    # two traces, each with one assistant (labelable) turn
    for tid in ("ta", "tb"):
        conn.traces.import_trace(
            ctf_trace(
                id=tid,
                messages=[
                    {"role": "user", "content": "q"},
                    {"role": "assistant", "content": "a"},
                ],
            ),
            "jsonl",
        )

    # turn-level: label assistant turns; addressed one of them
    turn_cfg = make_cfg(tmp_path, name="turntask", level="turn", label_roles=["assistant"])
    conn.tasks.open(turn_cfg, assume_yes=True)
    conn.annotations.upsert_annotation(
        task="turntask",
        target_type="turn",
        target_id="ta#1",
        status="labeled",
        values={"verdict": "pass"},
        annotator="alice",
        schema_hash="h1",
        prefill_model=None,
    )
    counts = conn.annotations.target_counts(conn.tasks.get("turntask"), "alice")
    assert counts["ta"] == (1, 1, 0)  # one labelable turn, labeled
    assert counts["tb"] == (1, 0, 0)  # one labelable turn, untouched

    # trace-level: every trace is one target; skip one
    trace_cfg = make_cfg(tmp_path, name="tracetask", level="trace")
    conn.tasks.open(trace_cfg, assume_yes=True)
    conn.annotations.upsert_annotation(
        task="tracetask",
        target_type="trace",
        target_id="tb",
        status="skipped",
        values={},
        annotator="alice",
        schema_hash="h1",
        prefill_model=None,
    )
    tcounts = conn.annotations.target_counts(conn.tasks.get("tracetask"), "alice")
    assert tcounts["ta"] == (1, 0, 0)
    assert tcounts["tb"] == (1, 0, 1)


def test_unaddressed_and_without_suggestion(conn, tmp_path):
    for tid in ("ta", "tb"):
        conn.traces.import_trace(
            ctf_trace(
                id=tid,
                messages=[
                    {"role": "user", "content": "q"},
                    {"role": "assistant", "content": "a"},
                ],
            ),
            "jsonl",
        )
    cfg = make_cfg(tmp_path, name="t", level="turn", label_roles=["assistant"])
    conn.tasks.open(cfg, assume_yes=True)
    assert conn.annotations.unaddressed_targets(cfg) == ["ta#1", "tb#1"]
    conn.annotations.upsert_annotation(
        task="t",
        target_type="turn",
        target_id="ta#1",
        status="labeled",
        values={},
        annotator="alice",
        schema_hash="h1",
        prefill_model=None,
    )
    assert conn.annotations.unaddressed_targets(cfg) == ["tb#1"]

    conn.annotations.upsert_suggestion(
        task="t",
        target_type="turn",
        target_id="ta#1",
        values={"verdict": "pass"},
        model="gpt-4",
        raw_response=None,
    )
    assert conn.annotations.targets_without_suggestion("t", ["ta#1", "tb#1"]) == ["tb#1"]


def test_unaddressed_targets_scoped_to_trace_ids(conn, tmp_path):
    for tid in ("ta", "tb"):
        conn.traces.import_trace(
            ctf_trace(
                id=tid,
                messages=[
                    {"role": "user", "content": "q"},
                    {"role": "assistant", "content": "a"},
                ],
            ),
            "jsonl",
        )
    cfg = make_cfg(tmp_path, name="t", level="turn", label_roles=["assistant"])
    conn.tasks.open(cfg, assume_yes=True)
    assert conn.annotations.unaddressed_targets(cfg, ["tb"]) == ["tb#1"]
    assert conn.annotations.unaddressed_targets(cfg, []) == []

    trace_cfg = make_cfg(tmp_path, name="ttrace", level="trace")
    conn.tasks.open(trace_cfg, assume_yes=True)
    assert conn.annotations.unaddressed_targets(trace_cfg, ["ta"]) == ["ta"]
