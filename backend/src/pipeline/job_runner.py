"""Cloud Run Job entrypoint + local in-process runner.

Runs a single generation to completion: loads state from DB, invokes the
LangGraph pipeline, persists artifact keys + metadata, and fires the
completion email. Independent of any HTTP request — survives the user
walking away from the page (Cloud Run Job allocates CPU for the full run).
"""
import asyncio
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import AsyncSessionLocal
from src.core.notify import send_completion_email
from src.models.generation import Generation
from src.models.profile import (
    Profile,
    UserEducation,
    UserExperience,
    UserExtracurricular,
    UserProject,
)
from src.models.user import User
from src.pipeline.graph import compile_graph
from src.pipeline.nodes import log_progress
from src.pipeline.state import ResumeGraphState
from src.template_registry.service import TemplateRegistryService


async def _load_initial_state(db: AsyncSession, gen: Generation) -> ResumeGraphState | None:
    profile_res = await db.execute(select(Profile).where(Profile.user_id == gen.user_id))
    profile = profile_res.scalar_one_or_none()
    if not profile:
        await log_progress(
            None, str(gen.id), "system",
            "Profile not found. Please complete basic onboarding.", "error",
        )
        return None

    projects_res = await db.execute(
        select(UserProject).where(UserProject.user_id == gen.user_id).order_by(UserProject.sort_order)
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
        select(UserExperience).where(UserExperience.user_id == gen.user_id).order_by(UserExperience.sort_order)
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
        select(UserEducation).where(UserEducation.user_id == gen.user_id).order_by(UserEducation.sort_order)
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
        select(UserExtracurricular).where(UserExtracurricular.user_id == gen.user_id).order_by(UserExtracurricular.sort_order)
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
        await log_progress(
            None, str(gen.id), "system",
            f"Template {gen.template_id} not found.", "error",
        )
        return None

    # Resolve content split: prefer stored value, fall back to template default.
    if gen.content_split:
        content_split = gen.content_split
    else:
        d = template_manifest.default_content_split
        content_split = {"projects": d.projects, "experience": d.experience}

    return ResumeGraphState(
        user_id=str(gen.user_id),
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
        content_split=content_split,
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
        pdf_storage_key=None,
        md_storage_key=None,
        thumb_storage_key=None,
        repair_attempts=0,
        render_attempts=0,
        content_reduction_step=0,
        errors=[],
        logs=[],
    )


async def _fetch_user_email(user_id) -> str | None:
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(User).where(User.id == user_id))
        user = res.scalar_one_or_none()
        return user.email if user else None


async def run_generation(gen_id: str) -> None:
    """Execute one generation to completion. Safe to call from a Job or in-process."""
    gen_uuid = uuid.UUID(gen_id)

    # 1. Fetch + claim the generation. Skip if already terminal.
    async with AsyncSessionLocal() as db:
        gen_res = await db.execute(select(Generation).where(Generation.id == gen_uuid))
        gen = gen_res.scalar_one_or_none()
        if not gen:
            print(f"[job_runner] generation {gen_id} not found")
            return
        if gen.status in ("completed", "failed"):
            print(f"[job_runner] generation {gen_id} already {gen.status}; skipping")
            return

        gen.status = "in_progress"
        await db.commit()

        initial_state = await _load_initial_state(db, gen)
        if initial_state is None:
            async with AsyncSessionLocal() as fail_db:
                g = await fail_db.get(Generation, gen_uuid)
                if g:
                    g.status = "failed"
                    g.error_message = "Profile not found; complete onboarding first."
                    await fail_db.commit()
                    email = await _fetch_user_email(gen.user_id)
                    send_completion_email(email, g)
            return

        # The generations row has no email; fetch the user's email for notifications.
        user_email = await _fetch_user_email(gen.user_id)

    # 2. Run the graph in its own session.
    try:
        async with AsyncSessionLocal() as pipeline_db:
            graph = compile_graph()
            result = await graph.ainvoke(
                initial_state,
                config={"configurable": {"db": pipeline_db, "gen_id": str(gen_uuid)}},
            )

        # 3. Persist terminal success.
        async with AsyncSessionLocal() as update_db:
            g = await update_db.get(Generation, gen_uuid)
            if g:
                job_analysis = result.get("job_analysis") or {}
                g.status = "completed"
                g.job_title = job_analysis.get("job_title") or g.job_title
                g.company = job_analysis.get("company") or g.company
                # Only persist keys for uploads that actually succeeded.
                g.pdf_storage_key = result.get("pdf_storage_key")
                g.md_storage_key = result.get("md_storage_key")
                g.thumb_storage_key = result.get("thumb_storage_key")
                g.completed_at = datetime.now(timezone.utc)
                g.render_metadata = {
                    "tailored_resume": result.get("tailored_resume"),
                    "font_size": result.get("font_size"),
                    "page_count": result.get("page_count"),
                }
                await update_db.commit()
                send_completion_email(user_email, g)
    except Exception as e:
        # 3b. Persist terminal failure.
        async with AsyncSessionLocal() as fail_db:
            g = await fail_db.get(Generation, gen_uuid)
            if g:
                g.status = "failed"
                g.error_message = str(e)
                await fail_db.commit()
                send_completion_email(user_email, g)
        await log_progress(None, gen_id, "system", f"Pipeline error: {e}", "error")
        raise


def main() -> None:
    """Container entrypoint for the Cloud Run Job. Reads GEN_ID from env."""
    import asyncio
    import os

    gen_id = os.environ.get("GEN_ID")
    if not gen_id:
        raise SystemExit("GEN_ID env var is required for the pipeline job")
    asyncio.run(run_generation(gen_id))


if __name__ == "__main__":
    main()
