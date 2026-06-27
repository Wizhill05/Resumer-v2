import json
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.responses import StreamingResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from jinja2 import Template

from src.core.auth import get_current_user
from src.core.database import get_db, AsyncSessionLocal
from src.core.storage import StorageService
from src.models.generation import Generation, UserRateLimit, GenerationLog
from src.models.profile import Profile, UserProject, UserExperience, UserEducation, UserExtracurricular
from src.models.user import User
from src.schemas.generation import GenerationCreate, GenerationOut
from src.pipeline.graph import compile_graph
from src.pipeline.nodes import sse_queue_var, log_progress
from src.pipeline.state import ResumeGraphState
from src.template_registry.service import TemplateRegistryService

router = APIRouter(prefix="/generate", tags=["generation"])

MAX_DAILY_RUNS = 50


async def check_rate_limit(user: User, db: AsyncSession) -> None:
    now = datetime.now(timezone.utc)
    result = await db.execute(select(UserRateLimit).where(UserRateLimit.user_id == user.id))
    rl = result.scalar_one_or_none()

    if not rl:
        rl = UserRateLimit(user_id=user.id, request_count=1, reset_at=now + timedelta(hours=24))
        db.add(rl)
        await db.commit()
        return

    if now >= rl.reset_at:
        rl.request_count = 1
        rl.reset_at = now + timedelta(hours=24)
        await db.commit()
        return

    if rl.request_count >= MAX_DAILY_RUNS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit: {MAX_DAILY_RUNS} generations per day. Resets at {rl.reset_at.isoformat()}",
        )

    rl.request_count += 1
    await db.commit()


@router.post("", response_model=GenerationOut)
async def start_generation(
    data: GenerationCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await check_rate_limit(current_user, db)

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
    )
    db.add(gen)
    await db.commit()
    await db.refresh(gen)
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


@router.get("/{gen_id}/stream")
async def stream_generation(
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

    async def event_generator():
        # If already completed or failed, stream historical logs and stop
        if gen.status in ("completed", "failed"):
            log_result = await db.execute(
                select(GenerationLog)
                .where(GenerationLog.generation_id == gen.id)
                .order_by(GenerationLog.timestamp)
            )
            logs = log_result.scalars().all()
            for log in logs:
                yield f"data: {json.dumps({'node': log.node_name, 'message': log.message, 'level': log.level})}\n\n"
            yield f"data: {json.dumps({'node': 'system', 'message': gen.status, 'level': 'status'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        # If already in_progress (reconnect), replay logs then poll for new ones
        if gen.status == "in_progress":
            await db.close()

            last_log_id = 0
            async with AsyncSessionLocal() as replay_db:
                log_result = await replay_db.execute(
                    select(GenerationLog)
                    .where(GenerationLog.generation_id == gen.id)
                    .order_by(GenerationLog.timestamp)
                )
                for log in log_result.scalars().all():
                    yield f"data: {json.dumps({'node': log.node_name, 'message': log.message, 'level': log.level})}\n\n"
                    last_log_id = log.id

            # Poll DB for new logs until the generation reaches a terminal status
            while True:
                await asyncio.sleep(2)
                async with AsyncSessionLocal() as poll_db:
                    gen_res = await poll_db.execute(
                        select(Generation).where(Generation.id == gen.id)
                    )
                    gen_check = gen_res.scalar_one()

                    # Stream any new log entries since last check
                    new_logs_res = await poll_db.execute(
                        select(GenerationLog)
                        .where(GenerationLog.generation_id == gen.id, GenerationLog.id > last_log_id)
                        .order_by(GenerationLog.timestamp)
                    )
                    for log in new_logs_res.scalars().all():
                        yield f"data: {json.dumps({'node': log.node_name, 'message': log.message, 'level': log.level})}\n\n"
                        last_log_id = log.id

                    if gen_check.status in ("completed", "failed"):
                        yield f"data: {json.dumps({'node': 'system', 'message': gen_check.status, 'level': 'status'})}\n\n"
                        yield "data: [DONE]\n\n"
                        return

        # Initialize the SSE Queue and set context var
        queue = asyncio.Queue()
        sse_queue_var.set(queue)

        # Update generation status to in_progress
        gen.status = "in_progress"
        await db.commit()

        # Load user profile and documents
        profile_res = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
        profile = profile_res.scalar_one_or_none()
        if not profile:
            yield f"data: {json.dumps({'node': 'system', 'message': 'Profile not found. Please complete basic onboarding.', 'level': 'error'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        projects_res = await db.execute(
            select(UserProject).where(UserProject.user_id == current_user.id).order_by(UserProject.sort_order)
        )
        projects = [dict(
            name=p.name,
            description=p.description,
            technologies=p.technologies,
            bullet_points=p.bullet_points,
            github_url=p.github_url,
            live_url=p.live_url,
            start_date=p.start_date.isoformat() if p.start_date else None,
            end_date=p.end_date.isoformat() if p.end_date else None,
        ) for p in projects_res.scalars().all()]

        exp_res = await db.execute(
            select(UserExperience).where(UserExperience.user_id == current_user.id).order_by(UserExperience.sort_order)
        )
        experiences = [dict(
            role=e.role,
            organization=e.organization,
            location=e.location,
            bullet_points=e.bullet_points,
            start_date=e.start_date.isoformat() if e.start_date else None,
            end_date=e.end_date.isoformat() if e.end_date else None,
        ) for e in exp_res.scalars().all()]

        edu_res = await db.execute(
            select(UserEducation).where(UserEducation.user_id == current_user.id).order_by(UserEducation.sort_order)
        )
        education = [dict(
            degree=ed.degree,
            institution=ed.institution,
            location=ed.location,
            start_date=ed.start_date.isoformat() if ed.start_date else None,
            end_date=ed.end_date.isoformat() if ed.end_date else None,
            gpa=ed.gpa,
            coursework=ed.coursework,
        ) for ed in edu_res.scalars().all()]

        extra_res = await db.execute(
            select(UserExtracurricular).where(UserExtracurricular.user_id == current_user.id).order_by(UserExtracurricular.sort_order)
        )
        extracurriculars = [dict(
            title=ex.title,
            organization=ex.organization,
            description=ex.description,
            start_date=ex.start_date.isoformat() if ex.start_date else None,
            end_date=ex.end_date.isoformat() if ex.end_date else None,
            bullet_points=ex.bullet_points or [],
        ) for ex in extra_res.scalars().all()]

        template_manifest = TemplateRegistryService.get_template_manifest(gen.template_id)
        if not template_manifest:
            yield f"data: {json.dumps({'node': 'system', 'message': f'Template {gen.template_id} not found.', 'level': 'error'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        initial_state = ResumeGraphState(
            user_id=str(current_user.id),
            profile={
                "full_name": profile.full_name,
                "email": profile.email,
                "phone": profile.phone,
                "location": profile.location,
                "linkedin_url": profile.linkedin_url,
                "github_url": profile.github_url,
                "portfolio_url": profile.portfolio_url,
                "subtitle": profile.subtitle,
                "summary": profile.summary,
                "skills": profile.skills,
            },
            projects=projects,
            experiences=experiences,
            education=education,
            extracurriculars=extracurriculars,
            job_description=gen.job_description,
            keywords=gen.keywords or [],
            instructions=gen.instructions or "",
            template_manifest=template_manifest.model_dump(),
            job_analysis=None,
            summary_draft=None,
            projects_draft=None,
            experience_draft=None,
            tailored_resume=None,
            orphans=None,
            pdf_bytes=None,
            markdown=None,
            page_count=0,
            font_size=0.0,
            repair_attempts=0,
            render_attempts=0,
            content_reduction_step=0,
            errors=[],
            logs=[],
        )

        async def run_pipeline():
            try:
                async with AsyncSessionLocal() as pipeline_db:
                    graph = compile_graph()
                    result = await graph.ainvoke(
                        initial_state,
                        config={"configurable": {"db": pipeline_db, "gen_id": str(gen.id)}}
                    )

                async with AsyncSessionLocal() as update_db:
                    gen_res = await update_db.execute(
                        select(Generation).where(Generation.id == gen.id)
                    )
                    gen_obj = gen_res.scalar_one()

                    job_analysis = result.get("job_analysis") or {}
                    gen_obj.status = "completed"
                    gen_obj.job_title = job_analysis.get("job_title") or gen_obj.job_title
                    gen_obj.company = job_analysis.get("company") or gen_obj.company
                    gen_obj.pdf_storage_key = f"runs/{gen.id}/resume.pdf"
                    gen_obj.md_storage_key = f"runs/{gen.id}/resume.md"
                    gen_obj.thumb_storage_key = f"runs/{gen.id}/thumb.webp"
                    gen_obj.completed_at = datetime.now(timezone.utc)
                    gen_obj.render_metadata = {
                        "tailored_resume": result.get("tailored_resume"),
                        "font_size": result.get("font_size"),
                        "page_count": result.get("page_count"),
                    }
                    await update_db.commit()

                # Signal success status before sentinel
                await queue.put({"node": "system", "message": "completed", "level": "status"})
            except Exception as e:
                async with AsyncSessionLocal() as fail_db:
                    gen_res = await fail_db.execute(
                        select(Generation).where(Generation.id == gen.id)
                    )
                    gen_obj = gen_res.scalar_one_or_none()
                    if gen_obj:
                        gen_obj.status = "failed"
                        gen_obj.error_message = str(e)
                        await fail_db.commit()

                await log_progress(None, str(gen.id), "system", f"Pipeline error occurred: {e}", "error")
                await queue.put({"node": "system", "message": "failed", "level": "status"})
            finally:
                await queue.put(None)  # Sentinel — always unblock the SSE consumer

        # Close the request-scoped database session immediately so it doesn't hold a transaction open
        await db.close()

        # Start pipeline task (inherits context vars)
        asyncio.create_task(run_pipeline())

        # Yield logs as they arrive
        while True:
            item = await queue.get()
            if item is None:
                break
            yield f"data: {json.dumps(item)}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


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

    # Load profile details
    profile_res = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
    profile = profile_res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    template_manifest = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not template_manifest:
        raise HTTPException(status_code=500, detail="Template files missing.")

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

    pdf_bytes = HTML(string=html_rendered).write_pdf()
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

    # Delete R2 artifacts
    storage = StorageService()
    for key in [gen.pdf_storage_key, gen.md_storage_key, gen.thumb_storage_key]:
        if key:
            storage.delete_file(key)

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
        # Build a clean filename from job_title + company
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

    profile_res = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
    profile = profile_res.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    template_manifest = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not template_manifest:
        raise HTTPException(status_code=500, detail="Template files missing.")

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

    pdf_bytes = HTML(string=html_rendered).write_pdf()
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

