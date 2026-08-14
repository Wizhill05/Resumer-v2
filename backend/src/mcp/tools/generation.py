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
from src.core.storage import StorageService
from src.mcp.context import get_current_mcp_user, get_mcp_db
from src.mcp.tools.readiness import check_readiness_handler
from src.models.generation import Generation, GenerationLog
from src.models.profile import Profile, UserEducation, UserExperience, UserExtracurricular, UserProject
from src.template_registry.service import TemplateRegistryService

async def generate_resume_handler(
    job_description: str,
    template_id: str = "personal-classic",
    job_title: str | None = None,
    company: str | None = None,
    content_split: dict[str, int] | None = None,
    instructions: str | None = None,
    wait_for_completion: bool = True,
    timeout_seconds: int = 60,
    ctx: Any = None,
) -> dict[str, Any]:
    """Start resume generation pipeline tailored to a job description.

    By default, waits for the generation pipeline to complete (~15-25s) and directly returns
    the completed resume status, presigned PDF download URL, and metadata.
    """
    user = get_current_mcp_user()

    # 1. Validate template
    template = TemplateRegistryService.get_template_manifest(template_id)
    if not template:
        return {
            "success": False,
            "status": "error",
            "error_code": "TEMPLATE_NOT_FOUND",
            "message": f"Template '{template_id}' does not exist. Call list_templates for valid options.",
        }

    # 2. Check profile readiness before starting
    readiness = await check_readiness_handler(
        template_id=template_id,
        content_split=content_split,
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

    effective_split = content_split or template.default_content_split.model_dump()

    # 3. Create Generation record and trigger pipeline
    async with get_mcp_db() as db:
        await reap_stuck_generations(db)
        await check_rate_limit(user, db)

        gen = Generation(
            user_id=user.id,
            template_id=template_id,
            job_description=job_description,
            job_title=job_title,
            company=company,
            instructions=instructions,
            content_split=effective_split,
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
        download_url = None
        if latest_gen.pdf_storage_key:
            try:
                download_url = StorageService().generate_presigned_download_url(
                    key=latest_gen.pdf_storage_key,
                    filename=f"Resume_{latest_gen.company or 'Tailored'}.pdf",
                    expires_in=3600,
                )
            except Exception:
                download_url = None
        if not download_url:
            download_url = f"{settings.FRONTEND_URL}/history?gen={latest_gen.id}"
        return {
            "success": True,
            "generation_id": str(gen_id),
            "status": "completed",
            "template_id": template_id,
            "job_title": latest_gen.job_title,
            "company": latest_gen.company,
            "download_url": download_url,
            "page_count": (latest_gen.render_metadata or {}).get("page_count", 1),
            "fit_warning": (latest_gen.render_metadata or {}).get("fit_warning", False),
            "content_split": effective_split,
            "message": (
                f"Resume successfully generated for '{latest_gen.job_title or 'Target Role'}'! "
                f"Presigned PDF download URL: {download_url}"
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
    download_url = None
    if gen.status == "completed" and gen.pdf_storage_key:
        try:
            download_url = StorageService().generate_presigned_download_url(
                key=gen.pdf_storage_key,
                filename=f"Resume_{gen.company or 'Tailored'}.pdf",
                expires_in=3600,
            )
        except Exception:
            download_url = None
    if gen.status == "completed" and not download_url:
        download_url = f"{settings.FRONTEND_URL}/history?gen={gen.id}"
    return {
        "success": True,
        "generation_id": str(gen.id),
        "status": gen.status,
        "progress_percent": progress_percent,
        "error_message": gen.error_message,
        "download_url": download_url,
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


async def download_resume_handler(generation_id: str) -> dict[str, Any]:
    """Retrieve presigned PDF download URL for a completed resume generation."""
    user = get_current_mcp_user()
    gen_uuid = uuid.UUID(generation_id)

    async with get_mcp_db() as db:
        res = await db.execute(
            select(Generation).where(Generation.id == gen_uuid, Generation.user_id == user.id)
        )
        gen = res.scalar_one_or_none()
        if not gen:
            return {"success": False, "error": f"Generation '{generation_id}' not found."}

        if gen.status != "completed" or not gen.pdf_storage_key:
            return {
                "success": False,
                "status": gen.status,
                "error": "Resume is not ready for download. Check status using get_generation_status.",
            }

        download_url = None
        if gen.pdf_storage_key:
            try:
                download_url = StorageService().generate_presigned_download_url(
                    key=gen.pdf_storage_key,
                    filename=f"Resume_{gen.company or 'Tailored'}.pdf",
                    expires_in=3600,
                )
            except Exception:
                download_url = None

        if not download_url:
            download_url = f"{settings.FRONTEND_URL}/history?gen={gen.id}"

        return {
            "success": True,
            "generation_id": str(gen.id),
            "download_url": download_url,
            "storage_key": gen.pdf_storage_key,
            "message": f"Resume PDF download link: {download_url}",
        }
