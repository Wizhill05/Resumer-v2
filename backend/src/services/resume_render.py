"""
resume_render.py — Shared HTML rendering and Markdown generation helpers.

Used by:
  - pipeline/nodes.py  (render_node markdown builder)
  - api/generation.py  (editor render-html and save endpoints)

Keeps Jinja template logic in one place so changes propagate to both paths.
"""

from __future__ import annotations

import gc
from typing import Any

from src.core.config import settings
from src.services.font_fit import FontFitResult, find_best_font_size
from src.template_registry.service import TemplateRegistryService


# ── HTML rendering ─────────────────────────────────────────────────────────────


def render_resume_html(
    *,
    template_id: str,
    profile: dict[str, Any],
    resume: dict[str, Any],
    font_size: float,
    page_margin_mm: float,
) -> str | None:
    """Render Jinja template to HTML string. No WeasyPrint involved.

    Returns None if the template is not found or render fails.
    """
    return TemplateRegistryService.render_template(
        template_id,
        {
            "profile": profile,
            "resume": resume,
            "font_size": font_size,
            "page_margin_mm": page_margin_mm,
        },
    )


def render_resume_pdf(
    *,
    template_id: str,
    profile: dict[str, Any],
    resume: dict[str, Any],
    font_size: float,
    page_margin_mm: float,
) -> tuple[bytes, int]:
    """Render to PDF at a fixed font size. Returns (pdf_bytes, page_count).

    Imports WeasyPrint lazily so tests/editor paths that don't need PDF
    can import this module without the native library.
    """
    from weasyprint import HTML  # type: ignore[import-untyped]

    html = render_resume_html(
        template_id=template_id,
        profile=profile,
        resume=resume,
        font_size=font_size,
        page_margin_mm=page_margin_mm,
    )
    if html is None:
        raise ValueError(f"Template '{template_id}' not found or render failed.")

    font_base_url = str(settings.TEMPLATES_DIR / template_id)
    doc = HTML(string=html, base_url=font_base_url).render()
    pdf_bytes = doc.write_pdf()
    page_count = len(doc.pages)
    del doc
    gc.collect()
    return pdf_bytes, page_count


def fit_and_render_pdf(
    *,
    template_id: str,
    profile: dict[str, Any],
    resume: dict[str, Any],
    manifest: dict[str, Any],
) -> tuple[bytes, FontFitResult]:
    """Run discrete binary search then render PDF at best font size.

    Returns (pdf_bytes, FontFitResult). Uses font_fit.find_best_font_size
    so behavior is identical to pipeline render_node.
    """
    from weasyprint import HTML  # type: ignore[import-untyped]

    min_fs: float = manifest.get("min_font_size", 8.0)
    max_fs: float = manifest.get("max_font_size", 12.0)
    target_pages: int = manifest.get("target_pages", 1)
    page_margin_mm: float = manifest.get("page_margin_mm", 15.0)
    font_base_url = str(settings.TEMPLATES_DIR / template_id)

    _last_fit_doc: list = [None]

    def _page_count(font_size: float) -> int:
        html = render_resume_html(
            template_id=template_id,
            profile=profile,
            resume=resume,
            font_size=font_size,
            page_margin_mm=page_margin_mm,
        )
        if html is None:
            raise ValueError(f"Template '{template_id}' render failed at {font_size}pt.")
        doc = HTML(string=html, base_url=font_base_url).render()
        pages = len(doc.pages)
        if pages <= target_pages:
            _last_fit_doc[0] = doc  # replaces previous; old doc freed by refcount
        else:
            del doc
        return pages

    fit_result = find_best_font_size(
        render_page_count=_page_count,
        min_font_size=min_fs,
        max_font_size=max_fs,
        target_pages=target_pages,
    )

    best_doc = _last_fit_doc[0]
    if best_doc is not None:
        pdf_bytes = best_doc.write_pdf()
        del best_doc
    else:
        # All sizes overflowed — render at min for caller to store + warn
        pdf_bytes, _ = render_resume_pdf(
            template_id=template_id,
            profile=profile,
            resume=resume,
            font_size=fit_result.font_size,
            page_margin_mm=page_margin_mm,
        )

    gc.collect()
    return pdf_bytes, fit_result


# ── Markdown generation ────────────────────────────────────────────────────────


def build_resume_markdown(
    *,
    profile: dict[str, Any],
    resume: dict[str, Any],
) -> str:
    """Build plain-text Markdown from profile + tailored resume dict.

    Mirrors the markdown generation block in pipeline/nodes.py render_node.
    """
    md_lines: list[str] = [f"# {profile.get('full_name', '')}"]

    contacts = [
        x
        for x in [profile.get("email"), profile.get("phone"), profile.get("location")]
        if x
    ]
    if contacts:
        md_lines.append(" | ".join(contacts))

    links = [
        x
        for x in [
            profile.get("linkedin_url"),
            profile.get("github_url"),
            profile.get("portfolio_url"),
        ]
        if x
    ]
    if links:
        md_lines.append(" | ".join(links))

    md_lines.append("")

    if resume.get("summary"):
        md_lines += ["## Professional Summary", resume["summary"], ""]

    if resume.get("skills"):
        md_lines.append("## Skills")
        for category, items in resume["skills"].items():
            skill_list = ", ".join(items) if isinstance(items, list) else str(items)
            md_lines.append(f"**{category}:** {skill_list}")
        md_lines.append("")

    if resume.get("experiences"):
        md_lines.append("## Experience")
        for exp in resume["experiences"]:
            date_range = f"{exp.get('start_date', '')} – {exp.get('end_date') or 'Present'}"
            md_lines.append(f"### {exp.get('role')} — {exp.get('organization')}")
            if exp.get("location"):
                md_lines.append(f"_{exp['location']} | {date_range}_")
            else:
                md_lines.append(f"_{date_range}_")
            for bullet in exp.get("bullet_points") or []:
                md_lines.append(f"- {bullet}")
            md_lines.append("")

    if resume.get("projects"):
        md_lines.append("## Projects")
        for proj in resume["projects"]:
            md_lines.append(f"### {proj.get('name')}")
            if proj.get("technologies"):
                md_lines.append(f"_Technologies: {', '.join(proj['technologies'])}_")
            if proj.get("description"):
                md_lines.append(proj["description"])
            for bullet in proj.get("bullet_points") or []:
                md_lines.append(f"- {bullet}")
            md_lines.append("")

    if resume.get("education"):
        md_lines.append("## Education")
        for edu in resume["education"]:
            date_range = f"{edu.get('start_date', '')} – {edu.get('end_date', '')}"
            md_lines.append(f"### {edu.get('degree')} — {edu.get('institution')}")
            md_lines.append(f"_{date_range}_")
            if edu.get("gpa"):
                md_lines.append(f"GPA: {edu['gpa']}")
            md_lines.append("")

    if resume.get("extracurriculars"):
        md_lines.append("## Extra-Curricular Activities & Achievements")
        for ex in resume["extracurriculars"]:
            md_lines.append(f"- {ex.get('description', '')}")
        md_lines.append("")

    return "\n".join(md_lines)
