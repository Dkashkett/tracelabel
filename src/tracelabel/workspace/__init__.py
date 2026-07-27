"""The workspace package: the on-disk ``~/.tracelabel`` root, its projects, and the
workspace-wide lock.

Re-exports the public surface so callers can write ``from tracelabel.workspace import
Workspace`` instead of reaching into the submodules.
"""

from .models import ProjectRecord, Settings
from .workspace import Workspace, WorkspaceLock, default_workspace_root, slugify

__all__ = [
    "ProjectRecord",
    "Settings",
    "Workspace",
    "WorkspaceLock",
    "default_workspace_root",
    "slugify",
]
