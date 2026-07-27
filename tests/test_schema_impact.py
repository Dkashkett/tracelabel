"""Tests for SchemaImpactAnalyzer (config/impact.py).

The critical correctness rule under test: a schema edit is only "breaking" (needs
PATCH .../schema?confirm=true) when it would actually orphan a *stored* annotation
value — not merely because the schema changed. Dropping an option nobody ever
selected, or removing a field nobody ever filled in, must be non-breaking.

Most tests use FakeAnnotationRepository, a minimal stand-in that only implements the
one method analyze() calls (list_for_export) — this keeps the hypothesis property
tests fast and independent of sqlite. A couple of tests wire the real
tracelabel.db.annotations.AnnotationRepository against a real database to prove the
fake's shape matches production (row["values"] as a JSON text column, etc).
"""

import json
from pathlib import Path
from typing import Any

from hypothesis import given
from hypothesis import strategies as st

from tracelabel.config.impact import SchemaImpactAnalyzer
from tracelabel.db.database import Database, default_db_path

# ── fakes & helpers ───────────────────────────────────────────────────────────


class FakeAnnotationRepository:
    """Stands in for db.annotations.AnnotationRepository. analyze() only calls
    list_for_export(), so that's all this fakes.
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def list_for_export(self, task: str, status: str) -> list[dict[str, Any]]:
        return self._rows


def annotation_row(
    *, target_id: str, values: dict[str, Any], target_type: str = "trace", annotator: str = "alice"
) -> dict[str, Any]:
    return {
        "target_type": target_type,
        "target_id": target_id,
        "annotator": annotator,
        "values": json.dumps(values),
    }


def make_real_db(tmp_path: Path, *, task: str = "t") -> Database:
    """A real Database with one task row inserted directly by SQL — TaskRepository.open()
    is currently broken against the v3 schema (see tests/test_db.py's xfails; that's
    W1-TASKS's job, not this packet's), so tests here don't depend on it.
    """
    db = Database(default_db_path(tmp_path))
    now = "2024-01-01T00:00:00Z"
    db.connection.execute(
        "INSERT INTO tasks (name, level, schema_hash, resolved_schema, label_roles, "
        "shuffle_seed, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (task, "trace", "h1", "[]", "[]", None, now, now),
    )
    db.connection.commit()
    return db


# ── example-based tests ──────────────────────────────────────────────────────


def test_no_change_is_non_breaking():
    old_fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    new_fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository([]))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert impact == analyzer.analyze("t", old_fields, new_fields)
    assert not impact.removed_fields
    assert not impact.retyped_fields
    assert not impact.removed_options
    assert impact.affected_annotations == 0
    assert impact.breaking is False


def test_cosmetic_edit_is_non_breaking_even_with_stored_data():
    old_fields = [{"name": "note", "type": "text", "label": "Note"}]
    new_fields = [{"name": "note", "type": "text", "label": "Notes", "help": "Freeform"}]
    rows = [annotation_row(target_id="tr1", values={"note": "some note"})]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert not impact.removed_fields
    assert not impact.retyped_fields
    assert not impact.removed_options
    assert impact.affected_annotations == 0
    assert impact.breaking is False


def test_additive_field_is_non_breaking():
    old_fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    new_fields = [
        {"name": "verdict", "type": "single_select", "options": ["pass", "fail"]},
        {"name": "notes", "type": "text"},
    ]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository([]))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert impact.breaking is False
    assert impact.affected_annotations == 0


def test_removed_field_unused_is_non_breaking():
    old_fields = [{"name": "note", "type": "text"}, {"name": "verdict", "type": "text"}]
    new_fields = [{"name": "verdict", "type": "text"}]
    rows = [
        annotation_row(target_id="tr1", values={"verdict": "x"}),  # never touched "note"
        annotation_row(target_id="tr2", values={"note": None, "verdict": "y"}),
    ]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert impact.removed_fields == ["note"]
    assert impact.affected_annotations == 0
    assert impact.breaking is False


def test_removed_field_used_is_breaking():
    old_fields = [{"name": "note", "type": "text"}, {"name": "verdict", "type": "text"}]
    new_fields = [{"name": "verdict", "type": "text"}]
    rows = [
        annotation_row(target_id="tr1", values={"note": "wrote something", "verdict": "x"}),
        annotation_row(target_id="tr2", values={"verdict": "y"}),  # unaffected
    ]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert impact.removed_fields == ["note"]
    assert impact.affected_annotations == 1
    assert impact.breaking is True


def test_removed_option_unused_is_non_breaking():
    old_fields = [
        {
            "name": "verdict",
            "type": "single_select",
            "options": ["pass", "fail", "unsure"],
        }
    ]
    new_fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    rows = [
        annotation_row(target_id="tr1", values={"verdict": "pass"}),
        annotation_row(target_id="tr2", values={"verdict": "fail"}),
    ]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert impact.removed_options == {}
    assert impact.affected_annotations == 0
    assert impact.breaking is False


def test_removed_option_used_is_breaking():
    old_fields = [
        {
            "name": "verdict",
            "type": "single_select",
            "options": ["pass", "fail", "unsure"],
        }
    ]
    new_fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    rows = [
        annotation_row(target_id="tr1", values={"verdict": "unsure"}),
        annotation_row(target_id="tr2", values={"verdict": "pass"}),
    ]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert impact.removed_options == {"verdict": ["unsure"]}
    assert impact.affected_annotations == 1
    assert impact.breaking is True


def test_removed_option_used_in_multi_select_is_breaking():
    old_fields = [
        {"name": "tags", "type": "multi_select", "options": ["a", "b", "c"]},
    ]
    new_fields = [{"name": "tags", "type": "multi_select", "options": ["a", "c"]}]
    rows = [
        annotation_row(target_id="tr1", values={"tags": ["a", "b"]}),
        annotation_row(target_id="tr2", values={"tags": ["a", "c"]}),
    ]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert impact.removed_options == {"tags": ["b"]}
    assert impact.affected_annotations == 1
    assert impact.breaking is True


def test_retyped_field_unused_is_non_breaking():
    old_fields = [{"name": "verdict", "type": "text"}]
    new_fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    rows = [annotation_row(target_id="tr1", values={})]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert [r.name for r in impact.retyped_fields] == ["verdict"]
    assert impact.affected_annotations == 0
    assert impact.breaking is False


def test_retyped_field_used_is_breaking():
    old_fields = [{"name": "verdict", "type": "text"}]
    new_fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    rows = [annotation_row(target_id="tr1", values={"verdict": "looked fine to me"})]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert impact.retyped_fields[0].old_type == "text"
    assert impact.retyped_fields[0].new_type == "single_select"
    assert impact.affected_annotations == 1
    assert impact.breaking is True


def test_affected_annotations_counts_distinct_annotations_not_hits():
    # One annotation affected by both a removed field and a removed option should
    # still only count once.
    old_fields = [
        {"name": "note", "type": "text"},
        {"name": "verdict", "type": "single_select", "options": ["pass", "fail", "unsure"]},
    ]
    new_fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]
    rows = [annotation_row(target_id="tr1", values={"note": "hi", "verdict": "unsure"})]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    assert impact.affected_annotations == 1
    assert impact.breaking is True


# ── real-repository integration ──────────────────────────────────────────────


def test_real_annotation_repository_wiring(tmp_path):
    db = make_real_db(tmp_path)
    try:
        db.annotations.upsert_annotation(
            task="t",
            target_type="trace",
            target_id="tr1",
            status="labeled",
            values={"verdict": "fail"},
            annotator="alice",
            schema_hash="h1",
            prefill_model=None,
        )
        db.annotations.upsert_annotation(
            task="t",
            target_type="trace",
            target_id="tr2",
            status="labeled",
            values={"verdict": "pass"},
            annotator="alice",
            schema_hash="h1",
            prefill_model=None,
        )
        analyzer = SchemaImpactAnalyzer(db.annotations)
        old_fields = [
            {"name": "verdict", "type": "single_select", "options": ["pass", "fail", "unsure"]}
        ]
        new_fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "unsure"]}]

        impact = analyzer.analyze("t", old_fields, new_fields)

        assert impact.removed_options == {"verdict": ["fail"]}
        assert impact.affected_annotations == 1
        assert impact.breaking is True
    finally:
        db.close()


def test_real_annotation_repository_non_breaking_wiring(tmp_path):
    db = make_real_db(tmp_path)
    try:
        db.annotations.upsert_annotation(
            task="t",
            target_type="trace",
            target_id="tr1",
            status="labeled",
            values={"verdict": "pass"},
            annotator="alice",
            schema_hash="h1",
            prefill_model=None,
        )
        analyzer = SchemaImpactAnalyzer(db.annotations)
        old_fields = [
            {"name": "verdict", "type": "single_select", "options": ["pass", "fail", "unsure"]}
        ]
        new_fields = [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}]

        impact = analyzer.analyze("t", old_fields, new_fields)

        assert impact.removed_options == {}
        assert impact.affected_annotations == 0
        assert impact.breaking is False
    finally:
        db.close()


# ── property-based tests ─────────────────────────────────────────────────────

_OPTION_UNIVERSE = ["a", "b", "c", "d", "e"]


@st.composite
def _schema_option_split(draw: st.DrawFn) -> tuple[list[str], list[str], list[str]]:
    """(old_options, new_options, dropped_options) for a single field, where dropped is
    exactly old - new."""
    old_options = draw(
        st.lists(st.sampled_from(_OPTION_UNIVERSE), min_size=2, max_size=5, unique=True)
    )
    new_options = draw(
        st.lists(st.sampled_from(old_options), min_size=1, max_size=len(old_options), unique=True)
    )
    dropped = [option for option in old_options if option not in new_options]
    return old_options, new_options, dropped


@given(
    _schema_option_split(),
    st.lists(st.one_of(st.none(), st.sampled_from(_OPTION_UNIVERSE)), max_size=6),
)
def test_removed_option_is_breaking_iff_actually_stored(split, stored_values):
    """The rule under test: an option removed from the schema is reported/breaking
    exactly when some stored annotation used it — never for options nobody selected."""
    old_options, new_options, dropped = split
    old_fields = [{"name": "verdict", "type": "single_select", "options": old_options}]
    new_fields = [{"name": "verdict", "type": "single_select", "options": new_options}]
    rows = [
        annotation_row(target_id=f"tr{i}", values={"verdict": value} if value is not None else {})
        for i, value in enumerate(stored_values)
    ]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    used_dropped_options = {value for value in stored_values if value in dropped}
    expected_affected = sum(1 for value in stored_values if value in dropped)

    assert set(impact.removed_options.get("verdict", [])) == used_dropped_options
    assert impact.affected_annotations == expected_affected
    assert impact.breaking == bool(used_dropped_options)


@given(st.lists(st.one_of(st.none(), st.text(min_size=1, max_size=5)), max_size=6))
def test_removed_field_is_breaking_iff_some_annotation_has_a_non_null_value(values):
    old_fields = [{"name": "note", "type": "text"}]
    new_fields: list[dict[str, Any]] = []
    rows = [
        annotation_row(target_id=f"tr{i}", values={"note": value} if value is not None else {})
        for i, value in enumerate(values)
    ]
    analyzer = SchemaImpactAnalyzer(FakeAnnotationRepository(rows))

    impact = analyzer.analyze("t", old_fields, new_fields)

    expected_affected = sum(1 for value in values if value is not None)

    assert impact.removed_fields == ["note"]
    assert impact.affected_annotations == expected_affected
    assert impact.breaking == (expected_affected > 0)
