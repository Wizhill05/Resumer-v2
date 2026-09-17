from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from src.api.generation import check_rate_limit, reap_stuck_generations
from src.core.config import settings
from src.core.executor import trigger_pipeline
from src.core.file_links import build_resume_file_link
from src.core.storage import StorageService
from src.mcp.context import get_current_mcp_user, get_mcp_db
from src.mcp.tools.readiness import check_readiness_handler
from src.models.generation import Generation, GenerationLog
from src.models.user import User
from src.models.profile import Profile, UserEducation, UserExperience, UserExtracurricular, UserProject
from src.services.content_split import (
    is_valid_mode,
    resolve_default_mode,
    resolve_default_split,
    save_user_split_preference,
    split_is_allowed,
)
from src.template_registry.service import TemplateRegistryService

async def generate_resume_handler(
    job_description: str,
    template_id: str = "personal-classic",
    job_title: str | None = None,
    company: str | None = None,
    content_split: dict[str, int] | None = None,
    instructions: str | None = None,
    creativity_mode: str | None = None,
    wait_for_completion: bool = True,
    timeout_seconds: int = 60,
    ctx: Any = None,
) -> dict[str, Any]:
    """Start resume generation pipeline tailored to a job description.

    By default, waits for the generation pipeline to complete (~15-25s) and directly returns
    the completed resume status, download URL, and complete structured resume_json.
    creativity_mode is per-run only ("proper" | "larp" | "super_larp"); omit it to use the
    user's stored default. Change the stored default with set_generation_defaults.
    """
    user = get_current_mcp_user()

    if creativity_mode is not None and not is_valid_mode(creativity_mode):
        return {
            "success": False,
            "status": "error",
            "error_code": "INVALID_CREATIVITY_MODE",
            "message": f"Invalid creativity_mode '{creativity_mode}'. Allowed: proper, larp, super_larp.",
        }
    effective_mode = creativity_mode or resolve_default_mode(user)

    # 1. Validate template
    template = TemplateRegistryService.get_template_manifest(template_id)
    if not template:
        return {
            "success": False,
            "status": "error",
            "error_code": "TEMPLATE_NOT_FOUND",
            "message": f"Template '{template_id}' does not exist. Call list_templates for valid options.",
        }

    # 2. Resolve the effective split (explicit choice → stored user preference → template default)
    explicit_split: dict[str, int] | None = None
    if content_split is not None:
        projects = content_split.get("projects")
        experience = content_split.get("experience")
        if (
            not isinstance(projects, int)
            or not isinstance(experience, int)
            or not split_is_allowed(projects, experience, template)
        ):
            allowed = [(s.projects, s.experience) for s in template.allowed_content_splits]
            return {
                "success": False,
                "status": "error",
                "error_code": "INVALID_CONTENT_SPLIT",
                "message": (
                    f"Invalid content_split ({projects}, {experience}) for template '{template_id}'. "
                    f"Allowed splits (projects, experience): {allowed}"
                ),
            }
        explicit_split = {"projects": projects, "experience": experience}
        effective_split = explicit_split
    else:
        default_split = resolve_default_split(user, template)
        effective_split = {"projects": default_split.projects, "experience": default_split.experience}

    # 3. Check profile readiness against the effective split before starting
    readiness = await check_readiness_handler(
        template_id=template_id,
        content_split=effective_split,
        job_description=job_description,
    )
    if not readiness["is_ready"]:
        return {
            "success": False,
            "status": "blocked",
            "error_code": "INSUFFICIENT_PROFILE_DATA",
            "message": "Cannot start resume generation: profile does not have enough data to satisfy template requirements.",
            "blocking_reasons": readiness["blocking_reasons"],
            "ai_steering": readiness["ai_steering"],
        }

    # 4. Create Generation record and trigger pipeline
    async with get_mcp_db() as db:
        await reap_stuck_generations(db)
        await check_rate_limit(user, db)

        if explicit_split is not None:
            await save_user_split_preference(
                db, user.id, explicit_split["projects"], explicit_split["experience"]
            )

        gen = Generation(
            user_id=user.id,
            template_id=template_id,
            job_description=job_description,
            job_title=job_title,
            company=company,
            instructions=instructions,
            content_split=effective_split,
            creativity_mode=effective_mode,
            status="pending",
            is_guest=False,
            send_email=False,
        )
        db.add(gen)
        await db.commit()
        await db.refresh(gen)
        gen_id = gen.id

    # 4. Trigger the generation pipeline
    await trigger_pipeline(str(gen_id))

    if not wait_for_completion:
        return {
            "success": True,
            "generation_id": str(gen_id),
            "status": "in_progress",
            "template_id": template_id,
            "content_split": effective_split,
            "creativity_mode": effective_mode,
            "estimated_duration_seconds": 20,
            "poll_tool": "get_generation_status",
            "message": (
                "Resume generation started in background. "
                f"Call get_generation_status(generation_id='{gen_id}', wait_for_completion=True) to monitor progress and receive the final PDF URL."
            ),
        }

    # 5. Wait for pipeline completion
    start_time = asyncio.get_event_loop().time()
    poll_interval = 1.0
    latest_gen: Generation | None = None
    total_expected_nodes = 8

    while (asyncio.get_event_loop().time() - start_time) < timeout_seconds:
        async with get_mcp_db() as db:
            res = await db.execute(
                select(Generation).where(Generation.id == gen_id, Generation.user_id == user.id)
            )
            latest_gen = res.scalar_one_or_none()

            log_res = await db.execute(
                select(GenerationLog)
                .where(GenerationLog.generation_id == gen_id)
                .order_by(GenerationLog.timestamp.desc())
            )
            logs = log_res.scalars().all()

        if latest_gen and latest_gen.status in ("completed", "failed"):
            break

        if ctx and logs:
            completed_nodes = {log.node_name for log in logs}
            node_calc = int((len(completed_nodes) / total_expected_nodes) * 100)
            progress_pct = max(10, min(95, node_calc))
            latest_msg = logs[0].message if logs else "Processing resume pipeline..."
            try:
                await ctx.report_progress(progress_pct, 100, message=latest_msg)
            except Exception:
                pass

        await asyncio.sleep(poll_interval)
    if not latest_gen:
        return {
            "success": False,
            "status": "error",
            "error_code": "GENERATION_NOT_FOUND",
            "message": f"Generation '{gen_id}' could not be reloaded from database.",
        }

    if latest_gen.status == "completed":
        render_meta = latest_gen.render_metadata or {}
        tailored_resume = render_meta.get("tailored_resume")
        download_url = build_resume_file_link(latest_gen.id)
        role_title = latest_gen.job_title or "Target Role"
        company_name = latest_gen.company or ""
        label = f"{company_name} {role_title}".strip() + " Resume (PDF)"
        return {
            "success": True,
            "generation_id": str(gen_id),
            "status": "completed",
            "template_id": template_id,
            "job_title": latest_gen.job_title,
            "company": latest_gen.company,
            "download_url": download_url,
            "page_count": render_meta.get("page_count", 1),
            "fit_warning": render_meta.get("fit_warning", False),
            "font_size": render_meta.get("font_size"),
            "editor_revision": render_meta.get("editor_revision", 0),
            "resume_json": tailored_resume,
            "content_split": effective_split,
            "creativity_mode": effective_mode,
            "message": (
                f"Resume successfully generated for '{role_title}'! "
                f"Download link: [{label}]({download_url})"
            ),
        }

    if latest_gen.status == "failed":
        return {
            "success": False,
            "generation_id": str(gen_id),
            "status": "failed",
            "error_message": latest_gen.error_message or "Resume generation pipeline failed.",
            "message": f"Resume generation failed: {latest_gen.error_message}",
        }

    # Timed out while still in progress
    return {
        "success": True,
        "generation_id": str(gen_id),
        "status": latest_gen.status,
        "template_id": template_id,
        "content_split": effective_split,
        "creativity_mode": effective_mode,
        "poll_tool": "get_generation_status",
        "message": (
            f"Resume generation is still processing in background (elapsed {timeout_seconds}s). "
            f"Call get_generation_status(generation_id='{gen_id}', wait_for_completion=True) to wait for the final PDF URL."
        ),
    }


async def get_generation_status_handler(
    generation_id: str,
    wait_for_completion: bool = True,
    timeout_seconds: int = 45,
) -> dict[str, Any]:
    """Check progress, logs, and results of a resume generation run."""
    user = get_current_mcp_user()
    gen_uuid = uuid.UUID(generation_id)

    start_time = asyncio.get_event_loop().time()
    poll_interval = 1.0
    gen: Generation | None = None
    logs: list[GenerationLog] = []

    while True:
        async with get_mcp_db() as db:
            res = await db.execute(
                select(Generation).where(Generation.id == gen_uuid, Generation.user_id == user.id)
            )
            gen = res.scalar_one_or_none()
            if not gen:
                return {"success": False, "error": f"Generation '{generation_id}' not found."}

            # Fetch step logs
            log_res = await db.execute(
                select(GenerationLog)
                .where(GenerationLog.generation_id == gen_uuid)
                .order_by(GenerationLog.timestamp.asc())
            )
            logs = log_res.scalars().all()

        if not wait_for_completion:
            break

        if gen.status in ("completed", "failed"):
            break

        if (asyncio.get_event_loop().time() - start_time) >= timeout_seconds:
            break

        await asyncio.sleep(poll_interval)
    completed_nodes = {log.node_name for log in logs}
    total_expected_nodes = 8
    if gen.status == "completed":
        progress_percent = 100
    elif gen.status == "failed":
        progress_percent = 0
    elif gen.status == "in_progress":
        node_calc = int((len(completed_nodes) / total_expected_nodes) * 100)
        progress_percent = max(15, min(95, node_calc))
    else:  # pending
        progress_percent = 5
    render_meta = gen.render_metadata or {}
    tailored_resume = render_meta.get("tailored_resume") if gen.status == "completed" else None
    download_url = build_resume_file_link(gen.id) if gen.status == "completed" else None
    role_title = gen.job_title or "Target Role"
    company_name = gen.company or ""
    label = f"{company_name} {role_title}".strip() + " Resume (PDF)"

    response_data: dict[str, Any] = {
        "success": True,
        "generation_id": str(gen.id),
        "status": gen.status,
        "progress_percent": progress_percent,
        "error_message": gen.error_message,
        "download_url": download_url,
        "page_count": render_meta.get("page_count", 1) if gen.status == "completed" else None,
        "fit_warning": render_meta.get("fit_warning", False) if gen.status == "completed" else None,
        "font_size": render_meta.get("font_size") if gen.status == "completed" else None,
        "editor_revision": render_meta.get("editor_revision", 0) if gen.status == "completed" else None,
        "resume_json": tailored_resume,
        "render_metadata": gen.render_metadata,
        "recent_logs": [
            {
                "node": l.node_name,
                "message": l.message,
                "timestamp": l.timestamp.isoformat() if l.timestamp else None,
            }
            for l in logs[-10:]
        ],
    }
    if gen.status == "completed" and download_url:
        response_data["message"] = f"Resume generation completed for '{role_title}'! Download link: [{label}]({download_url})"
    return response_data

async def download_resume_handler(generation_id: str) -> dict[str, Any]:
    """Retrieve PDF download URL and resume JSON for a completed resume generation."""
    user = get_current_mcp_user()
    gen_uuid = uuid.UUID(generation_id)

    async with get_mcp_db() as db:
        res = await db.execute(
            select(Generation).where(Generation.id == gen_uuid, Generation.user_id == user.id)
        )
        gen = res.scalar_one_or_none()
        if not gen:
            return {"success": False, "error": f"Generation '{generation_id}' not found."}

        if gen.status != "completed":
            return {
                "success": False,
                "status": gen.status,
                "error": "Resume is not ready for download. Check status using get_generation_status.",
            }

        render_meta = gen.render_metadata or {}
        download_url = build_resume_file_link(gen.id)
        role_title = gen.job_title or "Target Role"
        company_name = gen.company or ""
        label = f"{company_name} {role_title}".strip() + " Resume (PDF)"

        return {
            "success": True,
            "generation_id": str(gen.id),
            "download_url": download_url,
            "editor_revision": render_meta.get("editor_revision", 0),
            "page_count": render_meta.get("page_count", 1),
            "font_size": render_meta.get("font_size"),
            "fit_warning": render_meta.get("fit_warning", False),
            "resume_json": render_meta.get("tailored_resume"),
            "message": f"Resume PDF download link: [{label}]({download_url})",
        }


async def set_generation_defaults_handler(
    creativity_mode: str | None = None,
    projects: int | None = None,
    experience: int | None = None,
) -> dict[str, Any]:
    """Get or change the user's stored generation defaults.

    Omit all arguments to read the current defaults. Pass any argument to update it.
    creativity_mode must be proper, larp, or super_larp. projects/experience are the
    default content counts (0-5 each); they apply when valid for the chosen template.
    """
    user = get_current_mcp_user()
    if creativity_mode is not None and not is_valid_mode(creativity_mode):
        return {
            "success": False,
            "error": f"Invalid creativity_mode '{creativity_mode}'. Allowed: proper, larp, super_larp.",
        }
    for label, value in (("projects", projects), ("experience", experience)):
        if value is not None and not (isinstance(value, int) and 0 <= value <= 5):
            return {"success": False, "error": f"Invalid {label} '{value}'. Allowed range: 0-5."}

    async with get_mcp_db() as db:
        res = await db.execute(select(User).where(User.id == user.id))
        db_user = res.scalar_one_or_none()
        if not db_user:
            return {"success": False, "error": "User not found."}
        if creativity_mode is not None:
            db_user.preferred_creativity_mode = creativity_mode
        if projects is not None:
            db_user.preferred_projects = projects
        if experience is not None:
            db_user.preferred_experience = experience
        await db.commit()
        await db.refresh(db_user)
        defaults = {
            "creativity_mode": resolve_default_mode(db_user),
            "preferred_projects": db_user.preferred_projects,
            "preferred_experience": db_user.preferred_experience,
        }
    return {"success": True, "defaults": defaults}
