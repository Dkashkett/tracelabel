"""Types for the schema-change impact check behind ``PATCH .../tasks/{t}/schema``.

W0-BE defines only the shape here — every method body raises ``NotImplementedError``.
W1-IMPACT (Wave 1) fills in ``SchemaImpactAnalyzer.analyze()``. This split exists so the
route that will call it (``api/routes/tasks.py``, owned by W2-TASKS) can be written and
type-checked against a frozen interface before the real analysis logic lands.
"""

from dataclasses import dataclass
from typing import Any

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
        raise NotImplementedError("implemented by W1-IMPACT")
