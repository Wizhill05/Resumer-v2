from __future__ import annotations

import io
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.file_links import build_resume_file_link
from src.core.storage import StorageService
from src.mcp.context import get_current_mcp_user, get_mcp_db
from src.models.generation import Generation
from src.models.profile import Profile
from src.services.resume_render import (
    build_resume_markdown,
    detect_resume_orphans,
    fit_and_render_pdf,
    render_resume_html,
)
from src.template_registry.service import TemplateRegistryService


def _apply_json_patch(target: dict[str, Any], path: str, operation: str, value: Any) -> None:
    """Surgically apply set/append/remove on nested dict/list via dot and bracket path notation.
    Examples:
      - 'summary'
      - 'skills.Languages'
      - 'experiences[0].bullet_points[1]'
      - 'projects[0].technologies'
    """
    tokens = re.findall(r'[^.\[\]]+|\[\d+\]', path)
    clean_tokens: list[str | int] = []
    for t in tokens:
        if t.startswith("[") and t.endswith("]"):
            clean_tokens.append(int(t[1:-1]))
        else:
            clean_tokens.append(t)

    if not clean_tokens:
        raise ValueError("Invalid empty path")

    curr = target
    for i, tok in enumerate(clean_tokens[:-1]):
        nxt = clean_tokens[i + 1]
        if isinstance(tok, int):
            curr = curr[tok]
        else:
            if tok not in curr:
                curr[tok] = [] if isinstance(nxt, int) else {}
            curr = curr[tok]

    last_tok = clean_tokens[-1]
    if operation == "set":
        if isinstance(last_tok, int):
            curr[last_tok] = value
        else:
            curr[last_tok] = value
    elif operation == "append":
        if isinstance(last_tok, int):
            curr[last_tok].append(value)
        else:
            if last_tok not in curr or not isinstance(curr[last_tok], list):
                curr[last_tok] = []
            curr[last_tok].append(value)
    elif operation == "remove":
        if isinstance(last_tok, int):
            curr.pop(last_tok)
        else:
            curr.pop(last_tok, None)
    else:
        raise ValueError(f"Unknown operation: {operation}. Use 'set', 'append', or 'remove'.")


async def get_resume_json_handler(
    generation_id: str,
    section: str | None = None,
) -> dict[str, Any]:
    """Retrieve full tailored resume JSON or specific section for a completed generation."""
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
            return {"success": False, "error": f"Generation is in status '{gen.status}', not completed."}

        metadata = gen.render_metadata or {}
        tailored = metadata.get("tailored_resume", {})
        revision = metadata.get("editor_revision", 0)

        if section:
            data = tailored.get(section)
            return {
                "success": True,
                "generation_id": str(gen.id),
                "editor_revision": revision,
                "section": section,
                "data": data,
            }

        return {
            "success": True,
            "generation_id": str(gen.id),
            "editor_revision": revision,
            "tailored_resume": tailored,
            "font_size": metadata.get("font_size"),
            "page_count": metadata.get("page_count"),
            "fit_warning": metadata.get("fit_warning", False),
        }


async def edit_resume_section_handler(
    generation_id: str,
    path: str,
    operation: str = "set",
    value: Any = None,
    expected_revision: int | None = None,
) -> dict[str, Any]:
    """Surgically update a section or bullet point in a tailored resume without full regeneration."""
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
            return {"success": False, "error": f"Generation is in status '{gen.status}', not completed."}

        metadata = dict(gen.render_metadata or {})
        current_revision = metadata.get("editor_revision", 0)
        if expected_revision is not None and expected_revision != current_revision:
            return {
                "success": False,
                "error_code": "REVISION_CONFLICT",
                "message": f"Revision conflict: expected {expected_revision}, but current revision is {current_revision}.",
                "current_revision": current_revision,
            }

        tailored = dict(metadata.get("tailored_resume", {}))
        try:
            _apply_json_patch(tailored, path, operation, value)
        except Exception as e:
            return {"success": False, "error": f"Failed to apply patch at '{path}': {e}"}

        # Update in metadata (staged in DB)
        metadata["tailored_resume"] = tailored
        metadata["edited_at"] = datetime.now(timezone.utc).isoformat()
        gen.render_metadata = metadata
        await db.commit()

        return {
            "success": True,
            "generation_id": str(gen.id),
            "editor_revision": current_revision,
            "message": f"Successfully updated '{path}'. Call preview_resume or save_resume_edits to verify/persist.",
            "updated_section": path.split(".")[0].split("[")[0],
        }


async def preview_resume_handler(generation_id: str) -> dict[str, Any]:
    """Trigger Jinja/HTML preview and check WeasyPrint page-fitting overflow without saving."""
    user = get_current_mcp_user()
    gen_uuid = uuid.UUID(generation_id)

    async with get_mcp_db() as db:
        res = await db.execute(
            select(Generation).where(Generation.id == gen_uuid, Generation.user_id == user.id)
        )
        gen = res.scalar_one_or_none()
        if not gen:
            return {"success": False, "error": f"Generation '{generation_id}' not found."}

        metadata = gen.render_metadata or {}
        tailored = metadata.get("tailored_resume", {})
        profile_data = metadata.get("profile")
        if not profile_data:
            prof_res = await db.execute(select(Profile).where(Profile.user_id == user.id))
            prof = prof_res.scalar_one_or_none()
            profile_data = {
                "full_name": prof.full_name if prof else user.name,
                "email": prof.email if prof else user.email,
                "phone": prof.phone if prof else None,
                "location": prof.location if prof else None,
                "linkedin_url": prof.linkedin_url if prof else None,
                "github_url": prof.github_url if prof else None,
                "portfolio_url": prof.portfolio_url if prof else None,
                "subtitle": prof.subtitle if prof else None,
            }

    manifest_obj = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not manifest_obj:
        return {"success": False, "error": f"Template '{gen.template_id}' manifest missing."}

    try:
        pdf_bytes, fit_result = fit_and_render_pdf(
            template_id=gen.template_id,
            profile=profile_data,
            resume=tailored,
            manifest=manifest_obj.model_dump(),
        )
    except Exception as e:
        return {"success": False, "error": f"Preview render failed: {e}"}

    overflow_warning = None
    suggested_reductions = []
    if not fit_result.fits_target:
        overflow_warning = (
            f"Resume exceeds target page count ({fit_result.page_count} pages vs target {manifest_obj.target_pages} page(s)) "
            f"even at minimum font size ({fit_result.font_size}pt)."
        )
        suggested_reductions = [
            "Shorten lengthy bullet points in your most verbose work experience.",
            "Remove one bullet point or merge closely related items.",
            "Reduce summary length to under 30 words.",
        ]

    return {
        "success": True,
        "generation_id": str(gen.id),
        "template_id": gen.template_id,
        "font_size": fit_result.font_size,
        "page_count": fit_result.page_count,
        "target_pages": manifest_obj.target_pages,
        "fits_target": fit_result.fits_target,
        "overflow_warning": overflow_warning,
        "suggested_reductions": suggested_reductions,
    }


async def render_resume_handler(
    generation_id: str,
    resume_json: dict[str, Any] | None = None,
    font_size: float | None = None,
    expected_revision: int | None = None,
) -> dict[str, Any]:
    """Single-step resume JSON editing, typography font-fitting, and PDF re-compilation.

    Accepts complete or partial modified resume JSON (or renders staged edits if omitted),
    executes WeasyPrint discrete binary-search font fitting, uploads the revised PDF and
    assets to storage, and returns the fresh capability download URL and updated metadata.
    """
    user = get_current_mcp_user()
    gen_uuid = uuid.UUID(generation_id)

    async with get_mcp_db() as db:
        res = await db.execute(
            select(Generation).where(Generation.id == gen_uuid, Generation.user_id == user.id)
        )
        gen = res.scalar_one_or_none()
        if not gen:
            return {"success": False, "error": f"Generation '{generation_id}' not found."}

        metadata = dict(gen.render_metadata or {})
        current_revision = metadata.get("editor_revision", 0)
        if expected_revision is not None and expected_revision != current_revision:
            return {
                "success": False,
                "error_code": "REVISION_CONFLICT",
                "message": f"Revision conflict: expected {expected_revision}, current {current_revision}.",
                "current_revision": current_revision,
            }

        # If resume_json provided, replace tailored_resume in metadata
        if resume_json is not None:
            metadata["tailored_resume"] = resume_json

        tailored = metadata.get("tailored_resume", {})
        profile_data = metadata.get("profile")
        if not profile_data:
            prof_res = await db.execute(select(Profile).where(Profile.user_id == user.id))
            prof = prof_res.scalar_one_or_none()
            profile_data = {
                "full_name": prof.full_name if prof else user.name,
                "email": prof.email if prof else user.email,
                "phone": prof.phone if prof else None,
                "location": prof.location if prof else None,
                "linkedin_url": prof.linkedin_url if prof else None,
                "github_url": prof.github_url if prof else None,
                "portfolio_url": prof.portfolio_url if prof else None,
                "subtitle": prof.subtitle if prof else None,
            }

    manifest_obj = TemplateRegistryService.get_template_manifest(gen.template_id)
    if not manifest_obj:
        return {"success": False, "error": f"Template '{gen.template_id}' manifest missing."}

    # 1. WeasyPrint compile
    try:
        if font_size is not None:
            from src.services.resume_render import render_resume_pdf

            pdf_bytes, page_count = render_resume_pdf(
                template_id=gen.template_id,
                profile=profile_data,
                resume=tailored,
                font_size=font_size,
                page_margin_mm=manifest_obj.page_margin_mm,
            )
            fits_target = page_count <= manifest_obj.target_pages
            effective_font_size = font_size
        else:
            pdf_bytes, fit_result = fit_and_render_pdf(
                template_id=gen.template_id,
                profile=profile_data,
                resume=tailored,
                manifest=manifest_obj.model_dump(),
            )
            page_count = fit_result.page_count
            fits_target = fit_result.fits_target
            effective_font_size = fit_result.font_size
    except Exception as e:
        return {"success": False, "error": f"PDF render failed: {e}"}

    # 2. Markdown
    md_text = build_resume_markdown(profile=profile_data, resume=tailored)

    # 3. Thumbnail
    thumb_bytes: bytes | None = None
    try:
        import pypdfium2 as pdfium  # type: ignore[import-untyped]
        from PIL import Image

        pdf_doc = pdfium.PdfDocument(pdf_bytes)
        page = pdf_doc[0]
        scale = 400 / page.get_width()
        bitmap = page.render(scale=scale, rotation=0)
        pil_image = bitmap.to_pil()
        buf = io.BytesIO()
        pil_image.save(buf, format="WEBP", quality=80)
        thumb_bytes = buf.getvalue()
    except Exception:
        pass

    # 4. Upload to Cloudflare R2
    pdf_key = f"runs/{gen.id}/resume.pdf"
    md_key = f"runs/{gen.id}/resume.md"
    thumb_key = f"runs/{gen.id}/thumb.webp"

    storage = StorageService()
    pdf_uploaded = storage.upload_bytes(pdf_bytes, pdf_key, "application/pdf")
    storage.upload_bytes(md_text.encode("utf-8"), md_key, "text/markdown")
    thumb_uploaded = thumb_bytes and storage.upload_bytes(thumb_bytes, thumb_key, "image/webp")

    # 5. Snapshot & update revision
    new_revision = current_revision + 1
    metadata["font_size"] = effective_font_size
    metadata["page_count"] = page_count
    metadata["fit_warning"] = not fits_target
    metadata["editor_revision"] = new_revision
    metadata["edited_at"] = datetime.now(timezone.utc).isoformat()

    async with get_mcp_db() as db:
        res = await db.execute(
            select(Generation).where(Generation.id == gen_uuid, Generation.user_id == user.id)
        )
        db_gen = res.scalar_one_or_none()
        if db_gen:
            db_gen.render_metadata = metadata
            if pdf_uploaded:
                db_gen.pdf_storage_key = pdf_key
            if thumb_uploaded:
                db_gen.thumb_storage_key = thumb_key
            await db.commit()

    download_url = build_resume_file_link(gen.id)
    role_title = gen.job_title or "Target Role"
    company_name = gen.company or ""
    label = f"{company_name} {role_title}".strip() + " Resume (PDF)"

    return {
        "success": True,
        "generation_id": str(gen.id),
        "editor_revision": new_revision,
        "font_size": effective_font_size,
        "page_count": page_count,
        "fits_target": fits_target,
        "download_url": download_url,
        "resume_json": tailored,
        "message": f"Resume re-rendered successfully! Updated PDF: [{label}]({download_url})",
    }


async def save_resume_edits_handler(
    generation_id: str,
    expected_revision: int,
) -> dict[str, Any]:
    """Persist staged resume edits, re-render WeasyPrint PDF, and update Cloudflare R2 objects."""
    return await render_resume_handler(
        generation_id=generation_id,
        expected_revision=expected_revision,
    )


async def detect_orphans_handler(
    generation_id: str,
    resume_json: dict[str, Any] | None = None,
    font_size: float | None = None,
) -> dict[str, Any]:
    """Inspect WeasyPrint layout tree for orphan lines and page overflow in a tailored resume.

    CRITICAL WORKFLOW INSTRUCTION:
    Whenever you add, modify, or remove projects, work experience, or bullet points in a resume,
    you MUST call this tool immediately BEFORE finalizing the resume.
    It inspects WeasyPrint line boxes to detect bullets where the last line has only 1-3 words (<75% line fill)
    or bullets that overflow to 3+ lines.
    """
    user = get_current_mcp_user()
    try:
        gen_uuid = uuid.UUID(generation_id)
    except ValueError:
        return {"success": False, "error": f"Invalid generation ID format: '{generation_id}'"}

    async with get_mcp_db() as db:
        res = await db.execute(
            select(Generation).where(Generation.id == gen_uuid, Generation.user_id == user.id)
        )
        gen = res.scalar_one_or_none()
        if not gen:
            return {"success": False, "error": f"Generation '{generation_id}' not found."}

        if gen.status != "completed":
            return {"success": False, "error": f"Generation is in status '{gen.status}', not completed."}

        metadata = gen.render_metadata or {}
        target_resume = resume_json if resume_json is not None else metadata.get("tailored_resume", {})
        if not target_resume:
            return {"success": False, "error": "No resume data found to analyze."}

        profile_data = metadata.get("profile")
        if not profile_data:
            prof_res = await db.execute(select(Profile).where(Profile.user_id == user.id))
            prof = prof_res.scalar_one_or_none()
            profile_data = {
                "full_name": prof.full_name if prof else user.name,
                "email": prof.email if prof else user.email,
                "phone": prof.phone if prof else None,
                "location": prof.location if prof else None,
                "linkedin_url": prof.linkedin_url if prof else None,
                "github_url": prof.github_url if prof else None,
                "portfolio_url": prof.portfolio_url if prof else None,
                "subtitle": prof.subtitle if prof else None,
            }

    result = detect_resume_orphans(
        template_id=gen.template_id,
        profile=profile_data,
        resume=target_resume,
        font_size=font_size,
    )
    if result.get("success"):
        result["generation_id"] = str(gen.id)
    return result
