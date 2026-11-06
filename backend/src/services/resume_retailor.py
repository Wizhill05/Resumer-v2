from __future__ import annotations

import copy
import logging
import re
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
    InferenceExhausted,
    InvalidStructuredOutput,
    _professional_sans_policy,
    _prompt_name,
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
        logger.warning(f"Could not log progress for {gen_id}: {e}")


async def retailor_resume_with_project(
    *,
    db: AsyncSession,
    gen: Generation,
    target_project_index: int,
    new_project: UserProject,
    current_resume: dict[str, Any],
    profile_data: dict[str, Any],
) -> dict[str, Any]:
    """Re-tailor single selected project and preserve untouched projects exactly.

    Preserves untouched projects completely (including manual third bullets),
    restricts LLM rewrite and bullet capping to the targeted project,
    handles exhausted retries non-destructively, and runs orphan line repair.
    """
    gen_id_str = str(gen.id)
    projects = current_resume.get("projects") or []
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

    # 1. Construct raw replacement project data
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

    # 3. Format entry for LLM tailoring — only the targeted replacement project!
    entries_text = (
        f"\n--- Project 1 ---\n"
        f"Name: {raw_replacement['name']}\n"
        f"Description: {raw_replacement.get('description') or ''}\n"
        f"Technologies: {', '.join(raw_replacement.get('technologies') or [])}\n"
        f"Bullet Points:\n" + "\n".join(raw_replacement.get("bullet_points") or []) + "\n"
    )

    manifest_obj = TemplateRegistryService.get_template_manifest(gen.template_id)
    max_bullets = manifest_obj.max_bullets_per_project if manifest_obj else 3
    manifest_data = manifest_obj.model_dump() if manifest_obj else {}

    mode = getattr(gen, "creativity_mode", None) or "proper"
    if mode == "proper":
        tech_rule = "- technologies: normalized list of technologies from input plus clearly supported technologies only."
        depth_rule = "- Emphasize architecture, implementation depth, job-relevant tools, measurable performance, users, scale, or impact when supported."
        invent_rule = "- Do not invent metrics, deployments, users, awards, or technologies not supported by input."
    else:
        tech_rule = "- technologies: normalized list that MUST foreground the job's required stack; add missing JD technologies even if absent from input."
        depth_rule = (
            "- Emphasize architecture, implementation depth, job-relevant tools, measurable performance, users, scale, or impact. "
            "Vary phrasing per job so outputs do not look templated."
        )
        invent_rule = (
            "- LARP MODE: you may add plausible JD-aligned features, integrations, and metrics to the existing project "
            "(e.g. claim the missing feature because it fits the job). Never invent a wholly new project here — "
            "that is reserved for Super LARP slot 1 — but do not be afraid to stretch details."
        )

    sys_prompt, usr_prompt = await get_prompt_config(
        db,
        _prompt_name("projects_writer", mode),
        default_system=(
            "ROLE: Senior technical resume writer specializing in project sections.\n"
            "TASK: Rewrite selected project entries so they map clearly to target job requirements.\n"
            "OUTPUT CONTRACT: Return only the structured TailoredProjectBatch object with entries. Return EXACTLY {batch_len} entries in input order.\n"
            "RULES:\n"
            "- Preserve project name unless spelling cleanup is needed.\n"
            "- project_summary: 2-4 words describing the project category, e.g. 'API Automation Platform'.\n"
            "- description: one concise sentence explaining what the project does and why it matters.\n"
            f"{tech_rule}\n"
            "- bullet_points: 2-3 concise achievement bullets (hard limit: never more than 3), each starting with a strong action verb.\n"
            f"{depth_rule}\n"
            f"{invent_rule}\n"
            "- Bold every number, statistic, percentage, metric, and key technology with markdown asterisks.\n"
            "- Line-fit: craft each bullet to either comfortably fit on a single line or completely fill two lines. Avoid short orphan second lines.\n"
            "- No prose outside the structured output."
        ),
        default_user=(
            "INPUT: Job Analysis\n{job_analysis}\n\n"
            "INPUT: Project Entries To Rewrite\n{entries}"
        ),
    )
    sys_prompt += _professional_sans_policy({"template_id": gen.template_id, "creativity_mode": mode}, "project")

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", sys_prompt.format(batch_len=1)),
            ("user", usr_prompt),
        ]
    )

    def _validate_retailor_batch(res: Any):
        entries = getattr(res, "entries", None)
        if not entries or len(entries) < 1:
            raise InvalidStructuredOutput(
                f"Expected at least 1 project entry in batch response, got {len(entries) if entries else 0}"
            )
        raw_bullets = [str(b).strip() for b in raw_replacement.get("bullet_points") or [] if b and str(b).strip()]
        has_evidence = bool(raw_bullets) or bool((raw_replacement.get("description") or "").strip())
        if has_evidence:
            raw_retained = getattr(entries[0], "bullet_points", [])[:max_bullets]
            retained_bullets = [str(b).strip() for b in raw_retained]
            if not retained_bullets or any(not b for b in retained_bullets):
                raise InvalidStructuredOutput(
                    "Replacement project entry has empty/blank retained bullets despite source having evidence."
                )

    fallback_used = False
    # Re-tailor replacement project via LLM with fallback on exhausted retries
    try:
        result = await invoke_with_fallback(
            lambda llm, p: prompt | _structured(llm, TailoredProjectBatch, p),
            {"job_analysis": str(job_analysis), "entries": entries_text},
            node_name="projects_writer",
            gen_id=gen_id_str,
            is_pro=False,
            validate_result=_validate_retailor_batch,
        )
        tailored = result.entries[0]
        clean_retained = [str(b).strip() for b in tailored.bullet_points[:max_bullets] if b and str(b).strip()]
        tailored_replacement = {
            "name": raw_replacement.get("name") or tailored.name,
            "project_summary": tailored.project_summary or raw_replacement.get("project_summary"),
            "description": tailored.description or raw_replacement.get("description"),
            "technologies": tailored.technologies or raw_replacement.get("technologies", []),
            "bullet_points": clean_retained,
            "github_url": raw_replacement.get("github_url"),
            "live_url": raw_replacement.get("live_url"),
            "start_date": raw_replacement.get("start_date"),
            "end_date": raw_replacement.get("end_date"),
        }
    except (InferenceExhausted, InvalidStructuredOutput, Exception) as exc:
        fallback_used = True
        raw_source_bullets = [str(b).strip() for b in raw_replacement.get("bullet_points") or [] if b and str(b).strip()]
        fallback_bullets = raw_source_bullets if raw_source_bullets else []
        await _safe_log_progress(
            db,
            gen_id_str,
            "projects_writer",
            f"Project tailoring failed ({exc}); falling back non-destructively to source replacement project data with all {len(fallback_bullets)} bullets preserved.",
            "warning",
        )
        tailored_replacement = {
            "name": raw_replacement.get("name") or "Project",
            "project_summary": raw_replacement.get("project_summary") or "",
            "description": raw_replacement.get("description") or "",
            "technologies": raw_replacement.get("technologies") or [],
            "bullet_points": fallback_bullets,  # Preserve complete fallback content; do not silently trim!
            "github_url": raw_replacement.get("github_url"),
            "live_url": raw_replacement.get("live_url"),
            "start_date": raw_replacement.get("start_date"),
            "end_date": raw_replacement.get("end_date"),
            "_is_fallback": True,
        }

    # 4. Create new resume JSON with updated projects: preserve untouched projects exactly!
    updated_resume = copy.deepcopy(current_resume)
    updated_projects = copy.deepcopy(projects)
    if 0 <= target_project_index < len(updated_projects):
        updated_projects[target_project_index] = tailored_replacement
    else:
        updated_projects.append(tailored_replacement)
    updated_resume["projects"] = updated_projects

    from src.services.template_layout import get_generation_section_order
    section_order = get_generation_section_order(gen.section_order, gen.template_id)

    # 5. Detect initial orphans on candidate updated resume
    first_detect = detect_resume_orphans(
        template_id=gen.template_id,
        profile=profile_data,
        resume=updated_resume,
        manifest=manifest_data,
        section_order=section_order,
    )
    initial_orphans = first_detect.get("orphans") or []
    orphans_detected_count = len(initial_orphans)
    orphans_repaired_count = 0

    final_font_size = first_detect.get("font_size")
    final_page_count = first_detect.get("page_count")
    final_has_h_overflow = bool(first_detect.get("has_horizontal_overflow"))
    final_fit_warning = (not first_detect.get("fits_target", True)) or final_has_h_overflow

    # 6. Orphan repair loop: strictly restrict repair to the new target project!
    def _clean_text(s: str) -> str:
        s = re.sub(r"[*_`]", "", s)
        return re.sub(r"\s+", " ", s).strip()

    target_bullets = {
        _clean_text(b)
        for b in tailored_replacement.get("bullet_points") or []
    }
    target_bullet_list = [
        _clean_text(b) for b in tailored_replacement.get("bullet_points") or []
    ]

    target_orphans: list[dict[str, Any]] = []
    for o in initial_orphans:
        o_sec = o.get("section")
        o_entry = o.get("entry_idx")
        if o_sec is not None and o_entry is not None:
            if o_sec in ("projects", "project") and o_entry == target_project_index:
                target_orphans.append(o)
        elif o_sec in ("projects", "project", None) and _clean_text(o.get("text", "")) in target_bullets:
            target_orphans.append(o)

    orphaned_target_indices: set[int] = set()
    for o in target_orphans:
        if o.get("bullet_idx") is not None:
            orphaned_target_indices.add(o["bullet_idx"])
    for idx, b_text in enumerate(target_bullet_list):
        if any(_clean_text(o.get("text", "")) == b_text for o in target_orphans):
            orphaned_target_indices.add(idx)

    if target_orphans:
        await _safe_log_progress(
            db,
            gen_id_str,
            "orphan_repair",
            f"Detected {len(target_orphans)} orphan line(s) in replacement project. Running targeted repair pass...",
        )
        repair_state: dict[str, Any] = {
            "projects_draft": copy.deepcopy(updated_resume.get("projects") or []),
            "experience_draft": copy.deepcopy(updated_resume.get("experiences") or []),
            "extracurriculars_draft": copy.deepcopy(updated_resume.get("extracurriculars") or []),
            "keywords": gen.keywords or [],
            "orphans": target_orphans,
            "repair_attempts": 0,
            "repair_history": {},
            "section_order": section_order,
            "template_manifest": manifest_data,
            "template_id": gen.template_id,
            "profile": profile_data,
            "tailored_resume": copy.deepcopy(updated_resume),
            "font_size": final_font_size,
            "page_count": final_page_count,
            "creativity_mode": mode,
        }

        repair_result = await orphan_repair_node(repair_state, db, gen_id_str)
        if repair_result:
            # Only update the targeted project from repair_result; preserve everything else exactly!
            repaired_projs = repair_result.get("projects_draft")
            if repaired_projs and 0 <= target_project_index < len(repaired_projs):
                updated_resume["projects"][target_project_index] = repaired_projs[target_project_index]

            # Re-assert exact preservation of all untouched projects, experiences, extracurriculars
            for idx, orig_proj in enumerate(projects):
                if idx != target_project_index and idx < len(updated_resume["projects"]):
                    updated_resume["projects"][idx] = copy.deepcopy(orig_proj)
            updated_resume["experiences"] = copy.deepcopy(current_resume.get("experiences") or [])
            updated_resume["extracurriculars"] = copy.deepcopy(current_resume.get("extracurriculars") or [])

            # Re-evaluate orphans after repair
            second_detect = detect_resume_orphans(
                template_id=gen.template_id,
                profile=profile_data,
                resume=updated_resume,
                manifest=manifest_data,
                section_order=section_order,
            )
            remaining_orphans = second_detect.get("orphans") or []

            # Current text of target project bullets after repair
            curr_target_projs = updated_resume.get("projects") or []
            curr_target_bullets: list[str] = []
            if 0 <= target_project_index < len(curr_target_projs):
                curr_target_bullets = [
                    _clean_text(b)
                    for b in curr_target_projs[target_project_index].get("bullet_points") or []
                ]
            curr_target_bullet_set = set(curr_target_bullets)

            # Determine remaining target findings by matching against stable section & entry, or current bullets
            remaining_target_findings = [
                o for o in remaining_orphans
                if (
                    (o.get("section") in ("projects", "project") and o.get("entry_idx") == target_project_index)
                    if (o.get("section") is not None and o.get("entry_idx") is not None)
                    else (
                        _clean_text(o.get("text", "")) in curr_target_bullet_set
                        or _clean_text(o.get("text", "")) in target_bullets
                    )
                )
            ]

            # Also verify via stable target bullet index: if a bullet at an orphaned index is still an orphan, it is not repaired
            still_orphaned_by_index = 0
            remaining_orphan_texts = {_clean_text(o.get("text", "")) for o in remaining_orphans}
            for idx in orphaned_target_indices:
                curr_text = curr_target_bullets[idx] if idx < len(curr_target_bullets) else None
                orig_text = target_bullet_list[idx] if idx < len(target_bullet_list) else None
                is_still_orphaned = any(
                    (o.get("bullet_idx") == idx and o.get("section") in ("projects", "project") and o.get("entry_idx") == target_project_index)
                    if (o.get("section") is not None and o.get("entry_idx") is not None and o.get("bullet_idx") is not None)
                    else (
                        (curr_text and curr_text in remaining_orphan_texts)
                        or (orig_text and orig_text in remaining_orphan_texts)
                    )
                    for o in remaining_orphans
                )
                if is_still_orphaned:
                    still_orphaned_by_index += 1

            unrepaired_count = max(len(remaining_target_findings), still_orphaned_by_index)
            orphans_repaired_count = max(0, len(target_orphans) - unrepaired_count)
            final_font_size = second_detect.get("font_size")
            final_page_count = second_detect.get("page_count")
            final_has_h_overflow = bool(second_detect.get("has_horizontal_overflow"))
            final_fit_warning = (not second_detect.get("fits_target", True)) or final_has_h_overflow

    # Authoritative preservation guarantee: untouched sections never modified
    for idx, orig_proj in enumerate(projects):
        if idx != target_project_index and idx < len(updated_resume["projects"]):
            updated_resume["projects"][idx] = copy.deepcopy(orig_proj)
    updated_resume["experiences"] = copy.deepcopy(current_resume.get("experiences") or [])
    updated_resume["extracurriculars"] = copy.deepcopy(current_resume.get("extracurriculars") or [])

    await _safe_log_progress(
        db,
        gen_id_str,
        "replace_project",
        f"Project replacement complete. Orphans repaired: {orphans_repaired_count}/{len(target_orphans)}.",
    )

    return {
        "tailored_resume": updated_resume,
        "orphans_detected": orphans_detected_count,
        "orphans_repaired": orphans_repaired_count,
        "font_size": final_font_size,
        "page_count": final_page_count,
        "fit_warning": final_fit_warning,
        "has_horizontal_overflow": final_has_h_overflow,
        "fits_target": not final_fit_warning,
        "fallback_used": fallback_used,
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

            manifest_data = manifest_obj.model_dump()

            from src.services.template_layout import get_generation_section_order
            gen_section_order = get_generation_section_order(gen.section_order, gen.template_id)

            pdf_bytes, fit_res = fit_and_render_pdf(
                template_id=gen.template_id,
                profile=profile_data,
                resume=tailored_resume,
                manifest=manifest_data,
                section_order=gen_section_order,
            )

            md_text = build_resume_markdown(
                profile=profile_data,
                resume=tailored_resume,
                section_order=gen_section_order,
            )

            thumb_bytes: bytes | None = None
            try:
                from src.services.pdfium import render_thumbnail
                thumb_bytes = render_thumbnail(pdf_bytes)
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
            metadata["fits_target"] = fit_res.fits_target
            metadata["has_horizontal_overflow"] = fit_res.has_horizontal_overflow
            metadata["fit_warning"] = (not fit_res.fits_target) or fit_res.has_horizontal_overflow
            if retailor_result.get("fallback_used"):
                metadata["fallback_used"] = True
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
