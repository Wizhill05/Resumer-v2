from datetime import datetime, timedelta, timezone
import hashlib
import io
import logging
import re
import time
import uuid

from fastapi import APIRouter, Cookie, Depends, HTTPException, status, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select, case, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user
from src.core.config import settings
from src.core.database import get_db
from src.core.executor import trigger_pipeline
from src.core.notify import send_completion_email
from src.core.storage import StorageService
from src.models.generation import Generation, UserRateLimit, GenerationLog, UserCreditOverride
from src.models.user import User
from src.schemas.generation import GenerationCreate, GenerationOut
from src.schemas.generation import (
    EditorManifest,
    EditorPayload,
    EditorProfileOut,
    EditorSaveRequest,
    EditorSaveResponse,
    RenderHtmlRequest,
    RenderHtmlResponse,
    RenderPdfPreviewResponse,
)
from src.template_registry.service import TemplateRegistryService

router = APIRouter(prefix="/generate", tags=["generation"])

STUCK_TIMEOUT_MINUTES = 15


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _user_email(db: AsyncSession, user_id) -> str | None:
    res = await db.execute(select(User).where(User.id == user_id))
    u = res.scalar_one_or_none()
    return u.email if u else None


async def check_rate_limit(user: User, db: AsyncSession) -> None:
    """Atomic upsert-and-increment. Row-level lock prevents the TOCTOU race
    where two concurrent requests both read the same count and bypass the cap."""
    if "*" in settings.admin_emails or user.email in settings.admin_emails:
        return  # Admin bypass

    now = datetime.now(timezone.utc)
    reset_at = now + timedelta(hours=24)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    override_result = await db.execute(
        select(UserCreditOverride).where(UserCreditOverride.user_id == user.id)
    )
    override = override_result.scalar_one_or_none()
    daily_cap = override.daily_cap if override and override.daily_cap is not None else settings.DEFAULT_DAILY_CAP
    monthly_cap = override.monthly_cap if override and override.monthly_cap is not None else settings.DEFAULT_MONTHLY_CAP

    monthly_result = await db.execute(
        select(func.count(Generation.id)).where(
            Generation.user_id == user.id,
            Generation.created_at >= month_start,
        )
    )
    monthly_count = monthly_result.scalar() or 0
    if monthly_cap and monthly_count >= monthly_cap:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Monthly cap reached: {monthly_cap} generations per month.",
        )

    stmt = (
        pg_insert(UserRateLimit)
        .values(user_id=user.id, request_count=1, reset_at=reset_at)
        .on_conflict_do_update(
            index_elements=[UserRateLimit.user_id],
            set_={
                "request_count": case(
                    (UserRateLimit.reset_at <= now, 1),
                    else_=UserRateLimit.request_count + 1,
                ),
                "reset_at": case(
                    (UserRateLimit.reset_at <= now, reset_at),
                    else_=UserRateLimit.reset_at,
                ),
            },
        )
        .returning(UserRateLimit.request_count, UserRateLimit.reset_at)
    )
    result = await db.execute(stmt)
    row = result.one()
    await db.commit()

    count, reset = row[0], row[1]
    if daily_cap and count > daily_cap:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit: {daily_cap} generations per day. Resets at {reset.isoformat()}",
        )


async def reap_stuck_generations(db: AsyncSession) -> None:
    """Mark in_progress runs older than the timeout as failed + notify.
    Covers Job executions that died (OOM, preemption) without reaching a
    terminal status. Runs lazily on each POST /generate — zero infra."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STUCK_TIMEOUT_MINUTES)
    result = await db.execute(
        select(Generation).where(
            Generation.status == "in_progress",
            Generation.updated_at < cutoff,
        )
    )
    stuck = result.scalars().all()
    for gen in stuck:
        gen.status = "failed"
        gen.error_message = "Pipeline interrupted (job did not complete within timeout)"
    if stuck:
        await db.commit()
        for gen in stuck:
            # Best-effort notification; non-fatal.
            email = await _user_email(db, gen.user_id)
            send_completion_email(email, gen)


# ── Generation CRUD ───────────────────────────────────────────────────────────


@router.post("", response_model=GenerationOut)
async def start_generation(
    data: GenerationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await reap_stuck_generations(db)
    await check_rate_limit(current_user, db)

    # ── Validate template exists and resolve content split ─────────────────────
    manifest = TemplateRegistryService.get_template_manifest(data.template_id)
    if not manifest:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Template '{data.template_id}' not found.",
        )

    if data.content_split is not None:
        # Check requested split exists in manifest's allowed list.
        allowed = [
            (s.projects, s.experience) for s in manifest.allowed_content_splits
        ]
        req = (data.content_split.projects, data.content_split.experience)
        if req not in allowed:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Invalid content_split {req} for template '{data.template_id}'. "
                    f"Allowed splits (projects, experience): {allowed}"
                ),
            )
        resolved_split = {"projects": data.content_split.projects, "experience": data.content_split.experience}
    else:
        # Fall back to template default.
        d = manifest.default_content_split
        resolved_split = {"projects": d.projects, "experience": d.experience}

    # ── Validate sufficient profile material exists in DB ─────────────────────
    from sqlalchemy import func
    from src.models.profile import UserExperience, UserProject

    exp_count_stmt = select(func.count()).select_from(UserExperience).where(UserExperience.user_id == current_user.id)
    proj_count_stmt = select(func.count()).select_from(UserProject).where(UserProject.user_id == current_user.id)

    exp_count = (await db.execute(exp_count_stmt)).scalar() or 0
    proj_count = (await db.execute(proj_count_stmt)).scalar() or 0

    if exp_count < resolved_split["experience"] or proj_count < resolved_split["projects"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Insufficient profile entries. You selected {resolved_split['experience']} experiences "
                f"and {resolved_split['projects']} projects, but you only have {exp_count} experiences "
                f"and {proj_count} projects in your profile."
            ),
        )

    gen = Generation(
        user_id=current_user.id,
        template_id=data.template_id,
        job_description=data.job_description,
        job_title=data.job_title,
        company=data.company,
        keywords=data.keywords,
        instructions=data.instructions,
        model_used=data.model_used,
        status="pending",
        content_split=resolved_split,
        send_email=data.send_email,
    )
    db.add(gen)
    await db.commit()
    await db.refresh(gen)

    # Trigger the pipeline (in-process asyncio task on Railway). If the trigger
    # itself fails, surface a 502 and mark the run failed so it isn't stuck pending.
    try:
        await trigger_pipeline(str(gen.id))
    except Exception as e:
        gen.status = "failed"
        gen.error_message = f"Failed to start pipeline: {e}"
        await db.commit()
        await db.refresh(gen)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to start pipeline: {e}",
        )
    return gen


@router.get("", response_model=list[GenerationOut])
async def list_generations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Generation)
        .where(Generation.user_id == current_user.id)
        .order_by(Generation.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{gen_id}", response_model=GenerationOut)
async def get_generation(
    gen_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Generation).where(Generation.id == uuid.UUID(gen_id), Generation.user_id == current_user.id)
    )
    gen = result.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    return gen


@router.get("/{gen_id}/logs")
async def get_logs(
    gen_id: str,
    since: int = 0,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cursor-based log poll for the History progress bar. Returns logs with
    id > `since` plus the current status so the client can detect terminal."""
    result = await db.execute(
        select(Generation).where(Generation.id == uuid.UUID(gen_id), Generation.user_id == current_user.id)
    )
    gen = result.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")

    log_result = await db.execute(
        select(GenerationLog)
        .where(GenerationLog.generation_id == gen.id, GenerationLog.id > since)
        .order_by(GenerationLog.id)
    )
    logs = [
        {
            "id": l.id,
            "node": l.node_name,
            "message": l.message,
            "level": l.level,
            "timestamp": l.timestamp.isoformat() if l.timestamp else None,
        }
        for l in log_result.scalars().all()
    ]
    return {"logs": logs, "status": gen.status}


@router.get("/{gen_id}/preview")
async def preview_generation(
    gen_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Fetch generation and verify ownership
    result = await db.execute(
        select(Generation).where(Generation.id == uuid.UUID(gen_id), Generation.user_id == current_user.id)
    )
    gen = result.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")

    if gen.status != "completed":
        raise HTTPException(status_code=400, detail="Generation is not completed yet.")

    # Try fetching from storage if configured and file actually exists
    storage = StorageService()
    if storage.enabled and gen.pdf_storage_key and storage.file_exists(gen.pdf_storage_key):
        presigned_url = storage.get_presigned_url(gen.pdf_storage_key)
        if presigned_url:
            return RedirectResponse(presigned_url)

    # Fallback: Render PDF on the fly
    metadata = gen.render_metadata or {}
    tailored_resume = metadata.get("tailored_resume")
    font_size = metadata.get("font_size")

    if not tailored_resume:
        raise HTTPException(status_code=404, detail="Resume data missing from generation record.")

    from src.models.profile import Profile
    if gen.is_guest and gen.guest_input_snapshot:
        profile_data = gen.guest_input_snapshot.get("profile") or {}
    else:
        profile_data = metadata.get("profile")
        if not profile_data:
            profile_res = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
            profile = profile_res.scalar_one_or_none()
            if not profile:
                raise HTTPException(status_code=404, detail="Profile not found")
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

    template_manifest = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not template_manifest:
        raise HTTPException(status_code=500, detail="Template files missing.")

    font_base_url = str(settings.TEMPLATES_DIR / gen.template_id)
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
        raise HTTPException(status_code=500, detail="Template rendering failed.")

    try:
        from weasyprint import HTML
    except (OSError, ImportError) as e:
        raise HTTPException(
            status_code=500,
            detail=f"PDF rendering is not configured on this host (missing Pango/Cairo system libraries): {e}"
        )

    pdf_bytes = HTML(string=html_rendered, base_url=font_base_url).write_pdf()
    return Response(content=pdf_bytes, media_type="application/pdf")


@router.get("/{gen_id}/thumb")
async def thumb_generation(
    gen_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Generation).where(Generation.id == uuid.UUID(gen_id), Generation.user_id == current_user.id)
    )
    gen = result.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    if not gen.thumb_storage_key:
        raise HTTPException(status_code=404, detail="Thumbnail not available")

    storage = StorageService()
    presigned_url = storage.get_presigned_url(gen.thumb_storage_key)
    if not presigned_url:
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    return RedirectResponse(presigned_url)


@router.delete("/{gen_id}", status_code=204)
async def delete_generation(
    gen_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Generation).where(Generation.id == uuid.UUID(gen_id), Generation.user_id == current_user.id)
    )
    gen = result.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")

    # Delete R2 artifacts (best-effort; log failures so orphaned objects are visible)
    storage = StorageService()
    for key in [gen.pdf_storage_key, gen.md_storage_key, gen.thumb_storage_key]:
        if key and not storage.delete_file(key):
            print(f"[delete_generation] failed to delete R2 object: {key}")

    # Delete DB row (logs cascade via FK ondelete=CASCADE)
    await db.delete(gen)
    await db.commit()


@router.get("/{gen_id}/download")
async def download_generation(
    gen_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Generation).where(Generation.id == uuid.UUID(gen_id), Generation.user_id == current_user.id)
    )
    gen = result.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")

    if gen.status != "completed":
        raise HTTPException(status_code=400, detail="Generation is not completed yet.")

    # Try R2 presigned URL with content-disposition
    storage = StorageService()
    if storage.enabled and gen.pdf_storage_key and storage.file_exists(gen.pdf_storage_key):
        _parts = [gen.job_title, gen.company]
        _slug = "-".join(
            p.lower().replace(" ", "-") for p in _parts if p and p != "Unknown Company"
        ) or "resume"
        _filename = f"{_slug}.pdf"
        presigned_url = storage.get_presigned_url(
            gen.pdf_storage_key,
            response_content_disposition=f'attachment; filename="{_filename}"',
        )
        if presigned_url:
            return RedirectResponse(presigned_url)

    # Fallback: render on-the-fly and serve as attachment
    metadata = gen.render_metadata or {}
    tailored_resume = metadata.get("tailored_resume")
    font_size = metadata.get("font_size")

    if not tailored_resume:
        raise HTTPException(status_code=404, detail="Resume data missing from generation record.")

    from src.models.profile import Profile
    profile_data = metadata.get("profile")
    if not profile_data:
        profile_res = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
        profile = profile_res.scalar_one_or_none()
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")
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

    template_manifest = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not template_manifest:
        raise HTTPException(status_code=500, detail="Template files missing.")

    font_base_url = str(settings.TEMPLATES_DIR / gen.template_id)
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
        raise HTTPException(status_code=500, detail="Template rendering failed.")

    try:
        from weasyprint import HTML
    except (OSError, ImportError) as e:
        raise HTTPException(status_code=500, detail=f"PDF rendering unavailable: {e}")

    pdf_bytes = HTML(string=html_rendered, base_url=font_base_url).write_pdf()
    _parts = [gen.job_title, gen.company]
    _slug = "-".join(
        p.lower().replace(" ", "-") for p in _parts if p and p != "Unknown Company"
    ) or "resume"
    filename = f"{_slug}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── Editor endpoints ───────────────────────────────────────────────────────────


async def _get_completed_gen_for_editor(
    gen_id: str,
    current_user,
    db: AsyncSession,
):
    """Shared ownership + status guard for all editor routes."""
    if not settings.ENABLE_RESUME_EDITOR:
        raise HTTPException(status_code=503, detail="Resume editor is not enabled.")

    try:
        gen_uuid = uuid.UUID(gen_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Generation not found")

    result = await db.execute(
        select(Generation).where(
            Generation.id == gen_uuid, Generation.user_id == current_user.id
        )
    )
    gen = result.scalar_one_or_none()
    if not gen:
        raise HTTPException(status_code=404, detail="Generation not found")
    if gen.status != "completed":
        raise HTTPException(status_code=400, detail="Generation is not completed yet.")
    metadata = gen.render_metadata or {}
    if not metadata.get("tailored_resume"):
        raise HTTPException(
            status_code=400, detail="Generation has no editable resume data."
        )
    return gen


@router.get("/{gen_id}/editor", response_model=EditorPayload)
async def get_editor_payload(
    gen_id: str,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all data the split-pane editor needs to initialise."""
    gen = await _get_completed_gen_for_editor(gen_id, current_user, db)

    manifest_obj = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not manifest_obj:
        raise HTTPException(status_code=500, detail="Template manifest missing.")

    metadata = gen.render_metadata or {}

    # Load profile (prefer override in metadata)
    profile_data = metadata.get("profile")
    if not profile_data:
        from src.models.profile import Profile
        profile_res = await db.execute(
            select(Profile).where(Profile.user_id == current_user.id)
        )
        profile = profile_res.scalar_one_or_none()
        profile_data = {
            "full_name": profile.full_name if profile else None,
            "email": profile.email if profile else None,
            "phone": profile.phone if profile else None,
            "location": profile.location if profile else None,
            "linkedin_url": profile.linkedin_url if profile else None,
            "github_url": profile.github_url if profile else None,
            "portfolio_url": profile.portfolio_url if profile else None,
            "subtitle": profile.subtitle if profile else None,
        }

    profile_out = EditorProfileOut(**profile_data)

    return EditorPayload(
        id=gen.id,
        template_id=gen.template_id,
        job_title=gen.job_title,
        company=gen.company,
        status=gen.status,
        editor_revision=metadata.get("editor_revision", 0),
        profile=profile_out,
        tailored_resume=metadata["tailored_resume"],
        font_size=metadata.get("font_size"),
        page_count=metadata.get("page_count"),
        fit_warning=metadata.get("fit_warning", False),
        manifest=EditorManifest(
            min_font_size=manifest_obj.min_font_size,
            max_font_size=manifest_obj.max_font_size,
            target_pages=manifest_obj.target_pages,
            page_margin_mm=manifest_obj.page_margin_mm,
        ),
    )


@router.post("/{gen_id}/render-html", response_model=RenderHtmlResponse)
async def render_html_for_editor(
    gen_id: str,
    data: RenderHtmlRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Jinja-only render for live editor preview. No WeasyPrint, no PDF."""
    gen = await _get_completed_gen_for_editor(gen_id, current_user, db)

    manifest_obj = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not manifest_obj:
        raise HTTPException(status_code=500, detail="Template manifest missing.")

    # Resolve profile for header: check request data, metadata, then database
    profile_data = None
    if data.profile:
        profile_data = data.profile
    else:
        metadata = gen.render_metadata or {}
        profile_data = metadata.get("profile")

    if not profile_data:
        from src.models.profile import Profile
        profile_res = await db.execute(
            select(Profile).where(Profile.user_id == current_user.id)
        )
        profile = profile_res.scalar_one_or_none()
        profile_data = {
            "full_name": profile.full_name if profile else "",
            "email": profile.email if profile else None,
            "phone": profile.phone if profile else None,
            "location": profile.location if profile else None,
            "linkedin_url": profile.linkedin_url if profile else None,
            "github_url": profile.github_url if profile else None,
            "portfolio_url": profile.portfolio_url if profile else None,
            "subtitle": profile.subtitle if profile else None,
        }

    font_size = data.font_size if data.font_size is not None else manifest_obj.max_font_size

    from src.services.resume_render import render_resume_html

    html = render_resume_html(
        template_id=gen.template_id,
        profile=profile_data,
        resume=data.resume,
        font_size=font_size,
        page_margin_mm=manifest_obj.page_margin_mm,
    )
    if html is None:
        raise HTTPException(status_code=500, detail="Template rendering failed.")

    # Rewrite relative asset URLs so fonts/icons load in the browser iframe.
    # CSS: url('fonts/...') → url('/api/backend/templates/{id}/assets/fonts/...')
    # HTML: src="personal-classic/icons/..." → src="/api/backend/templates/{id}/assets/icons/..."
    asset_base = f"/api/backend/templates/{gen.template_id}/assets"
    html = re.sub(
        r"""url\(['"]?(fonts/[^'")\s]+)['"]?\)""",
        lambda m: f"url('{asset_base}/{m.group(1)}')",
        html,
    )
    html = re.sub(
        r"""src=["'](?:personal-classic/)?(icons/[^"']+)["']""",
        lambda m: f'src="{asset_base}/{m.group(1)}"',
        html,
    )

    return RenderHtmlResponse(html=html, template_id=gen.template_id)


@router.post("/{gen_id}/render-pdf-preview", response_model=RenderPdfPreviewResponse)
async def render_pdf_preview_for_editor(
    gen_id: str,
    data: RenderHtmlRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Render the same paginated document that the editor exports.

    Browser layout cannot faithfully emulate WeasyPrint's page fragmentation.
    Returning rasterized PDF pages makes each visible boundary authoritative,
    including the final line on every page.
    """
    gen = await _get_completed_gen_for_editor(gen_id, current_user, db)
    manifest_obj = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not manifest_obj:
        raise HTTPException(status_code=500, detail="Template manifest missing.")

    profile_data = data.profile or (gen.render_metadata or {}).get("profile")
    if not profile_data:
        from src.models.profile import Profile

        profile_res = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
        profile = profile_res.scalar_one_or_none()
        profile_data = {
            "full_name": profile.full_name if profile else "",
            "email": profile.email if profile else None,
            "phone": profile.phone if profile else None,
            "location": profile.location if profile else None,
            "linkedin_url": profile.linkedin_url if profile else None,
            "github_url": profile.github_url if profile else None,
            "portfolio_url": profile.portfolio_url if profile else None,
            "subtitle": profile.subtitle if profile else None,
        }

    from src.services.resume_render import fit_and_render_pdf

    try:
        pdf_bytes, fit_result = fit_and_render_pdf(
            template_id=gen.template_id,
            profile=profile_data,
            resume=data.resume,
            manifest=manifest_obj.model_dump(),
        )

        import base64
        import pypdfium2 as pdfium  # type: ignore[import-untyped]

        pdf = pdfium.PdfDocument(pdf_bytes)
        page_images: list[str] = []
        for page_index in range(len(pdf)):
            # 1.25x A4 keeps type legible without making every debounced response huge.
            page = pdf[page_index]
            bitmap = page.render(scale=1.25, rotation=0)
            image = bitmap.to_pil()
            buffer = io.BytesIO()
            image.save(buffer, format="WEBP", quality=82, method=4)
            encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
            page_images.append(f"data:image/webp;base64,{encoded}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Preview render failed: {exc}") from exc

    return RenderPdfPreviewResponse(
        page_images=page_images,
        font_size=fit_result.font_size,
        page_count=fit_result.page_count,
        fit_warning=not fit_result.fits_target,
    )


@router.post("/{gen_id}/save", response_model=EditorSaveResponse)
async def save_editor(
    gen_id: str,
    data: EditorSaveRequest,
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Persist edited resume: WeasyPrint fit, R2 upload, metadata update."""
    _log = logging.getLogger("resumer.editor.save")
    _t0 = time.monotonic()

    gen = await _get_completed_gen_for_editor(gen_id, current_user, db)

    metadata = dict(gen.render_metadata or {})
    current_revision = metadata.get("editor_revision", 0)
    if data.expected_revision != current_revision:
        raise HTTPException(
            status_code=409,
            detail=f"Revision conflict: expected {data.expected_revision}, current {current_revision}. Reload and retry.",
        )

    manifest_obj = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not manifest_obj:
        raise HTTPException(status_code=500, detail="Template manifest missing.")

    # Resolve profile: check request data, metadata, then database
    profile_data = None
    if data.profile:
        profile_data = data.profile
    else:
        profile_data = metadata.get("profile")

    if not profile_data:
        from src.models.profile import Profile
        profile_res = await db.execute(
            select(Profile).where(Profile.user_id == current_user.id)
        )
        profile = profile_res.scalar_one_or_none()
        profile_data = {
            "full_name": profile.full_name if profile else "",
            "email": profile.email if profile else None,
            "phone": profile.phone if profile else None,
            "location": profile.location if profile else None,
            "linkedin_url": profile.linkedin_url if profile else None,
            "github_url": profile.github_url if profile else None,
            "portfolio_url": profile.portfolio_url if profile else None,
            "subtitle": profile.subtitle if profile else None,
        }

    # Run WeasyPrint binary search
    from src.services.resume_render import build_resume_markdown, fit_and_render_pdf

    try:
        pdf_bytes, fit_result = fit_and_render_pdf(
            template_id=gen.template_id,
            profile=profile_data,
            resume=data.resume,
            manifest=manifest_obj.model_dump(),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF render failed: {e}")

    # Markdown
    md_text = build_resume_markdown(profile=profile_data, resume=data.resume)

    # Thumbnail
    thumb_bytes: bytes | None = None
    try:
        import pypdfium2 as pdfium  # type: ignore[import-untyped]

        pdf_doc = pdfium.PdfDocument(pdf_bytes)
        page = pdf_doc[0]
        scale = 400 / page.get_width()
        bitmap = page.render(scale=scale, rotation=0)
        pil_image = bitmap.to_pil()
        buf = io.BytesIO()
        pil_image.save(buf, format="WEBP", quality=80)
        thumb_bytes = buf.getvalue()
    except Exception as thumb_err:
        print(f"[editor/save] Thumbnail generation skipped: {thumb_err}")

    # R2 upload
    pdf_key = f"runs/{gen_id}/resume.pdf"
    md_key = f"runs/{gen_id}/resume.md"
    thumb_key = f"runs/{gen_id}/thumb.webp"

    storage = StorageService()
    pdf_uploaded = storage.upload_bytes(pdf_bytes, pdf_key, "application/pdf")
    storage.upload_bytes(md_text.encode("utf-8"), md_key, "text/markdown")
    thumb_uploaded = thumb_bytes and storage.upload_bytes(thumb_bytes, thumb_key, "image/webp")

    # Snapshot original resume on first edit
    new_revision = current_revision + 1
    if current_revision == 0 and "pre_edit_snapshot" not in metadata:
        metadata["pre_edit_snapshot"] = {
            "tailored_resume": metadata.get("tailored_resume"),
            "font_size": metadata.get("font_size"),
            "page_count": metadata.get("page_count"),
            "saved_at": datetime.now(timezone.utc).isoformat(),
        }

    metadata["tailored_resume"] = data.resume
    metadata["profile"] = profile_data
    metadata["font_size"] = fit_result.font_size
    metadata["page_count"] = fit_result.page_count
    metadata["fit_warning"] = not fit_result.fits_target
    metadata["editor_revision"] = new_revision
    metadata["edited_at"] = datetime.now(timezone.utc).isoformat()

    gen.render_metadata = metadata
    if pdf_uploaded:
        gen.pdf_storage_key = pdf_key
    if thumb_uploaded:
        gen.thumb_storage_key = thumb_key

    await db.commit()

    _elapsed_ms = int((time.monotonic() - _t0) * 1000)
    _log.info(
        "editor.save gen=%s revision=%d font_size=%.2f page_count=%d fit_warning=%s elapsed_ms=%d",
        gen_id, new_revision, fit_result.font_size, fit_result.page_count,
        not fit_result.fits_target, _elapsed_ms,
    )

    return EditorSaveResponse(
        editor_revision=new_revision,
        font_size=fit_result.font_size,
        page_count=fit_result.page_count,
        fit_warning=not fit_result.fits_target,
        pdf_storage_key=pdf_key if pdf_uploaded else None,
        thumb_storage_key=thumb_key if thumb_uploaded else None,
    )


# ── Guest claim endpoint ───────────────────────────────────────────────────────


@router.post("/claim-guest")
async def claim_guest_generations(
    current_user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    guest_token: str | None = Cookie(default=None, alias="resumer_guest_token"),
):
    """Transfer all guest generations matching the browser cookie to the logged-in user.

    Called after a guest logs in so their trial resume appears in History.
    Safe to call multiple times (idempotent — already-claimed rows won't match).
    """
    if not guest_token:
        return {"claimed": 0}

    token_hash = hashlib.sha256(guest_token.encode("utf-8")).hexdigest()

    result = await db.execute(
        select(Generation).where(
            Generation.guest_token_hash == token_hash,
            Generation.is_guest == True,  # noqa: E712
        )
    )
    generations = result.scalars().all()

    if not generations:
        return {"claimed": 0}

    for gen in generations:
        gen.user_id = current_user.id
        gen.is_guest = False
        gen.guest_token_hash = None
        gen.expires_at = None  # remove TTL — belongs to real account now

    await db.commit()
    return {"claimed": len(generations)}
