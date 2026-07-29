"""Task and rubric routes, all under /api/projects/{project}/tasks.

Every handler is implemented except ``POST .../suggestions``, which wires to
SuggestionService + JobRunner — that's Phase 3 work per docs/refactor-plan.md §3 and
is intentionally left as a 501 stub here.

The schema PATCH endpoint (``PATCH .../schema?confirm=``) is the trickiest piece: it
runs ``SchemaImpactAnalyzer`` *before* calling ``TaskRepository.update_schema()`` so it
can return a 409 with a full ``SchemaImpactOut`` body when a breaking change isn't
confirmed, rather than relying on ``update_schema``'s own (simpler) unconfirmed-change
guard.
"""

from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from tracelabel.api.deps import get_project_database
from tracelabel.api.models import (
    JobRef,
    RetypedFieldOut,
    SchemaImpactOut,
    SchemaOut,
    SchemaPatch,
    SuggestIn,
    TaskCreate,
    TaskDetail,
    TaskPatch,
    TaskSummary,
)
from tracelabel.config.impact import SchemaImpactAnalyzer
from tracelabel.config.models import TaskSpec
from tracelabel.config.presets import DEFAULT_FIELDS as _PASS_FAIL_FIELDS
from tracelabel.ctf.hashing import canonical_json
from tracelabel.db.database import Database, decode_json
from tracelabel.errors import NotFoundError

router = APIRouter(prefix="/api/projects/{project}/tasks", tags=["tasks"])

# Used by POST .../tasks when the caller doesn't supply `fields`. Mirrors the
# frontend's own default (NewTaskDialog's "Pass / fail" preset) so the HTTP API and
# the UI agree on what a task looks like out of the box.
DEFAULT_FIELDS: list[dict[str, Any]] = [
    field.model_dump(exclude_none=True) for field in _PASS_FAIL_FIELDS
]

# Non-schema columns PATCH .../{task} is allowed to touch. Field/schema changes go
# through the separate PATCH .../schema endpoint below, never through this one.
_PATCHABLE_COLUMNS = (
    "annotator",
    "queue_scope",
    "llm_model",
    "llm_temperature",
    "llm_max_tokens",
    "suggest_instructions",
    "review_of",
    "review_labels_from",
)


def _row_to_detail(row: Any) -> TaskDetail:
    """Map a `tasks` row to the API's TaskDetail shape, shared by GET/POST/PATCH."""
    return TaskDetail(
        name=row["name"],
        level=row["level"],
        fields=cast(list[dict[str, Any]], decode_json(row["resolved_schema"])),
        label_roles=cast(list[str], decode_json(row["label_roles"])),
        shuffle=row["shuffle_seed"] is not None,
        annotator=row["annotator"] or "annotator",
        schema_hash=row["schema_hash"],
        compat_hash=row["compat_hash"],
        queue_scope=cast(dict[str, Any], decode_json(row["queue_scope"])),
        llm_model=row["llm_model"],
        llm_temperature=row["llm_temperature"],
        llm_max_tokens=row["llm_max_tokens"],
        suggest_instructions=row["suggest_instructions"],
        review_of=row["review_of"],
        review_labels_from=row["review_labels_from"] or "judge",
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _require_task_row(database: Database, task: str) -> Any:
    row = database.tasks.get(task)
    if row is None:
        raise NotFoundError(f"unknown task '{task}'")
    return row


@router.get("", response_model=list[TaskSummary])
async def list_tasks(
    project: str,
    database: Database = Depends(get_project_database),  # noqa: B008
) -> list[TaskSummary]:
    summaries = database.tasks.list_summaries()
    result = []
    for summary in summaries:
        # list_summaries() doesn't carry compat_hash, so re-read the row for it.
        row = database.tasks.get(cast(str, summary["name"]))
        assert row is not None  # just listed by the same repository, can't vanish here
        result.append(
            TaskSummary(
                name=cast(str, summary["name"]),
                level=summary["level"],
                schema_hash=cast(str, summary["schema_hash"]),
                compat_hash=row["compat_hash"],
                updated_at=cast(str, summary["updated_at"]),
                total=cast(int, summary["total"]),
                addressed=cast(int, summary["addressed"]),
                queue_scope=cast(dict[str, Any], summary["queue_scope"]),
            )
        )
    return result


@router.post("", response_model=TaskDetail)
async def create_task(
    project: str,
    body: TaskCreate,
    database: Database = Depends(get_project_database),  # noqa: B008
) -> TaskDetail:
    spec = TaskSpec(
        name=body.name,
        level=body.level,
        fields=body.fields if body.fields is not None else DEFAULT_FIELDS,
        label_roles=body.label_roles if body.label_roles is not None else ["assistant"],
        shuffle=body.shuffle,
        annotator=body.annotator or "annotator",
        queue_scope=body.queue_scope if body.queue_scope is not None else {"type": "all"},
    )
    row = database.tasks.create(spec)
    return _row_to_detail(row)


@router.get("/{task}", response_model=TaskDetail)
async def get_task(
    project: str,
    task: str,
    database: Database = Depends(get_project_database),  # noqa: B008
) -> TaskDetail:
    row = _require_task_row(database, task)
    return _row_to_detail(row)


@router.patch("/{task}", response_model=TaskDetail)
async def patch_task(
    project: str,
    task: str,
    body: TaskPatch,
    database: Database = Depends(get_project_database),  # noqa: B008
) -> TaskDetail:
    _require_task_row(database, task)  # 404s early if the task doesn't exist

    updates: dict[str, Any] = {}
    for column, value in body.model_dump(exclude_unset=True).items():
        if column == "shuffle":
            # shuffle is stored as shuffle_seed (None <-> off). TaskRepository owns the
            # "how do we pick a seed" policy via its seed_factory; reuse it here rather
            # than inventing a second way to pick one.
            updates["shuffle_seed"] = database.tasks._seed_factory() if value else None  # noqa: SLF001
        elif column == "queue_scope":
            updates["queue_scope"] = canonical_json(value)
        elif column in _PATCHABLE_COLUMNS:
            updates[column] = value

    if updates:
        updates["updated_at"] = database.tasks._clock()  # noqa: SLF001 - mirrors db/tasks.py's own style
        assignments = ", ".join(f"{column}=:{column}" for column in updates)
        with database.transaction() as connection:
            connection.execute(
                f"UPDATE tasks SET {assignments} WHERE name=:name",
                {**updates, "name": task},
            )

    row = _require_task_row(database, task)
    return _row_to_detail(row)


@router.get("/{task}/schema", response_model=SchemaOut)
async def get_schema(
    project: str,
    task: str,
    database: Database = Depends(get_project_database),  # noqa: B008
) -> SchemaOut:
    row = _require_task_row(database, task)
    return SchemaOut(
        fields=cast(list[dict[str, Any]], decode_json(row["resolved_schema"])),
        schema_hash=row["schema_hash"],
        compat_hash=row["compat_hash"],
    )


@router.patch("/{task}/schema", response_model=None)
async def patch_schema(
    project: str,
    task: str,
    body: SchemaPatch,
    confirm: bool = False,
    database: Database = Depends(get_project_database),  # noqa: B008
) -> SchemaOut | JSONResponse:
    row = _require_task_row(database, task)
    old_fields = cast(list[dict[str, Any]], decode_json(row["resolved_schema"]))

    analyzer = SchemaImpactAnalyzer(database.annotations)
    impact = analyzer.analyze(task, old_fields, body.fields)

    if impact.breaking and not confirm:
        impact_out = SchemaImpactOut(
            removed_fields=impact.removed_fields,
            retyped_fields=[
                RetypedFieldOut(
                    name=retyped.name, old_type=retyped.old_type, new_type=retyped.new_type
                )
                for retyped in impact.retyped_fields
            ],
            removed_options=impact.removed_options,
            affected_annotations=impact.affected_annotations,
            breaking=impact.breaking,
        )
        return JSONResponse(status_code=409, content=impact_out.model_dump())

    # Either non-breaking (safe to apply outright) or the caller already confirmed —
    # update_schema()'s own unconfirmed-change guard is a no-op here since confirmed=True.
    updated = database.tasks.update_schema(task, body.fields, confirmed=True)
    return SchemaOut(
        fields=cast(list[dict[str, Any]], decode_json(updated["resolved_schema"])),
        schema_hash=updated["schema_hash"],
        compat_hash=updated["compat_hash"],
    )


@router.post("/{task}/suggestions", response_model=JobRef)
async def start_suggestions(project: str, task: str, body: SuggestIn) -> JobRef:
    # Phase 3 territory (SuggestionService + JobRunner wiring) — intentionally left
    # unimplemented for this wave. See docs/refactor-plan.md §3.
    raise HTTPException(status_code=501, detail="not implemented yet")
