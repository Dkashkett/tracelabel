import json

import pytest

from helpers import make_task_spec
from tracelabel.config.models import LLMConfig, ResolvedTaskConfig, TaskSpec
from tracelabel.config.resolver import compat_hash
from tracelabel.db.database import Database, default_db_path
from tracelabel.db.tasks import full_schema_hash as compute_schema_hash
from tracelabel.errors import NotFoundError, UserError

# ── helpers ─────────────────────────────────────────────────────────────────


def make_cfg(
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
        llm=None,
        suggest_instructions=None,
    )


def ctf_trace(*, id):
    return {
        "id": id,
        "messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ],
    }


@pytest.fixture
def conn(tmp_path):
    database = Database(default_db_path(tmp_path))
    yield database
    database.close()


# ── create() ─────────────────────────────────────────────────────────────────


def test_create_inserts_row_with_all_v3_columns(conn):
    spec = make_task_spec(
        name="t",
        fields=[{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}],
    )
    row = conn.tasks.create(spec)
    assert row["name"] == "t"
    assert row["level"] == "turn"
    assert row["annotator"] == "alice"
    assert json.loads(row["label_roles"]) == ["assistant"]
    assert row["shuffle_seed"] is None
    assert row["queue_scope"] == '{"type":"all"}' or json.loads(row["queue_scope"]) == {
        "type": "all"
    }
    assert row["compat_hash"] == compat_hash(spec.fields)
    assert row["review_labels_from"] == "judge"
    assert row["llm_model"] is None


def test_create_shuffle_true_gets_a_seed(conn):
    row = conn.tasks.create(make_task_spec(name="t", shuffle=True))
    assert row["shuffle_seed"] is not None


def test_create_stores_llm_config(conn):
    spec = TaskSpec(
        name="t",
        level="turn",
        fields=[{"name": "verdict", "type": "text"}],
        label_roles=["assistant"],
        shuffle=False,
        annotator="alice",
        llm=LLMConfig(model="gpt-4o-mini", temperature=0.2, max_tokens=512),
    )
    row = conn.tasks.create(spec)
    assert row["llm_model"] == "gpt-4o-mini"
    assert row["llm_temperature"] == 0.2
    assert row["llm_max_tokens"] == 512


def test_create_duplicate_name_rejected(conn):
    conn.tasks.create(make_task_spec(name="t"))
    with pytest.raises(UserError):
        conn.tasks.create(make_task_spec(name="t"))


def test_create_custom_queue_scope_stored(conn):
    spec = TaskSpec(
        name="t",
        level="turn",
        fields=[{"name": "verdict", "type": "text"}],
        label_roles=["assistant"],
        shuffle=False,
        annotator="alice",
        queue_scope={"type": "source", "source_id": 1},
    )
    row = conn.tasks.create(spec)
    assert json.loads(row["queue_scope"]) == {"type": "source", "source_id": 1}


# ── update_schema() ──────────────────────────────────────────────────────────


def test_update_schema_no_op_when_unchanged(conn):
    fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    row = conn.tasks.create(make_task_spec(name="t", fields=fields))
    updated = conn.tasks.update_schema("t", fields, confirmed=False)
    assert updated["schema_hash"] == row["schema_hash"]


def test_update_schema_requires_confirmation(conn):
    fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    conn.tasks.create(make_task_spec(name="t", fields=fields))
    new_fields = [{"name": "quality", "type": "text"}]
    with pytest.raises(UserError) as ei:
        conn.tasks.update_schema("t", new_fields, confirmed=False)
    assert "Aborted" in str(ei.value)
    # unchanged
    assert json.loads(conn.tasks.get("t")["resolved_schema"]) == fields


def test_update_schema_confirmed_writes_new_schema_and_both_hashes(conn):
    fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    conn.tasks.create(make_task_spec(name="t", fields=fields))
    new_fields = [{"name": "quality", "type": "text"}]
    row = conn.tasks.update_schema("t", new_fields, confirmed=True)
    assert json.loads(row["resolved_schema"]) == new_fields
    assert row["compat_hash"] == compat_hash(new_fields)


def test_update_schema_missing_task_raises_not_found(conn):
    with pytest.raises(NotFoundError):
        conn.tasks.update_schema("nope", [], confirmed=True)


# ── resolve() ────────────────────────────────────────────────────────────────


def test_resolve_builds_resolved_task_config_from_row(conn):
    spec = make_task_spec(
        name="t",
        level="trace",
        fields=[{"name": "verdict", "type": "text"}],
        label_roles=["assistant"],
        annotator="bob",
    )
    conn.tasks.create(spec)
    resolved = conn.tasks.resolve("t")
    assert resolved.name == "t"
    assert resolved.level == "trace"
    assert resolved.fields == spec.fields
    assert resolved.label_roles == ["assistant"]
    assert resolved.annotator == "bob"
    assert resolved.llm is None
    assert resolved.review_labels_from == "judge"


def test_resolve_includes_llm_config(conn):
    spec = TaskSpec(
        name="t",
        level="turn",
        fields=[{"name": "verdict", "type": "text"}],
        label_roles=["assistant"],
        shuffle=False,
        annotator="alice",
        llm=LLMConfig(model="gpt-4o-mini", temperature=0.3, max_tokens=256),
    )
    conn.tasks.create(spec)
    resolved = conn.tasks.resolve("t")
    assert resolved.llm == LLMConfig(model="gpt-4o-mini", temperature=0.3, max_tokens=256)


def test_resolve_missing_task_raises_not_found(conn):
    with pytest.raises(NotFoundError):
        conn.tasks.resolve("nope")


# ── open() back-compat wrapper ───────────────────────────────────────────────


def test_open_creates_when_missing(conn):
    conn.tasks.open(make_cfg(name="t"), assume_yes=True)
    assert conn.tasks.get("t") is not None


def test_open_seed_only_when_shuffle(conn):
    conn.tasks.open(make_cfg(name="seq", shuffle=False), assume_yes=True)
    conn.tasks.open(make_cfg(name="shuf", shuffle=True), assume_yes=True)
    assert conn.tasks.get("seq")["shuffle_seed"] is None
    assert conn.tasks.get("shuf")["shuffle_seed"] is not None


def test_open_level_mismatch(conn):
    conn.tasks.open(make_cfg(name="t", level="turn"), assume_yes=True)
    with pytest.raises(UserError) as ei:
        conn.tasks.open(make_cfg(name="t", level="trace"), assume_yes=True)
    assert "level=turn" in str(ei.value)


_DEFAULT_FIELDS = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
_OTHER_FIELDS = [{"name": "quality", "type": "text"}]
_THIRD_FIELDS = [{"name": "notes", "type": "text"}]


def test_open_no_op_when_schema_unchanged(conn):
    real_hash = compute_schema_hash(_DEFAULT_FIELDS)
    conn.tasks.open(make_cfg(name="t", schema_hash=real_hash), assume_yes=True)
    conn.tasks.open(make_cfg(name="t", schema_hash=real_hash), assume_yes=True)
    assert conn.tasks.get("t")["schema_hash"] == real_hash


def test_open_drift_declined_aborts(conn):
    conn.tasks.open(
        make_cfg(name="t", schema_hash=compute_schema_hash(_DEFAULT_FIELDS)), assume_yes=True
    )
    with pytest.raises(UserError) as ei:
        conn.tasks.open(
            make_cfg(
                name="t", schema_hash=compute_schema_hash(_OTHER_FIELDS), fields=_OTHER_FIELDS
            ),
            assume_yes=False,
            confirm=lambda _prompt: False,
        )
    assert "Aborted" in str(ei.value)
    assert conn.tasks.get("t")["schema_hash"] == compute_schema_hash(_DEFAULT_FIELDS)


def test_open_drift_declined_without_confirm_callback_also_aborts(conn):
    """No stdin fallback: assume_yes=False and no confirm callback must not block on
    input() — it raises instead."""
    conn.tasks.open(
        make_cfg(name="t", schema_hash=compute_schema_hash(_DEFAULT_FIELDS)), assume_yes=True
    )
    with pytest.raises(UserError):
        conn.tasks.open(
            make_cfg(
                name="t", schema_hash=compute_schema_hash(_OTHER_FIELDS), fields=_OTHER_FIELDS
            ),
            assume_yes=False,
        )
    assert conn.tasks.get("t")["schema_hash"] == compute_schema_hash(_DEFAULT_FIELDS)


def test_open_drift_confirmed_updates(conn):
    conn.tasks.open(
        make_cfg(name="t", schema_hash=compute_schema_hash(_DEFAULT_FIELDS)), assume_yes=True
    )
    new_fields = _OTHER_FIELDS
    conn.tasks.open(
        make_cfg(name="t", schema_hash=compute_schema_hash(new_fields), fields=new_fields),
        assume_yes=False,
        confirm=lambda _prompt: True,
    )
    row = conn.tasks.get("t")
    assert row["schema_hash"] == compute_schema_hash(new_fields)
    assert json.loads(row["resolved_schema"]) == new_fields

    # --yes also updates without a confirm callback being consulted
    conn.tasks.open(
        make_cfg(name="t", schema_hash=compute_schema_hash(_THIRD_FIELDS), fields=_THIRD_FIELDS),
        assume_yes=True,
        confirm=lambda _prompt: pytest.fail("confirm must not be called with --yes"),
    )
    assert conn.tasks.get("t")["schema_hash"] == compute_schema_hash(_THIRD_FIELDS)


# ── build_queue() ────────────────────────────────────────────────────────────


def test_build_queue_stable_across_reopen(tmp_path):
    path = default_db_path(tmp_path)
    conn = Database(path)
    for i in range(20):
        conn.traces.import_trace(ctf_trace(id=f"t{i:02d}"), "jsonl")
    conn.tasks.open(make_cfg(name="t", shuffle=True), assume_yes=True)
    q1 = conn.tasks.build_queue("t")
    conn.close()

    conn2 = Database(path)
    q2 = conn2.tasks.build_queue("t")
    conn2.close()

    assert q1 == q2
    assert sorted(q1) == [f"t{i:02d}" for i in range(20)]
    assert q1 != [f"t{i:02d}" for i in range(20)]


def test_build_queue_scoped_to_trace_ids_in_given_order(conn):
    for i in range(5):
        conn.traces.import_trace(ctf_trace(id=f"t{i:02d}"), "jsonl")
    conn.tasks.open(make_cfg(name="t", shuffle=False), assume_yes=True)

    scoped = conn.tasks.build_queue("t", ["t03", "t00", "t04"])
    assert scoped == ["t03", "t00", "t04"]

    whole = conn.tasks.build_queue("t", None)
    assert whole == [f"t{i:02d}" for i in range(5)]
    assert conn.tasks.build_queue("t") == whole


def test_build_queue_shuffle_applies_on_top_of_scoped_list(tmp_path):
    path = default_db_path(tmp_path)
    conn = Database(path)
    for i in range(20):
        conn.traces.import_trace(ctf_trace(id=f"t{i:02d}"), "jsonl")
    conn.tasks.open(make_cfg(name="t", shuffle=True), assume_yes=True)
    scoped_ids = [f"t{i:02d}" for i in range(10)]

    q1 = conn.tasks.build_queue("t", scoped_ids)
    conn.close()

    conn2 = Database(path)
    q2 = conn2.tasks.build_queue("t", scoped_ids)
    conn2.close()

    assert sorted(q1) == scoped_ids
    assert q1 == q2
    assert q1 != scoped_ids


def test_build_queue_source_scope(conn):
    for i in range(4):
        conn.traces.import_trace(ctf_trace(id=f"t{i:02d}"), "jsonl")
    conn.connection.execute(
        "INSERT INTO sources (id, name, path, adapter, imported_at, trace_count) "
        "VALUES (1, 'src', NULL, 'jsonl', '2026-01-01T00:00:00Z', 2)"
    )
    conn.connection.executemany(
        "INSERT INTO trace_sources (source_id, trace_id) VALUES (1, ?)",
        [("t00",), ("t02",)],
    )
    conn.connection.commit()
    spec = TaskSpec(
        name="t",
        level="turn",
        fields=[{"name": "verdict", "type": "text"}],
        label_roles=["assistant"],
        shuffle=False,
        annotator="alice",
        queue_scope={"type": "source", "source_id": 1},
    )
    conn.tasks.create(spec)
    assert conn.tasks.build_queue("t") == ["t00", "t02"]


def test_build_queue_missing_task_raises_not_found(conn):
    with pytest.raises(NotFoundError):
        conn.tasks.build_queue("nope")
