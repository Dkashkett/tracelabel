"""GET/PATCH /api/settings. Stub for Wave 0 — a later packet implements the bodies."""

from fastapi import APIRouter, HTTPException

from tracelabel.api.models import Settings, SettingsPatch

router = APIRouter(prefix="/api", tags=["settings"])


@router.get("/settings", response_model=Settings)
async def get_settings() -> Settings:
    raise HTTPException(status_code=501, detail="not implemented yet")


@router.patch("/settings", response_model=Settings)
async def patch_settings(patch: SettingsPatch) -> Settings:
    raise HTTPException(status_code=501, detail="not implemented yet")
