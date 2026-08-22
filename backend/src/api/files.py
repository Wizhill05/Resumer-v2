"""files.py — Public, capability-authenticated file streaming and download endpoints."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.file_links import format_resume_filename, verify_file_token
from src.core.storage import StorageService
from src.models.generation import Generation
from src.models.profile import Profile
from src.template_registry.service import TemplateRegistryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/gen/{gen_id}/resume.pdf")
async def get_resume_pdf(
    gen_id: str,
    t: str = Query(default="", description="Capability download token"),
    dl: int = Query(default=0, description="Set to 1 to force file download attachment"),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Stream or download a generated resume PDF using an HMAC capability token.

    Tolerates extra tracking query parameters (e.g. utm_source from ChatGPT)
    without breaking cryptographic verification.
    """
    # 1. Validate UUID format
    try:
        gen_uuid = uuid.UUID(gen_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid generation ID format.",
        )

    # 2. Cryptographic capability token verification
    if not verify_file_token(token=t, gen_id=gen_id, kind="resume"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid, tampered, or expired download token.",
        )

    # 3. Fetch generation record from database
    result = await db.execute(select(Generation).where(Generation.id == gen_uuid))
    gen = result.scalar_one_or_none()
    if not gen:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Generation record not found.",
        )

    if gen.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Generation is not completed yet (current status: '{gen.status}').",
        )

    # 4. Determine response headers
    filename = format_resume_filename(job_title=gen.job_title, company=gen.company)
    disposition_type = "attachment" if dl == 1 else "inline"
    common_headers = {
        "Content-Disposition": f'{disposition_type}; filename="{filename}"',
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
    }

    # 5. Primary strategy: Stream bytes from Cloudflare R2
    storage = StorageService()
    if storage.enabled and gen.pdf_storage_key and storage.file_exists(gen.pdf_storage_key):
        try:
            s3_response = storage.s3_client.get_object(
                Bucket=settings.R2_BUCKET_NAME,
                Key=gen.pdf_storage_key,
            )
            body = s3_response["Body"]

            def _iter_chunks():
                for chunk in iter(lambda: body.read(64 * 1024), b""):
                    yield chunk

            return StreamingResponse(
                _iter_chunks(),
                media_type="application/pdf",
                headers=common_headers,
            )
        except Exception as err:
            logger.warning(
                "files.py: R2 streaming failed for key '%s', falling back to on-the-fly render: %s",
                gen.pdf_storage_key,
                err,
            )

    # 6. Fallback strategy: Re-compile and render PDF on-the-fly via WeasyPrint
    metadata = gen.render_metadata or {}
    tailored_resume = metadata.get("tailored_resume")
    font_size = metadata.get("font_size")

    if not tailored_resume:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tailored resume data is missing from generation record.",
        )

    if gen.is_guest and gen.guest_input_snapshot:
        profile_data = gen.guest_input_snapshot.get("profile") or {}
    else:
        profile_data = metadata.get("profile")
        if not profile_data:
            profile_res = await db.execute(select(Profile).where(Profile.user_id == gen.user_id))
            profile = profile_res.scalar_one_or_none()
            if profile:
                profile_data = {
                    "full_name": profile.full_name,
                    "email": profile.email,
                    "phone": profile.phone,
                    "location": profile.location,
                    "linkedin_url": profile.linkedin_url,
                    "github_url": profile.github_url,
                    "portfolio_url": profile.portfolio_url,
                    "subtitle": profile.subtitle,
                }
            else:
                profile_data = {}

    template_manifest = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not template_manifest:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Template manifest missing for template '{gen.template_id}'.",
        )

    html_rendered = TemplateRegistryService.render_template(
        gen.template_id,
        {
            "profile": profile_data,
            "resume": tailored_resume,
            "font_size": font_size or template_manifest.max_font_size,
            "page_margin_mm": template_manifest.page_margin_mm,
        },
    )
    if not html_rendered:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Template rendering failed.",
        )

    try:
        from weasyprint import HTML

        font_base_url = str(settings.TEMPLATES_DIR / gen.template_id)
        pdf_bytes = HTML(string=html_rendered, base_url=font_base_url).write_pdf()
    except Exception as render_err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"PDF compilation failed: {render_err}",
        )

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers=common_headers,
    )
