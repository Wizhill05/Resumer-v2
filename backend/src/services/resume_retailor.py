from __future__ import annotations

import copy
import io
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from langchain_core.prompts import ChatPromptTemplate

from src.core.database import AsyncSessionLocal
from src.core.storage import StorageService
from src.models.generation import Generation
from src.models.profile import UserProject
from src.pipeline.nodes import (
    _structured,
    get_prompt_config,
    invoke_with_fallback,
    log_progress,
    orphan_repair_node,
)
from src.schemas.pipeline import TailoredProjectBatch
from src.services.resume_render import (
    build_resume_markdown,
    detect_resume_orphans,
    fit_and_render_pdf,
)
from src.template_registry.service import TemplateRegistryService

logger = logging.getLogger("resumer.retailor")


async def _safe_log_progress(
    db: AsyncSession, gen_id: str, node_name: str, message: str, level: str = "info"
):
    try:
        await log_progress(db, gen_id, node_name, message, level=level)
    except Exception as e:
        logger.info(f"[{node_name}] {message} (db log skipped: {e})")


async def retailor_resume_with_project(
    *,
    db: AsyncSession,
    gen: Generation,
    target_project_index: int,
    new_project: UserProject,
    current_resume: dict[str, Any],
    profile_data: dict[str, Any],
) -> dict[str, Any]:
    """Replace project at target_project_index, re-tailor projects, and run orphan repair."""
    gen_id_str = str(gen.id)
    projects = list(current_resume.get("projects") or [])
    if target_project_index < 0 or target_project_index >= len(projects):
        raise ValueError(
            f"Invalid target_project_index {target_project_index}. "
            f"Current resume has {len(projects)} projects."
        )

    await _safe_log_progress(
        db,
        gen_id_str,
        "replace_project",
        f"Replacing project #{target_project_index + 1} with '{new_project.name}'...",
    )

    # 1. Construct raw candidate project data
    raw_replacement = {
        "name": new_project.name,
        "description": new_project.description or "",
        "technologies": new_project.technologies or [],
        "bullet_points": new_project.bullet_points or [],
        "github_url": new_project.github_url,
        "live_url": new_project.live_url,
        "start_date": new_project.start_date.isoformat() if new_project.start_date else None,
        "end_date": new_project.end_date.isoformat() if new_project.end_date else None,
    }

    # Prepare batch of projects for re-tailoring
    batch_raw = []
    for idx, p in enumerate(projects):
        if idx == target_project_index:
            batch_raw.append(raw_replacement)
        else:
            batch_raw.append(copy.deepcopy(p))

    # 2. Get Job Analysis from render_metadata or build summary
    metadata = gen.render_metadata or {}
    job_analysis = metadata.get("job_analysis")
    if not job_analysis:
        job_analysis = {
            "job_title": gen.job_title or "Target Role",
            "company": gen.company or "Target Company",
            "key_requirements": [gen.job_description[:500]],
            "extracted_skills": gen.keywords or [],
        }

    # 3. Format entries for LLM tailoring
    entries_text = ""
    for i, proj in enumerate(batch_raw, start=1):
        entries_text += (
            f"\n--- Project {i} ---\n"
            f"Name: {proj['name']}\n"
            f"Description: {proj.get('description') or ''}\n"
            f"Technologies: {', '.join(proj.get('technologies') or [])}\n"
            f"Bullet Points:\n" + "\n".join(proj.get("bullet_points") or []) + "\n"
        )

    manifest_obj = TemplateRegistryService.get_template_manifest(gen.template_id)
    max_bullets = manifest_obj.max_bullets_per_project if manifest_obj else 3

    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        "projects_writer",
        default_system=(
            "ROLE: Senior technical resume writer specializing in project sections.\n"
            "TASK: Rewrite selected project entries so they map clearly to target job requirements.\n"
            "OUTPUT CONTRACT: Return only the structured TailoredProjectBatch object with entries. Return EXACTLY {batch_len} entries in input order.\n"
            "RULES:\n"
            "- Preserve project name unless spelling cleanup is needed.\n"
            "- project_summary: 2-4 words describing the project category, e.g. 'API Automation Platform'.\n"
            "- description: one concise sentence explaining what the project does and why it matters.\n"
            "- technologies: normalized list of technologies from input plus clearly supported technologies only.\n"
            "- bullet_points: 2-3 concise achievement bullets, each starting with a strong action verb.\n"
            "- Emphasize architecture, implementation depth, job-relevant tools, measurable performance, users, scale, or impact when supported.\n"
            "- Do not invent metrics, deployments, users, awards, or technologies not supported by input.\n"
            "- Bold every number, statistic, percentage, metric, and key technology with markdown asterisks.\n"
            "- Line-fit: each bullet should fit on one line or fill 1.75-1.95 rendered lines. Avoid short orphan second lines.\n"
            "- No prose outside the structured output."
        ),
        default_user=(
            "INPUT: Job Analysis\n{job_analysis}\n\n"
            "INPUT: Project Entries To Rewrite\n{entries}"
        ),
    )

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", sys_prompt.format(batch_len=len(batch_raw))),
            ("user", usr_prompt),
        ]
    )

    # Re-tailor projects via LLM
    result = await invoke_with_fallback(
        lambda llm, p: prompt | _structured(llm, TailoredProjectBatch, p),
        {"job_analysis": str(job_analysis), "entries": entries_text},
        node_name="projects_writer",
        gen_id=gen_id_str,
        is_pro=False,
    )

    tailored_projs = []
    for i, tailored in enumerate(result.entries[: len(batch_raw)]):
        original = batch_raw[i]
        tailored_projs.append(
            {
                "name": tailored.name,
                "project_summary": tailored.project_summary,
                "description": tailored.description,
                "technologies": tailored.technologies,
                "bullet_points": tailored.bullet_points[:max_bullets],
                "github_url": original.get("github_url"),
                "live_url": original.get("live_url"),
                "start_date": original.get("start_date"),
                "end_date": original.get("end_date"),
            }
        )

    # 4. Create new resume JSON with updated projects
    updated_resume = copy.deepcopy(current_resume)
    updated_resume["projects"] = tailored_projs

    # 5. Run orphan detection pass
    first_detect = detect_resume_orphans(
        template_id=gen.template_id,
        profile=profile_data,
        resume=updated_resume,
    )

    initial_orphans = first_detect.get("orphans") or []
    orphans_detected_count = len(initial_orphans)
    orphans_repaired_count = 0

    final_font_size = first_detect.get("font_size")
    final_page_count = first_detect.get("page_count")
    final_fit_warning = not first_detect.get("fits_target", True)

    # 6. Orphan repair loop if orphans were detected
    if initial_orphans:
        await _safe_log_progress(
            db,
            gen_id_str,
            "orphan_repair",
            f"Detected {orphans_detected_count} orphan line(s). Running repair pass...",
        )
        repair_state: dict[str, Any] = {
            "projects_draft": updated_resume.get("projects") or [],
            "experience_draft": updated_resume.get("experiences") or [],
            "extracurriculars_draft": updated_resume.get("extracurriculars") or [],
            "keywords": gen.keywords or [],
            "orphans": initial_orphans,
            "repair_attempts": 0,
            "repair_history": {},
        }

        repair_result = await orphan_repair_node(repair_state, db, gen_id_str)
        if repair_result:
            if "projects_draft" in repair_result:
                updated_resume["projects"] = repair_result["projects_draft"]
            if "experience_draft" in repair_result:
                updated_resume["experiences"] = repair_result["experience_draft"]
            if "extracurriculars_draft" in repair_result:
                updated_resume["extracurriculars"] = repair_result["extracurriculars_draft"]

            # Re-evaluate orphans after repair
            second_detect = detect_resume_orphans(
                template_id=gen.template_id,
                profile=profile_data,
                resume=updated_resume,
            )
            remaining_orphans = second_detect.get("orphans") or []
            orphans_repaired_count = max(0, orphans_detected_count - len(remaining_orphans))
            final_font_size = second_detect.get("font_size")
            final_page_count = second_detect.get("page_count")
            final_fit_warning = not second_detect.get("fits_target", True)

    await _safe_log_progress(
        db,
        gen_id_str,
        "replace_project",
        f"Project replacement complete. Orphans repaired: {orphans_repaired_count}/{orphans_detected_count}.",
    )

    return {
        "tailored_resume": updated_resume,
        "orphans_detected": orphans_detected_count,
        "orphans_repaired": orphans_repaired_count,
        "font_size": final_font_size,
        "page_count": final_page_count,
        "fit_warning": final_fit_warning,
    }


async def run_background_replace_project(
    *,
    gen_id: str,
    target_project_index: int,
    profile_project_id: UUID,
    current_resume: dict[str, Any],
    profile_data: dict[str, Any],
    user_id: UUID,
) -> None:
    """Detached background task to re-tailor projects, render PDF, and update generation state."""
    async with AsyncSessionLocal() as session:
        try:
            gen_res = await session.execute(
                select(Generation).where(
                    Generation.id == UUID(gen_id), Generation.user_id == user_id
                )
            )
            gen = gen_res.scalar_one_or_none()
            if not gen:
                logger.error(f"[background_replace] Generation {gen_id} not found.")
                return

            proj_res = await session.execute(
                select(UserProject).where(
                    UserProject.id == profile_project_id, UserProject.user_id == user_id
                )
            )
            user_project = proj_res.scalar_one_or_none()
            if not user_project:
                logger.error(f"[background_replace] UserProject {profile_project_id} not found.")
                gen.status = "failed"
                await session.commit()
                return

            await _safe_log_progress(
                session, gen_id, "replace_project_start", "Preparing project replacement..."
            )

            # 1. Re-tailor project & run orphan repair
            retailor_result = await retailor_resume_with_project(
                db=session,
                gen=gen,
                target_project_index=target_project_index,
                new_project=user_project,
                current_resume=current_resume,
                profile_data=profile_data,
            )

            tailored_resume = retailor_result["tailored_resume"]

            # 2. Render PDF & Thumbnail
            await _safe_log_progress(
                session, gen_id, "render_pdf", "Rendering updated PDF and thumbnail..."
            )

            manifest_obj = TemplateRegistryService.get_template_manifest(gen.template_id)
            if not manifest_obj:
                raise ValueError(f"Template '{gen.template_id}' manifest missing.")

            pdf_bytes, fit_res = fit_and_render_pdf(
                template_id=gen.template_id,
                profile=profile_data,
                resume=tailored_resume,
                manifest=manifest_obj.model_dump(),
            )

            md_text = build_resume_markdown(profile=profile_data, resume=tailored_resume)

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
                logger.warning(f"Thumbnail generation failed: {thumb_err}")

            # 3. Upload to R2
            pdf_key = f"runs/{gen_id}/resume.pdf"
            md_key = f"runs/{gen_id}/resume.md"
            thumb_key = f"runs/{gen_id}/thumb.webp"

            storage = StorageService()
            storage.upload_bytes(pdf_bytes, pdf_key, "application/pdf")
            if md_text:
                storage.upload_bytes(md_text.encode("utf-8"), md_key, "text/markdown")
            if thumb_bytes:
                storage.upload_bytes(thumb_bytes, thumb_key, "image/webp")

            # 4. Save metadata and status
            metadata = dict(gen.render_metadata or {})
            rev = metadata.get("editor_revision", 0) + 1
            metadata["tailored_resume"] = tailored_resume
            metadata["profile"] = profile_data
            metadata["font_size"] = fit_res.font_size
            metadata["page_count"] = fit_res.page_count
            metadata["fit_warning"] = not fit_res.fits_target
            metadata["editor_revision"] = rev
            metadata["edited_at"] = datetime.now(timezone.utc).isoformat()

            gen.render_metadata = metadata
            gen.pdf_storage_key = pdf_key
            gen.md_storage_key = md_key
            if thumb_bytes:
                gen.thumb_storage_key = thumb_key
            gen.status = "completed"
            gen.completed_at = datetime.now(timezone.utc)

            await session.commit()

            await _safe_log_progress(
                session, gen_id, "saver", "Resume remade and PDF saved successfully."
            )
            await _safe_log_progress(
                session, gen_id, "completed", "completed", level="status"
            )

        except Exception as e:
            logger.error(f"[background_replace] Error remaking project for {gen_id}: {e}", exc_info=True)
            try:
                gen_res = await session.execute(
                    select(Generation).where(Generation.id == UUID(gen_id))
                )
                gen = gen_res.scalar_one_or_none()
                if gen:
                    gen.status = "failed"
                    gen.error_message = str(e)
                    await session.commit()
                await _safe_log_progress(
                    session, gen_id, "failed", f"Failed: {str(e)}", level="status"
                )
            except Exception as commit_err:
                logger.error(f"Failed to record failure status: {commit_err}")

