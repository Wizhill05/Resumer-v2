import json
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
import uuid

from fastapi import APIRouter, Depends, HTTPException, status, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from jinja2 import Template

from src.core.auth import get_current_user
from src.core.database import get_db
from src.core.storage import StorageService
from src.models.generation import Generation, UserRateLimit, GenerationLog
from src.models.profile import Profile, UserProject, UserExperience, UserEducation
from src.models.user import User
from src.schemas.generation import GenerationCreate, GenerationOut
from src.pipeline.graph import compile_graph
from src.pipeline.nodes import sse_queue_var, log_progress
from src.template_registry.service import TemplateRegistryService

router = APIRouter(prefix="/generate", tags=["generation"])

MAX_DAILY_RUNS = 5


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
            yield "data: [DONE]\n\n"
            return

        # Initialize the SSE Queue and set context var
        queue = asyncio.Queue()
        token = sse_queue_var.set(queue)

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
                "summary": profile.summary,
                "skills": profile.skills,
            },
            projects=projects,
            experiences=experiences,
            education=education,
            job_description=gen.job_description,
            keywords=gen.keywords or [],
            instructions=gen.instructions or "",
            template_manifest=template_manifest.model_dump(),
            job_analysis=None,
            summary_draft=None,
            projects_draft=None,
            experience_draft=None,
            tailored_resume=None,
            pdf_bytes=None,
            markdown=None,
            page_count=0,
            font_size=0.0,
            repair_attempts=0,
            render_attempts=0,
            errors=[],
            logs=[],
        )

        async def run_pipeline():
            try:
                graph = compile_graph()
                result = await graph.ainvoke(
                    initial_state,
                    config={"configurable": {"db": db, "gen_id": str(gen.id)}}
                )

                # Store tailored resume and parameters in db metadata
                gen.status = "completed"
                gen.pdf_storage_key = f"runs/{gen.id}/resume.pdf"
                gen.md_storage_key = f"runs/{gen.id}/resume.md"
                gen.completed_at = datetime.now(timezone.utc)
                gen.render_metadata = {
                    "tailored_resume": result.get("tailored_resume"),
                    "font_size": result.get("font_size"),
                    "page_count": result.get("page_count"),
                }
                await db.commit()
            except Exception as e:
                await db.rollback()
                gen.status = "failed"
                gen.error_message = str(e)
                await db.commit()
                await log_progress(db, str(gen.id), "system", f"Pipeline error occurred: {e}", "error")
            finally:
                sse_queue_var.reset(token)
                await queue.put(None) # Sentinel

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

    # Try fetching from storage if configured
    storage = StorageService()
    if storage.enabled and gen.pdf_storage_key:
        presigned_url = storage.get_presigned_url(gen.pdf_storage_key)
        if presigned_url:
            from fastapi.responses import RedirectResponse
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
    html_template_str = TemplateRegistryService.get_template_html(gen.template_id)

    if not template_manifest or not html_template_str:
        raise HTTPException(status_code=500, detail="Template files missing.")

    jinja_template = Template(html_template_str)
    html_rendered = jinja_template.render(
        profile={
            "full_name": profile.full_name,
            "email": profile.email,
            "phone": profile.phone,
            "location": profile.location,
            "linkedin_url": profile.linkedin_url,
            "github_url": profile.github_url,
            "portfolio_url": profile.portfolio_url,
        },
        resume=tailored_resume,
        font_size=font_size or template_manifest.max_font_size,
        page_margin_mm=template_manifest.page_margin_mm,
    )

    try:
        from weasyprint import HTML
    except (OSError, ImportError) as e:
        raise HTTPException(
            status_code=500,
            detail=f"PDF rendering is not configured on this host (missing Pango/Cairo system libraries): {e}"
        )

    pdf_bytes = HTML(string=html_rendered).write_pdf()
    return Response(content=pdf_bytes, media_type="application/pdf")

