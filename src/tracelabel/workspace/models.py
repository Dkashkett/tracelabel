"""Plain data shapes stored on disk by a Workspace.

~/.tracelabel/                 # or <--dir>/.tracelabel/
  settings.json                # -> Settings
  lock                         # one workspace lock (see WorkspaceLock in workspace.py)
  projects/
    support-triage/
      project.json              # -> ProjectRecord
      tracelabel.db
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ProjectRecord:
    """The contents of one project's ``project.json``."""

    name: str
    slug: str
    created_at: str
    notes: str = ""


@dataclass(frozen=True)
class Settings:
    """The contents of the workspace-level ``settings.json``."""

    annotator: str | None = None
    default_llm_model: str | None = None
    theme: str = "system"
