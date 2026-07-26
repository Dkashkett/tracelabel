import json
from pathlib import Path
from typing import Any

from tracelabel.config.models import Level, TaskSpec
from tracelabel.workspace.workspace import Workspace


def tmp_project(tmp_path: Path) -> Path:
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    return project_dir


def read_jsonl(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def temp_workspace(tmp_path: Path) -> Workspace:
    """A Workspace rooted at a fresh ``tmp_path/.tracelabel``, for tests that need a
    real (if not yet fully implemented — see workspace/workspace.py) workspace object.
    """
    return Workspace(tmp_path / ".tracelabel")


def make_task_spec(
    *,
    name: str = "task",
    level: Level = "turn",
    fields: list[dict[str, Any]] | None = None,
    label_roles: list[str] | None = None,
    shuffle: bool = False,
    annotator: str = "alice",
) -> TaskSpec:
    """A TaskSpec with sane defaults, for tests exercising task creation/schema edits."""
    return TaskSpec(
        name=name,
        level=level,
        fields=fields
        if fields is not None
        else [{"name": "verdict", "type": "single_select", "options": ["pass", "fail"]}],
        label_roles=label_roles if label_roles is not None else ["assistant"],
        shuffle=shuffle,
        annotator=annotator,
    )
