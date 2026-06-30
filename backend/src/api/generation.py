from datetime import datetime, timedelta, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select, case
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user
from src.core.config import settings
from src.core.database import get_db
from src.core.executor import trigger_pipeline
from src.core.notify import send_completion_email
from src.core.storage import StorageService
from src.models.generation import Generation, UserRateLimit, GenerationLog
from src.models.user import User
from src.schemas.generation import GenerationCreate, GenerationOut
from src.template_registry.service import TemplateRegistryService

router = APIRouter(prefix="/generate", tags=["generation"])

MAX_DAILY_RUNS = 50
STUCK_TIMEOUT_MINUTES = 15


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _user_email(db: AsyncSession, user_id) -> str | None:
    res = await db.execute(select(User).where(User.id == user_id))
    u = res.scalar_one_or_none()
    return u.email if u else None


async def check_rate_limit(user: User, db: AsyncSession) -> None:
    """Atomic upsert-and-increment. Row-level lock prevents the TOCTOU race
    where two concurrent requests both read the same count and bypass the cap."""
    now = datetime.now(timezone.utc)
    reset_at = now + timedelta(hours=24)

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
    if count > MAX_DAILY_RUNS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit: {MAX_DAILY_RUNS} generations per day. Resets at {reset.isoformat()}",
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
    )
    db.add(gen)
    await db.commit()
    await db.refresh(gen)

    # Trigger the Cloud Run Job (prod) or in-process task (dev). If the trigger
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
    profile_res = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
    profile = profile_res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    template_manifest = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not template_manifest:
        raise HTTPException(status_code=500, detail="Template files missing.")

    font_base_url = str(settings.TEMPLATES_DIR / gen.template_id)
    html_rendered = TemplateRegistryService.render_template(
        gen.template_id,
        {
            "profile": {
                "full_name": profile.full_name,
                "email": profile.email,
                "phone": profile.phone,
                "location": profile.location,
                "linkedin_url": profile.linkedin_url,
                "github_url": profile.github_url,
                "portfolio_url": profile.portfolio_url,
                "subtitle": profile.subtitle,
            },
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
    profile_res = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
    profile = profile_res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    template_manifest = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not template_manifest:
        raise HTTPException(status_code=500, detail="Template files missing.")

    font_base_url = str(settings.TEMPLATES_DIR / gen.template_id)
    html_rendered = TemplateRegistryService.render_template(
        gen.template_id,
        {
            "profile": {
                "full_name": profile.full_name,
                "email": profile.email,
                "phone": profile.phone,
                "location": profile.location,
                "linkedin_url": profile.linkedin_url,
                "github_url": profile.github_url,
                "portfolio_url": profile.portfolio_url,
                "subtitle": profile.subtitle,
            },
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
