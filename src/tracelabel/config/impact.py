"""Types for the schema-change impact check behind ``PATCH .../tasks/{t}/schema``.

W0-BE defines only the shape here — every method body raises ``NotImplementedError``.
W1-IMPACT (Wave 1) fills in ``SchemaImpactAnalyzer.analyze()``. This split exists so the
route that will call it (``api/routes/tasks.py``, owned by W2-TASKS) can be written and
type-checked against a frozen interface before the real analysis logic lands.
"""

import json
from dataclasses import dataclass
from typing import Any, cast

from tracelabel.db.annotations import AnnotationRepository


@dataclass(frozen=True)
class RetypedField:
    name: str
    old_type: str
    new_type: str


@dataclass(frozen=True)
class SchemaImpact:
    """What replacing a task's field schema with a new one would do to its existing
    annotations.

    ``breaking`` is true when applying the new schema needs explicit confirmation
    (``PATCH .../schema?confirm=true``) rather than being applied automatically.
    """

    removed_fields: list[str]
    retyped_fields: list[RetypedField]
    # field name -> option values that were removed AND are used by a stored annotation.
    # An option removed from the schema but never selected by anyone is not reported here.
    removed_options: dict[str, list[str]]
    affected_annotations: int
    breaking: bool


def _decode_values(raw: str) -> dict[str, Any]:
    """Decode a stored annotation's ``values`` JSON column back into a plain dict."""
    return cast(dict[str, Any], json.loads(raw))


class SchemaImpactAnalyzer:
    """Compare an old and new field list for a task and report the impact of the edit.

    Per the plan, option removal is checked against *stored annotation values*, not
    just the schema — dropping an option nobody selected is non-breaking.
    """

    def __init__(self, annotations: AnnotationRepository) -> None:
        self._annotations = annotations

    def analyze(
        self,
        task: str,
        old_fields: list[dict[str, Any]],
        new_fields: list[dict[str, Any]],
    ) -> SchemaImpact:
        old_by_name = {field["name"]: field for field in old_fields}
        new_by_name = {field["name"]: field for field in new_fields}

        removed_fields = sorted(name for name in old_by_name if name not in new_by_name)
        retyped_fields = sorted(
            (
                RetypedField(
                    name=name,
                    old_type=old_by_name[name]["type"],
                    new_type=new_by_name[name]["type"],
                )
                for name in old_by_name
                if name in new_by_name and old_by_name[name]["type"] != new_by_name[name]["type"]
            ),
            key=lambda retyped: retyped.name,
        )
        retyped_names = {retyped.name for retyped in retyped_fields}

        # Options dropped from a field that survives the edit unchanged in type.
        # Whether any of them actually matter is decided below, against stored values.
        candidate_removed_options = self._candidate_removed_options(
            old_by_name, new_by_name, retyped_names
        )

        removed_options: dict[str, set[str]] = {}
        affected: set[tuple[str, str, str]] = set()
        for row in self._annotations.list_for_export(task, "all"):
            values = _decode_values(row["values"])
            annotation_key = (row["target_type"], row["target_id"], row["annotator"])

            for name in removed_fields:
                if values.get(name) is not None:
                    affected.add(annotation_key)

            for name in retyped_names:
                if values.get(name) is not None:
                    affected.add(annotation_key)

            for name, candidates in candidate_removed_options.items():
                used = self._used_options(values.get(name), candidates)
                if used:
                    removed_options.setdefault(name, set()).update(used)
                    affected.add(annotation_key)

        return SchemaImpact(
            removed_fields=removed_fields,
            retyped_fields=retyped_fields,
            removed_options={name: sorted(options) for name, options in removed_options.items()},
            affected_annotations=len(affected),
            breaking=bool(affected),
        )

    @staticmethod
    def _candidate_removed_options(
        old_by_name: dict[str, dict[str, Any]],
        new_by_name: dict[str, dict[str, Any]],
        retyped_names: set[str],
    ) -> dict[str, set[str]]:
        """Options present on a field's old schema but not its new one, for fields that
        exist in both and kept the same type. Excludes retyped/removed fields — those are
        already fully accounted for by ``removed_fields``/``retyped_fields``.
        """
        candidates: dict[str, set[str]] = {}
        for name, old_field in old_by_name.items():
            if name in retyped_names or name not in new_by_name:
                continue
            if old_field.get("type") not in ("single_select", "multi_select"):
                continue
            new_field = new_by_name[name]
            removed = set(old_field.get("options") or []) - set(new_field.get("options") or [])
            if removed:
                candidates[name] = removed
        return candidates

    @staticmethod
    def _used_options(value: Any, candidates: set[str]) -> set[str]:
        """Which of ``candidates`` a single stored field value actually uses — a scalar
        for ``single_select``, a list for ``multi_select``."""
        if value is None:
            return set()
        if isinstance(value, list):
            return {option for option in value if option in candidates}
        return {value} if value in candidates else set()
