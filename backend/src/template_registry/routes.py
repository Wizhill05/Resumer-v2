from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from src.core.auth import get_current_user
from src.core.config import settings
from src.schemas.template import TemplateManifest
from src.template_registry.service import TemplateRegistryService

router = APIRouter(prefix="/templates", tags=["templates"])

# Allowed asset subdirectories — prevent path traversal
_ALLOWED_ASSET_DIRS = {"fonts", "icons"}

# MIME types for template assets
_MIME_MAP = {
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


@router.get("", response_model=list[TemplateManifest])
async def list_templates():
    return TemplateRegistryService.list_templates()


@router.get("/{template_id}/assets/{asset_path:path}")
async def serve_template_asset(
    template_id: str,
    asset_path: str,
    _user=Depends(get_current_user),
):
    """Serve font/icon files from a template directory for editor iframe preview.

    Only allows files under whitelisted subdirs (fonts/, icons/) to prevent
    path traversal. Authenticated — same JWT as all BFF-proxied routes.
    """
    # Validate the first path component is in allowlist
    parts = Path(asset_path).parts
    if not parts or parts[0] not in _ALLOWED_ASSET_DIRS:
        raise HTTPException(status_code=403, detail="Asset path not allowed")

    # Resolve and verify the file is inside the template directory
    template_dir = settings.TEMPLATES_DIR / template_id
    if not template_dir.is_dir():
        raise HTTPException(status_code=404, detail="Template not found")

    file_path = (template_dir / asset_path).resolve()

    # Path traversal guard: must be under template_dir
    if not str(file_path).startswith(str(template_dir.resolve())):
        raise HTTPException(status_code=403, detail="Path traversal blocked")

    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")

    # Determine media type
    suffix = file_path.suffix.lower()
    media_type = _MIME_MAP.get(suffix, "application/octet-stream")

    return FileResponse(
        path=file_path,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )
