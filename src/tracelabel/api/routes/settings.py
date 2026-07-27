"""GET/PATCH /api/settings."""

from fastapi import APIRouter, Depends

from tracelabel.api.deps import get_workspace
from tracelabel.api.models import Settings, SettingsPatch
from tracelabel.workspace.models import Settings as StoredSettings
from tracelabel.workspace.workspace import Workspace

router = APIRouter(prefix="/api", tags=["settings"])


def _to_api_settings(stored: StoredSettings) -> Settings:
    return Settings(
        annotator=stored.annotator,
        default_llm_model=stored.default_llm_model,
        theme=stored.theme,  # type: ignore[arg-type]  # Literal is validated on write
    )


@router.get("/settings", response_model=Settings)
async def get_settings(
    workspace: Workspace = Depends(get_workspace),  # noqa: B008 - FastAPI's DI idiom
) -> Settings:
    return _to_api_settings(workspace.read_settings())


@router.patch("/settings", response_model=Settings)
async def patch_settings(
    patch: SettingsPatch,
    workspace: Workspace = Depends(get_workspace),  # noqa: B008 - FastAPI's DI idiom
) -> Settings:
    current = workspace.read_settings()
    updates = patch.model_dump(exclude_unset=True)
    merged = StoredSettings(
        annotator=updates.get("annotator", current.annotator),
        default_llm_model=updates.get("default_llm_model", current.default_llm_model),
        theme=updates.get("theme", current.theme),
    )
    workspace.write_settings(merged)
    return _to_api_settings(merged)
