import json
import sqlite3

import pytest

from tracelabel import db
from tracelabel.config import ResolvedTaskConfig
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


@pytest.fixture
def conn(tmp_path):
    c = db.open_db(db.default_db_path(tmp_path))
    yield c
    c.close()


# ── DB-01 ───────────────────────────────────────────────────────────────────


def test_open_db_pragmas(conn):
    assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000


# ── DB-02 ───────────────────────────────────────────────────────────────────


def test_migration_001_schema(conn):
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"traces", "turns", "tasks", "annotations", "suggestions"} <= tables
    indexes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert "idx_turns_trace" in indexes
    assert "idx_annotations_task" in indexes
    # CHECK constraints are live: an illegal role is rejected.
    conn.execute("INSERT INTO traces VALUES ('t','h',NULL,'{}',NULL,'2026-01-01T00:00:00Z')")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO turns VALUES ('t#0','t',0,'bogus','x','text',NULL,NULL,NULL,'{}',NULL)"
        )


# ── DB-03 ───────────────────────────────────────────────────────────────────


def test_newer_db_refused(tmp_path):
    path = db.default_db_path(tmp_path)
    c = db.open_db(path)
    c.execute("PRAGMA user_version = 99")
    c.commit()
    c.close()
    with pytest.raises(EnvError) as ei:
        db.open_db(path)
    msg = str(ei.value)
    assert "newer" in msg
    assert "pip install -U tracelabel" in msg


# ── DB-04 ───────────────────────────────────────────────────────────────────


def test_import_twice_skipped_duplicate(conn):
    t = ctf_trace(id="x")
    assert db.import_trace(conn, t, "jsonl") == "inserted"

    def snapshot():
        traces = conn.execute("SELECT * FROM traces ORDER BY id").fetchall()
        turns = conn.execute("SELECT * FROM turns ORDER BY id").fetchall()
        return [tuple(r) for r in traces], [tuple(r) for r in turns]

    before = snapshot()
    assert db.import_trace(conn, t, "jsonl") == "skipped_duplicate"
    after = snapshot()
    # twice ≡ once: table state is byte-identical.
    assert before == after
    assert conn.execute("SELECT count(*) FROM traces").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM turns").fetchone()[0] == 2


# ── DB-05 ───────────────────────────────────────────────────────────────────


def test_import_conflict_fails_loud(conn):
    db.import_trace(conn, ctf_trace(id="x"), "jsonl")
    other = ctf_trace(id="x", messages=[{"role": "user", "content": "DIFFERENT"}])
    with pytest.raises(UserError) as ei:
        db.import_trace(conn, other, "jsonl")
    msg = str(ei.value)
    assert "differs" in msg
    assert "--on-conflict skip" in msg


# ── DB-06 ───────────────────────────────────────────────────────────────────


def test_import_conflict_skip(conn):
    db.import_trace(conn, ctf_trace(id="x"), "jsonl")
    stored_hash = conn.execute("SELECT content_hash FROM traces WHERE id='x'").fetchone()[0]
    other = ctf_trace(id="x", messages=[{"role": "user", "content": "DIFFERENT"}])
    with pytest.warns(UserWarning, match="keeping stored version"):
        assert db.import_trace(conn, other, "jsonl", on_conflict="skip") == "skipped_conflict"
    # stored version untouched
    assert conn.execute("SELECT content_hash FROM traces WHERE id='x'").fetchone()[0] == stored_hash
    assert conn.execute("SELECT content FROM turns WHERE id='x#0'").fetchone()[0] == "hi"


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
    db.import_trace(conn, ctf_trace(id="tid", messages=messages), "jsonl")
    rows = db.get_turns(conn, "tid")
    assert [r["id"] for r in rows] == ["tid#0", "tid#1"]
    # string content byte-for-byte, never reformatted (invariant #1)
    assert rows[0]["content"] == '{"a": 1}'
    assert rows[0]["content_type"] == "json"
    # parts array serialized deterministically via canonical_json
    assert rows[1]["content_type"] == "parts"
    assert rows[1]["content"] == '[{"text":"part one","type":"text"}]'


# ── DB-08 ───────────────────────────────────────────────────────────────────


def test_open_task_seed_only_when_shuffle(conn, tmp_path):
    db.open_task(conn, make_cfg(tmp_path, name="seq", shuffle=False), assume_yes=True)
    db.open_task(conn, make_cfg(tmp_path, name="shuf", shuffle=True), assume_yes=True)
    assert db.get_task(conn, "seq")["shuffle_seed"] is None
    assert db.get_task(conn, "shuf")["shuffle_seed"] is not None


# ── DB-09 ───────────────────────────────────────────────────────────────────


def test_open_task_level_mismatch(conn, tmp_path):
    db.open_task(conn, make_cfg(tmp_path, name="t", level="turn"), assume_yes=True)
    with pytest.raises(UserError) as ei:
        db.open_task(conn, make_cfg(tmp_path, name="t", level="trace"), assume_yes=True)
    assert "level=turn" in str(ei.value)


# ── DB-10 ───────────────────────────────────────────────────────────────────


def test_drift_declined_aborts(conn, tmp_path):
    db.open_task(conn, make_cfg(tmp_path, name="t", schema_hash="h1"), assume_yes=True)
    with pytest.raises(UserError) as ei:
        db.open_task(
            conn,
            make_cfg(tmp_path, name="t", schema_hash="h2"),
            assume_yes=False,
            confirm=lambda _prompt: False,
        )
    assert "Aborted" in str(ei.value)
    # unchanged
    assert db.get_task(conn, "t")["schema_hash"] == "h1"


def test_drift_confirmed_updates(conn, tmp_path):
    db.open_task(conn, make_cfg(tmp_path, name="t", schema_hash="h1"), assume_yes=True)
    new_fields = [{"name": "quality", "type": "text"}]
    db.open_task(
        conn,
        make_cfg(tmp_path, name="t", schema_hash="h2", fields=new_fields),
        assume_yes=False,
        confirm=lambda _prompt: True,
    )
    row = db.get_task(conn, "t")
    assert row["schema_hash"] == "h2"
    assert json.loads(row["resolved_schema"]) == new_fields

    # --yes also updates without a confirm callback being consulted
    db.open_task(
        conn,
        make_cfg(tmp_path, name="t", schema_hash="h3"),
        assume_yes=True,
        confirm=lambda _prompt: pytest.fail("confirm must not be called with --yes"),
    )
    assert db.get_task(conn, "t")["schema_hash"] == "h3"


# ── DB-11 ───────────────────────────────────────────────────────────────────


def test_upsert_annotation_lww(conn, tmp_path):
    db.open_task(conn, make_cfg(tmp_path, name="t"), assume_yes=True)

    def up(annotator, values, status="labeled"):
        return db.upsert_annotation(
            conn,
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
    rows = conn.execute("SELECT * FROM annotations WHERE task='t' AND target_id='x#0'").fetchall()
    assert len(rows) == 1
    assert json.loads(rows[0]["values"]) == {"verdict": "fail"}
    assert rows[0]["status"] == "skipped"
    assert rows[0]["created_at"] == first["created_at"]

    # a different annotator is a distinct row (unique per task,type,id,annotator)
    up("bob", {"verdict": "pass"})
    assert (
        conn.execute(
            "SELECT count(*) FROM annotations WHERE task='t' AND target_id='x#0'"
        ).fetchone()[0]
        == 2
    )


# ── DB-12 ───────────────────────────────────────────────────────────────────


def test_upsert_suggestion_replaces(conn, tmp_path):
    db.open_task(conn, make_cfg(tmp_path, name="t"), assume_yes=True)

    def up(model, values):
        db.upsert_suggestion(
            conn,
            task="t",
            target_type="turn",
            target_id="x#0",
            values=values,
            model=model,
            raw_response=None,
        )

    up("gpt-4", {"verdict": "pass"})
    up("claude", {"verdict": "fail"})
    rows = conn.execute("SELECT * FROM suggestions WHERE task='t'").fetchall()
    assert len(rows) == 1  # one live suggestion
    assert rows[0]["model"] == "claude"
    assert json.loads(rows[0]["values"]) == {"verdict": "fail"}


# ── DB-13 ───────────────────────────────────────────────────────────────────


def test_build_queue_stable_across_reopen(tmp_path):
    path = db.default_db_path(tmp_path)
    conn = db.open_db(path)
    for i in range(20):
        db.import_trace(conn, ctf_trace(id=f"t{i:02d}"), "jsonl")
    db.open_task(conn, make_cfg(tmp_path, name="t", shuffle=True), assume_yes=True)
    q1 = db.build_queue(conn, "t")
    conn.close()

    conn2 = db.open_db(path)
    q2 = db.build_queue(conn2, "t")
    conn2.close()

    assert q1 == q2  # deterministic across resume (stored seed)
    assert sorted(q1) == [f"t{i:02d}" for i in range(20)]  # a permutation of all ids
    assert q1 != [f"t{i:02d}" for i in range(20)]  # actually shuffled


# ── DB-14 ───────────────────────────────────────────────────────────────────


def test_lock_stale_reclaimed(tmp_path):
    lock = tmp_path / ".tracelabel" / "lock"
    lock.parent.mkdir(parents=True)
    lock.write_text(json.dumps({"pid": 999_999, "port": 1, "started_at": "x"}))
    db.acquire_lock(tmp_path, 8377)
    info = json.loads(lock.read_text())
    assert info["pid"] == __import__("os").getpid()
    assert info["port"] == 8377
    db.release_lock(tmp_path)


def test_lock_live_refused(tmp_path):
    import os

    lock = tmp_path / ".tracelabel" / "lock"
    lock.parent.mkdir(parents=True)
    lock.write_text(json.dumps({"pid": os.getpid(), "port": 8377, "started_at": "x"}))
    with pytest.raises(EnvError) as ei:
        db.acquire_lock(tmp_path, 9000)
    msg = str(ei.value)
    assert str(os.getpid()) in msg
    assert "8377" in msg


def test_release_lock_idempotent(tmp_path):
    db.release_lock(tmp_path)  # no lock present → no error
    db.acquire_lock(tmp_path, 8377)
    db.release_lock(tmp_path)
    db.release_lock(tmp_path)  # second release is a no-op


# ── DB-15 ───────────────────────────────────────────────────────────────────


def test_target_counts_turn_and_trace_level(conn, tmp_path):
    # two traces, each with one assistant (labelable) turn
    for tid in ("ta", "tb"):
        db.import_trace(
            conn,
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
    db.open_task(conn, turn_cfg, assume_yes=True)
    db.upsert_annotation(
        conn,
        task="turntask",
        target_type="turn",
        target_id="ta#1",
        status="labeled",
        values={"verdict": "pass"},
        annotator="alice",
        schema_hash="h1",
        prefill_model=None,
    )
    counts = db.target_counts(conn, db.get_task(conn, "turntask"), "alice")
    assert counts["ta"] == (1, 1, 0)  # one labelable turn, labeled
    assert counts["tb"] == (1, 0, 0)  # one labelable turn, untouched

    # trace-level: every trace is one target; skip one
    trace_cfg = make_cfg(tmp_path, name="tracetask", level="trace")
    db.open_task(conn, trace_cfg, assume_yes=True)
    db.upsert_annotation(
        conn,
        task="tracetask",
        target_type="trace",
        target_id="tb",
        status="skipped",
        values={},
        annotator="alice",
        schema_hash="h1",
        prefill_model=None,
    )
    tcounts = db.target_counts(conn, db.get_task(conn, "tracetask"), "alice")
    assert tcounts["ta"] == (1, 0, 0)
    assert tcounts["tb"] == (1, 0, 1)


def test_unaddressed_and_without_suggestion(conn, tmp_path):
    for tid in ("ta", "tb"):
        db.import_trace(
            conn,
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
    db.open_task(conn, cfg, assume_yes=True)
    assert db.unaddressed_targets(conn, cfg) == ["ta#1", "tb#1"]
    db.upsert_annotation(
        conn,
        task="t",
        target_type="turn",
        target_id="ta#1",
        status="labeled",
        values={},
        annotator="alice",
        schema_hash="h1",
        prefill_model=None,
    )
    assert db.unaddressed_targets(conn, cfg) == ["tb#1"]

    db.upsert_suggestion(
        conn,
        task="t",
        target_type="turn",
        target_id="ta#1",
        values={"verdict": "pass"},
        model="gpt-4",
        raw_response=None,
    )
    assert db.targets_without_suggestion(conn, "t", ["ta#1", "tb#1"]) == ["tb#1"]
