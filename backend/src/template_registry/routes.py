from functools import partial
from pathlib import Path

from anyio import CapacityLimiter, to_thread

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user, get_optional_user
from src.core.config import settings
from src.core.database import get_db
from src.models.user import User
from src.schemas.template import (
    DEFAULT_SECTION_ORDER,
    TemplateLayoutResponse,
    TemplateLayoutUpdateRequest,
    TemplateManifest,
    TemplatePreviewRequest,
    TemplatePreviewResponse,
)
from src.services.content_split import resolve_default_split
from src.services.template_layout import (
    render_template_preview_pages,
    save_user_template_layout,
    validate_section_order,
)
from src.template_registry.service import TemplateRegistryService

router = APIRouter(prefix="/templates", tags=["templates"])
_preview_limiter = CapacityLimiter(2)

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
async def list_templates(user: User | None = Depends(get_optional_user)):
    """List template manifests with each user's effective default split."""
    return [
        t.model_copy(
            update={"default_content_split": resolve_default_split(user, t)}
        )
        for t in TemplateRegistryService.list_templates()
    ]


@router.get("/{template_id}/layout", response_model=TemplateLayoutResponse)
async def get_template_layout(
    template_id: str,
    user: User = Depends(get_current_user),
):
    """Retrieve the effective section order and default section order for a template."""
    manifest = TemplateRegistryService.get_template_manifest(template_id)
    if not manifest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template '{template_id}' not found",
        )

    default_order = list(
        manifest.default_section_order
        if manifest.default_section_order
        else DEFAULT_SECTION_ORDER
    )
    section_order = default_order

    if user.preferred_section_orders and template_id in user.preferred_section_orders:
        pref = user.preferred_section_orders[template_id]
        try:
            section_order = validate_section_order(pref, default_order)
        except HTTPException:
            section_order = default_order

    return TemplateLayoutResponse(
        template_id=template_id,
        default_section_order=default_order,
        section_order=section_order,
    )


@router.put("/{template_id}/layout", response_model=TemplateLayoutResponse)
async def update_template_layout(
    template_id: str,
    data: TemplateLayoutUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update and persist the user's preferred section order for a template."""
    manifest = TemplateRegistryService.get_template_manifest(template_id)
    if not manifest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template '{template_id}' not found",
        )

    default_order = list(
        manifest.default_section_order
        if manifest.default_section_order
        else DEFAULT_SECTION_ORDER
    )
    validated_order = validate_section_order(data.section_order, default_order)

    save_user_template_layout(user, template_id, validated_order, default_order)
    await db.commit()
    await db.refresh(user)

    return TemplateLayoutResponse(
        template_id=template_id,
        default_section_order=default_order,
        section_order=validated_order,
    )


@router.post("/{template_id}/preview", response_model=TemplatePreviewResponse)
async def preview_template(
    template_id: str,
    data: TemplatePreviewRequest | None = None,
    user: User = Depends(get_current_user),
):
    """Render authentic WeasyPrint preview pages using the fictional Dario Altman fixture.

    Authenticated and validated. Does NOT require a generation or consume LLM credits.
    """
    manifest = TemplateRegistryService.get_template_manifest(template_id)
    if not manifest:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template '{template_id}' not found",
        )

    requested_order = data.section_order if data else None
    default_order = list(
        manifest.default_section_order
        if manifest.default_section_order
        else DEFAULT_SECTION_ORDER
    )

    if requested_order is not None:
        validate_section_order(requested_order, default_order)
    else:
        if user.preferred_section_orders and template_id in user.preferred_section_orders:
            pref = user.preferred_section_orders[template_id]
            try:
                requested_order = validate_section_order(pref, default_order)
            except HTTPException:
                requested_order = default_order
        else:
            requested_order = default_order

    try:
        page_images, fit_result, effective_order = await to_thread.run_sync(
            partial(
                render_template_preview_pages,
                template_id=template_id,
                manifest=manifest,
                section_order=requested_order,
            ),
            limiter=_preview_limiter,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Template preview rendering failed: {exc}",
        ) from exc

    return TemplatePreviewResponse(
        template_id=template_id,
        page_images=page_images,
        page_count=fit_result.page_count,
        font_size=fit_result.font_size,
        fit_warning=not fit_result.fits_target,
        section_order=effective_order,
    )


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
