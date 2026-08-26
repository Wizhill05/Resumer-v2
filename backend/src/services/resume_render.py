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


# ── Orphan Detection ──────────────────────────────────────────────────────────


def detect_orphans_in_weasyprint(doc: Any) -> list[dict[str, Any]]:
    """Walks the WeasyPrint document layout tree and finds orphan/oversize bullets."""
    orphan_data: list[dict[str, Any]] = []

    def get_text(box: Any) -> str:
        if hasattr(box, "text") and box.text:
            return box.text
        texts = []
        for child in getattr(box, "children", []):
            texts.append(get_text(child))
        return "".join(texts)

    try:
        if not doc or not getattr(doc, "pages", None):
            return []

        for page in doc.pages:
            li_lines: dict[Any, dict[str, Any]] = {}
            current_section = ["unknown"]

            def walk_tree(box: Any, current_li_element: Any = None, current_li_box: Any = None) -> None:
                if type(box).__name__ == "MarkerBox" or getattr(box, "pseudo_type", None) == "marker":
                    return

                tag = getattr(box, "element_tag", None)
                dom_element = getattr(box, "element", None)

                if dom_element is not None and tag == "h2":
                    h2_text = "".join(dom_element.itertext()).strip().lower()
                    if "project" in h2_text:
                        current_section[0] = "projects"
                    elif "experience" in h2_text:
                        current_section[0] = "experience"
                    elif "activit" in h2_text or "achievement" in h2_text:
                        current_section[0] = "activities"

                next_li_element = current_li_element
                next_li_box = current_li_box

                if dom_element is not None and tag == "li":
                    next_li_element = dom_element
                    next_li_box = box

                if type(box).__name__ == "LineBox":
                    if current_li_element is not None and tag != "li::marker":
                        if current_li_element not in li_lines:
                            li_lines[current_li_element] = {"lines": [], "section": current_section[0]}
                        li_lines[current_li_element]["lines"].append((box, current_li_box))

                for child in getattr(box, "children", []):
                    walk_tree(child, next_li_element, next_li_box)

            walk_tree(page._page_box)

            for el, data in li_lines.items():
                lines = data["lines"]
                section = data["section"]
                text = "".join(el.itertext()).strip()
                if not text:
                    continue

                line_count = len(lines)
                if line_count <= 1:
                    continue

                widths = [line.width for line, _ in lines]
                first_line_width = widths[0]
                full_width = max(widths[:-1]) if len(widths) > 1 else first_line_width

                if full_width <= 0:
                    continue

                last_line_width = widths[-1]
                last_line_fill = last_line_width / full_width

                # Derive chars-per-line from the first (full) line
                first_line_text = get_text(lines[0][0]).strip()
                if first_line_text and full_width > 0:
                    chars_per_line = len(first_line_text)
                else:
                    chars_per_line = 90

                if line_count == 2 and last_line_fill < 0.75:
                    target_min = int(chars_per_line * 1.80)
                    target_max = int(chars_per_line * 1.95)
                    chars_to_add_min = max(0, target_min - len(text))
                    chars_to_add_max = max(0, target_max - len(text))
                    suggestion = (
                        f"Last line is an orphan ({int(last_line_fill * 100)}% width). "
                        f"Expand by ~{chars_to_add_min}-{chars_to_add_max} chars to fill line 2 (>=75% width), "
                        f"or trim by ~{max(0, len(text) - chars_per_line)} chars to fit on 1 line."
                    )
                    orphan_data.append({
                        "fix_type": "expand",
                        "section": section,
                        "text": text,
                        "currentChars": len(text),
                        "renderedLines": line_count,
                        "charsPerLine": chars_per_line,
                        "targetCharsMin": target_min,
                        "targetCharsMax": target_max,
                        "charsToAddMin": chars_to_add_min,
                        "charsToAddMax": chars_to_add_max,
                        "lineWidths": [round(float(w), 2) for w in widths],
                        "lastLineFillPercent": round(last_line_fill * 100, 1),
                        "minimumLastLineFill": 75,
                        "measuredAtFontSize": getattr(getattr(lines[0][0], "style", None), "font_size", None),
                        "suggestion": suggestion,
                    })
                elif line_count > 2:
                    # Keep oversize findings visible so a repair that regresses
                    # from two lines to three can be rolled back. The repair
                    # node only acts on these when they have repair history.
                    target_max = int(chars_per_line * 1.95)
                    orphan_data.append({
                        "fix_type": "oversize",
                        "section": section,
                        "text": text,
                        "currentChars": len(text),
                        "renderedLines": line_count,
                        "charsPerLine": chars_per_line,
                        "targetCharsMin": int(chars_per_line * 1.80),
                        "targetCharsMax": target_max,
                        "suggestion": (
                            f"Bullet spans {line_count} lines. Preserve the original if this was introduced by repair; "
                            "otherwise handle through page-fit/content reduction."
                        ),
                    })
    except Exception as e:
        import logging
        logging.getLogger("resumer.resume_render").warning(f"Error in WeasyPrint orphan detection: {e}")
        return []

    return orphan_data


def detect_resume_orphans(
    *,
    template_id: str,
    profile: dict[str, Any],
    resume: dict[str, Any],
    manifest: dict[str, Any] | None = None,
    font_size: float | None = None,
) -> dict[str, Any]:
    """Compile WeasyPrint layout and run orphan line detection on candidate or current resume.

    Returns a comprehensive diagnostic dictionary with page fitting status,
    orphan bullet details, and actionable instructions for AI agents.
    """
    from weasyprint import HTML  # type: ignore[import-untyped]

    if manifest is None:
        manifest_obj = TemplateRegistryService.get_template_manifest(template_id)
        if not manifest_obj:
            return {
                "success": False,
                "error": f"Template '{template_id}' manifest missing.",
            }
        manifest = manifest_obj.model_dump()

    target_pages: int = manifest.get("target_pages", 1)
    page_margin_mm: float = manifest.get("page_margin_mm", 15.0)
    font_base_url = str(settings.TEMPLATES_DIR / template_id)

    doc = None
    effective_font_size: float = font_size or manifest.get("max_font_size", 10.0)

    try:
        if font_size is not None:
            html = render_resume_html(
                template_id=template_id,
                profile=profile,
                resume=resume,
                font_size=font_size,
                page_margin_mm=page_margin_mm,
            )
            if html is None:
                return {"success": False, "error": f"Template '{template_id}' render failed at {font_size}pt."}
            doc = HTML(string=html, base_url=font_base_url).render()
            page_count = len(doc.pages)
            fits_target = page_count <= target_pages
        else:
            _last_fit_doc: list = [None]
            min_fs: float = manifest.get("min_font_size", 8.0)
            max_fs: float = manifest.get("max_font_size", 12.0)

            def _page_count(fs: float) -> int:
                h = render_resume_html(
                    template_id=template_id,
                    profile=profile,
                    resume=resume,
                    font_size=fs,
                    page_margin_mm=page_margin_mm,
                )
                if h is None:
                    raise ValueError(f"Template '{template_id}' render failed at {fs}pt.")
                d = HTML(string=h, base_url=font_base_url).render()
                p = len(d.pages)
                if p <= target_pages:
                    _last_fit_doc[0] = d
                else:
                    del d
                return p

            fit_result = find_best_font_size(
                render_page_count=_page_count,
                min_font_size=min_fs,
                max_font_size=max_fs,
                target_pages=target_pages,
            )
            effective_font_size = fit_result.font_size
            page_count = fit_result.page_count
            fits_target = fit_result.fits_target
            doc = _last_fit_doc[0]

            if doc is None:
                # Rendered at min font size
                h = render_resume_html(
                    template_id=template_id,
                    profile=profile,
                    resume=resume,
                    font_size=effective_font_size,
                    page_margin_mm=page_margin_mm,
                )
                if h is not None:
                    doc = HTML(string=h, base_url=font_base_url).render()

        orphans = detect_orphans_in_weasyprint(doc) if doc else []
    except Exception as e:
        return {"success": False, "error": f"Orphan detection failed during render: {e}"}
    finally:
        if doc is not None:
            del doc
        gc.collect()

    # Formulate steering instructions
    if orphans and not fits_target:
        actionable = (
            f"CRITICAL: Found {len(orphans)} orphan bullet(s) AND resume overflows target page count "
            f"({page_count} pages vs target {target_pages} page). "
            f"1. Shorten lengthy bullets or remove a bullet to fix overflow. "
            f"2. Adjust wording of detected orphans to hit target character ranges. "
            f"3. Call detect_orphans again or render_resume when resolved."
        )
    elif orphans:
        actionable = (
            f"CRITICAL: Detected {len(orphans)} orphan/oversize bullet(s). "
            f"Review each item in 'orphans' array above. Adjust the bullet wording in resume_json "
            f"according to the suggestions (expand to >=75% line fill or shorten), then call render_resume."
        )
    elif not fits_target:
        actionable = (
            f"WARNING: Resume exceeds target page count ({page_count} pages vs target {target_pages} page). "
            f"Shorten summary or trim bullet points in resume_json, then call render_resume."
        )
    else:
        actionable = (
            f"ALL CLEAN: No orphan lines detected and resume fits perfectly ({page_count}/{target_pages} page(s) at {effective_font_size}pt). "
            f"Proceed to call render_resume to compile the final PDF."
        )

    return {
        "success": True,
        "template_id": template_id,
        "font_size": effective_font_size,
        "page_count": page_count,
        "target_pages": target_pages,
        "fits_target": fits_target,
        "has_orphans": len(orphans) > 0,
        "orphan_count": len(orphans),
        "orphans": orphans,
        "actionable_instructions_for_ai": actionable,
    }


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
