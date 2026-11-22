"""
resume_render.py — Shared HTML rendering and Markdown generation helpers.

Used by:
  - pipeline/nodes.py  (render_node markdown builder)
  - api/generation.py  (editor render-html and save endpoints)

Keeps Jinja template logic in one place so changes propagate to both paths.
"""

from __future__ import annotations

import gc
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from src.core.config import settings
from src.services.font_fit import FontFitResult, find_best_font_size
from src.template_registry.service import TemplateRegistryService


# ── WeasyPrint resource fetching (SSRF guard) ────────────────────────────────


def _inside_templates_dir(path: Path) -> bool:
    root = Path(settings.TEMPLATES_DIR).resolve()
    try:
        path.resolve().relative_to(root)
    except (ValueError, OSError, RuntimeError):
        return False
    return True


def safe_url_fetcher(url: str, *args: Any, **kwargs: Any) -> Any:
    """WeasyPrint ``url_fetcher`` that only loads template assets.

    Résumé text can come from users and from MCP clients, so a stray ``<img src="http://...">`` or a
    CSS ``url()`` must never make the server fetch a network or local file. Allowed: ``data:`` URIs and
    ``file://`` URLs that resolve inside ``settings.TEMPLATES_DIR`` (fonts, icons). Everything else
    raises, which WeasyPrint reports as a warning and skips the resource. Pass it to every ``HTML(...)``.
    """
    from weasyprint.urls import URLFetcher  # type: ignore[import-untyped]

    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme == "file":
        if parts.netloc not in ("", "localhost") or not _inside_templates_dir(Path(unquote(parts.path))):
            raise ValueError(f"Blocked resource outside the template directory: {url[:200]}")
    elif scheme != "data":
        raise ValueError(f"Blocked resource URL scheme {scheme or 'none'!r}: {url[:200]}")
    return URLFetcher(allowed_protocols=("file", "data"), allow_redirects=False).fetch(url)


def render_document_at(
    *,
    template_id: str,
    profile: dict[str, Any],
    resume: dict[str, Any],
    font_size: float,
    page_margin_mm: float,
    section_order: list[str] | None = None,
) -> Any:
    """Render to a laid-out WeasyPrint document at a fixed font size (no PDF written)."""
    from weasyprint import HTML  # type: ignore[import-untyped]

    html = render_resume_html(
        template_id=template_id,
        profile=profile,
        resume=resume,
        font_size=font_size,
        page_margin_mm=page_margin_mm,
        section_order=section_order,
    )
    if html is None:
        raise ValueError(f"Template '{template_id}' render failed at {font_size}pt.")
    return HTML(
        string=html, base_url=str(settings.TEMPLATES_DIR / template_id), url_fetcher=safe_url_fetcher
    ).render()


# ── HTML rendering ─────────────────────────────────────────────────────────────


def render_resume_html(
    *,
    template_id: str,
    profile: dict[str, Any],
    resume: dict[str, Any],
    font_size: float,
    page_margin_mm: float,
    section_order: list[str] | None = None,
) -> str | None:
    """Render Jinja template to HTML string. No WeasyPrint involved.

    Returns None if the template is not found or render fails.
    """
    context: dict[str, Any] = {
        "profile": profile,
        "resume": resume,
        "font_size": font_size,
        "page_margin_mm": page_margin_mm,
    }
    if section_order is not None:
        context["section_order"] = section_order

    return TemplateRegistryService.render_template(template_id, context)


def render_resume_pdf(
    *,
    template_id: str,
    profile: dict[str, Any],
    resume: dict[str, Any],
    font_size: float,
    page_margin_mm: float,
    section_order: list[str] | None = None,
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
        section_order=section_order,
    )
    if html is None:
        raise ValueError(f"Template '{template_id}' not found or render failed.")

    font_base_url = str(settings.TEMPLATES_DIR / template_id)
    doc = HTML(string=html, base_url=font_base_url, url_fetcher=safe_url_fetcher).render()
    pdf_bytes = doc.write_pdf()
    page_count = len(doc.pages)
    del doc
    gc.collect()
    return pdf_bytes, page_count


def check_horizontal_overflow(doc: Any, page_margin_mm: float = 14.0) -> bool:
    """Check if any text or element box overflows horizontally past the page content margins."""
    if not doc or not getattr(doc, "pages", None):
        return False
    margin_px = page_margin_mm * 96 / 25.4
    for page in doc.pages:
        page_box = getattr(page, "_page_box", None)
        if not page_box:
            continue
        right_bound = page.width - margin_px + 1.0  # 1px tolerance
        for b in page_box.descendants():
            if type(b).__name__ == "TextBox":
                if b.position_x + b.width > right_bound or b.position_x < margin_px - 1.0:
                    return True
    return False


@dataclass
class FittedRender:
    """The font-fitted WeasyPrint document plus the fit result (no PDF written yet).

    ``doc`` is the document at ``font_size``: the largest size that fits, or the minimum size when
    nothing fits. Callers measure it (orphans, page fill) and/or call ``doc.write_pdf()``.
    """

    doc: Any
    font_size: float
    page_count: int
    fits_target: bool
    has_horizontal_overflow: bool

    @property
    def fit_result(self) -> FontFitResult:
        return FontFitResult(
            font_size=self.font_size,
            page_count=self.page_count,
            fits_target=self.fits_target,
            has_horizontal_overflow=self.has_horizontal_overflow,
        )


def render_fitted_document(
    *,
    template_id: str,
    profile: dict[str, Any],
    resume: dict[str, Any],
    manifest: dict[str, Any],
    section_order: list[str] | None = None,
    min_font_size: float | None = None,
    max_font_size: float | None = None,
    stats: dict[str, Any] | None = None,
) -> FittedRender:
    """Same discrete binary search as render_node, keeping the fitted doc so it is rendered once.

    The minimum-size probe is kept too, so the all-overflow case needs no extra render.
    ``min_font_size`` / ``max_font_size`` narrow the search inside the manifest range (a caller that
    already knows a size fits, or does not, searches only the remaining side). ``stats["renders"]`` is
    incremented once per WeasyPrint layout.
    """
    min_fs: float = manifest.get("min_font_size", 8.0)
    max_fs: float = manifest.get("max_font_size", 12.0)
    if min_font_size is not None:
        min_fs = max(min_fs, min_font_size)
    if max_font_size is not None:
        max_fs = max(min(max_fs, max_font_size), min_fs)
    target_pages: int = manifest.get("target_pages", 1)
    page_margin_mm: float = manifest.get("page_margin_mm", 15.0)

    kept: dict[str, Any] = {"fit": None, "fit_fs": None, "min": None}

    def _count() -> None:
        if stats is not None:
            stats["renders"] = stats.get("renders", 0) + 1

    def _page_count(font_size: float) -> tuple[int, bool]:
        _count()
        doc = render_document_at(
            template_id=template_id,
            profile=profile,
            resume=resume,
            font_size=font_size,
            page_margin_mm=page_margin_mm,
            section_order=section_order,
        )
        pages = len(doc.pages)
        has_h_overflow = check_horizontal_overflow(doc, page_margin_mm)
        if pages <= target_pages and not has_h_overflow:
            kept["fit"], kept["fit_fs"] = doc, font_size  # replaces previous; old doc freed by refcount
        elif abs(font_size - min_fs) < 1e-6:
            kept["min"] = doc
        else:
            del doc
        return pages, has_h_overflow

    fit_result = find_best_font_size(
        render_page_count=_page_count,
        min_font_size=min_fs,
        max_font_size=max_fs,
        target_pages=target_pages,
    )
    if fit_result.fits_target:
        doc = kept["fit"] if kept["fit_fs"] == fit_result.font_size else None
    else:
        doc = kept["min"]
    if doc is None:
        _count()
        doc = render_document_at(
            template_id=template_id,
            profile=profile,
            resume=resume,
            font_size=fit_result.font_size,
            page_margin_mm=page_margin_mm,
            section_order=section_order,
        )
    kept.clear()
    return FittedRender(
        doc=doc,
        font_size=fit_result.font_size,
        page_count=len(doc.pages),
        fits_target=fit_result.fits_target,
        has_horizontal_overflow=fit_result.has_horizontal_overflow,
    )


def fit_and_render_pdf(
    *,
    template_id: str,
    profile: dict[str, Any],
    resume: dict[str, Any],
    manifest: dict[str, Any],
    section_order: list[str] | None = None,
) -> tuple[bytes, FontFitResult]:
    """Run discrete binary search then render PDF at best font size.

    Returns (pdf_bytes, FontFitResult). Uses font_fit.find_best_font_size
    so behavior is identical to pipeline render_node.
    """
    fitted = render_fitted_document(
        template_id=template_id,
        profile=profile,
        resume=resume,
        manifest=manifest,
        section_order=section_order,
    )
    pdf_bytes = fitted.doc.write_pdf()
    fit_result = fitted.fit_result
    fitted.doc = None
    gc.collect()
    return pdf_bytes, fit_result


# ── Page fill ─────────────────────────────────────────────────────────────────

_CONTENT_BOX_TYPES = ("LineBox", "BlockReplacedBox", "InlineReplacedBox")


def measure_page_fill(doc: Any, page_margin_mm: float = 15.0, page_index: int = 0) -> float:
    """How much of the page's usable height the content fills, 0..1 (page 1 by default).

    Usable height = page height minus the top and bottom page margins; fill = (bottom of the lowest
    line or image on the page - top margin) / usable height. The margins are read from the laid-out
    page box (templates use asymmetric bottom margins); ``page_margin_mm`` is the fallback when the
    box does not expose them. Raises ValueError when the document has no such page.
    """
    pages = getattr(doc, "pages", None) or []
    if page_index >= len(pages):
        raise ValueError(f"document has no page {page_index + 1}")
    page = pages[page_index]
    page_box = getattr(page, "_page_box", None)
    if page_box is None:
        raise ValueError("page has no layout box")
    fallback_px = page_margin_mm * 96 / 25.4
    top = getattr(page_box, "margin_top", None)
    bottom = getattr(page_box, "margin_bottom", None)
    top = float(top) if isinstance(top, (int, float)) else fallback_px
    bottom = float(bottom) if isinstance(bottom, (int, float)) else fallback_px
    usable = float(page.height) - top - bottom
    if usable <= 0:
        raise ValueError("page has no usable height")
    lowest = top
    for box in page_box.descendants():
        if type(box).__name__ in _CONTENT_BOX_TYPES:
            lowest = max(lowest, float(box.position_y) + float(box.margin_height()))
    return max(0.0, min(1.0, (lowest - top) / usable))


def _is_marker(box: Any) -> bool:
    tag = getattr(box, "element_tag", "") or ""
    return "marker" in tag.lower() or "marker" in type(box).__name__.lower() or bool(getattr(box, "is_marker", False))


def _line_text(box: Any) -> str:
    if _is_marker(box):
        return ""
    if hasattr(box, "text"):
        return box.text or ""
    return "".join(_line_text(c) for c in getattr(box, "children", []))


def measure_bullet_lines(doc: Any) -> dict[tuple[str, int, int], dict[str, Any]]:
    """Rendered shape of every addressable bullet (``<li data-section data-entry-idx data-bullet-idx>``).

    Returns {(section, entry_idx, bullet_idx): {lines, first_line_chars, last_line_fill_percent,
    line_height, line_chars, line_widths, line_texts}} for all bullets, including clean one- and two-line ones (the
    orphan detector only reports problem bullets). ``line_chars`` are visible characters per rendered
    line (wrap spaces excluded). A bullet split across pages is counted once with all its lines.
    """
    out: dict[tuple[str, int, int], dict[str, Any]] = {}
    widths: dict[tuple[str, int, int], list[float]] = {}
    for page in getattr(doc, "pages", None) or []:
        page_box = getattr(page, "_page_box", None)
        if page_box is None:
            continue
        for block in page_box.descendants():
            if type(block).__name__ != "BlockBox":
                continue
            elem = getattr(block, "element", None)
            if elem is None or getattr(elem, "tag", None) != "li" or not hasattr(elem, "get"):
                continue
            section, entry, bullet = elem.get("data-section"), elem.get("data-entry-idx"), elem.get("data-bullet-idx")
            if not section or not str(entry or "").isdigit() or not str(bullet or "").isdigit():
                continue
            key = (str(section), int(entry), int(bullet))
            info = out.setdefault(key, {
                "lines": 0, "first_line_chars": None, "last_line_fill_percent": None, "line_height": None,
                "line_chars": [], "line_widths": [], "line_texts": [],
            })
            for line in block.children:
                if type(line).__name__ != "LineBox":
                    continue
                text = _line_text(line).strip()
                if not text:
                    continue
                info["lines"] += 1
                if info["first_line_chars"] is None:
                    info["first_line_chars"] = len(text)
                    info["line_height"] = float(line.margin_height())
                widths.setdefault(key, []).append(float(line.width))
                info["line_chars"].append(len(text))
                info["line_texts"].append(text)
                info["line_widths"].append(round(float(line.width), 2))
    for key, w in widths.items():
        if len(w) >= 2 and max(w[:-1]) > 0:
            out[key]["last_line_fill_percent"] = round(w[-1] / max(w[:-1]) * 100, 1)
    return out


# ── Orphan Detection ──────────────────────────────────────────────────────────


# A two-line bullet is "filled" when its last line is at least this fraction of the
# line width (0.80 == 1.80 rendered lines). Repairs aim for the window below, which
# stays under 2.0 lines: one more character wraps onto a 3rd line.
ORPHAN_FILL_FLOOR = 0.80
REPAIR_TARGET_LINES_MIN = 1.84
REPAIR_TARGET_LINES_MAX = 1.95


def detect_orphans_in_weasyprint(doc: Any, *, strict: bool = False) -> list[dict[str, Any]]:
    """Inspect WeasyPrint formatted line boxes to detect awkward single-word terminal line breaks.

    Identifies 2-line bullets where the second line has < ORPHAN_FILL_FLOOR (80%) of the first line's width,
    indicating an 'orphan' word or short fragment that wastes vertical space.

    By default a detector failure is logged and reported as "no findings"; ``strict=True`` re-raises it
    so callers that must not mistake a failure for a clean layout can surface it.
    """
    if not doc or not getattr(doc, "pages", None):
        return []

    orphan_data: list[dict[str, Any]] = []

    def is_marker_box(box: Any) -> bool:
        tag = getattr(box, "element_tag", "") or ""
        if "marker" in tag.lower():
            return True
        if "marker" in type(box).__name__.lower():
            return True
        if getattr(box, "is_marker", False):
            return True
        return False

    def get_line_text(box: Any) -> str:
        if is_marker_box(box):
            return ""
        if hasattr(box, "text"):
            return box.text or ""
        return "".join(get_line_text(c) for c in getattr(box, "children", []))

    def find_line_boxes(box: Any) -> list[Any]:
        if is_marker_box(box):
            return []
        if type(box).__name__ == "LineBox":
            return [box]
        lines: list[Any] = []
        for child in getattr(box, "children", []):
            lines.extend(find_line_boxes(child))
        return lines

    seen_elements: set[Any] = set()
    seen_blocks: set[int] = set()

    elem_section: dict[Any, str] = {}
    elem_entry_idx: dict[Any, int] = {}
    parent_map: dict[Any, Any] = {}
    try:
        root = getattr(getattr(doc, "_html", None), "etree_element", None)
        if root is not None:
            body = root.find("body")
            walk_root = body if body is not None else root
            parent_map = {c: p for p in walk_root.iter() for c in p}
            current_sec = "experience"
            sec_entry_count: dict[str, int] = {}
            for el in walk_root.iter():
                if el.tag in ("h1", "h2", "h3"):
                    txt = "".join(el.itertext()).strip().upper()
                    if "EXPERIENCE" in txt:
                        current_sec = "experience"
                    elif "PROJECT" in txt:
                        current_sec = "projects"
                    elif "EXTRA" in txt or "ACHIEVEMENT" in txt:
                        current_sec = "extracurriculars"
                    elif "EDUCATION" in txt:
                        current_sec = "education"
                    elif "SKILL" in txt:
                        current_sec = "skills"
                    elif "SUMMARY" in txt:
                        current_sec = "summary"
                elem_section[el] = current_sec
                classes = (el.get("class") or "").split() if hasattr(el, "get") else []
                if "resume-entry" in classes:
                    idx = sec_entry_count.get(current_sec, 0)
                    elem_entry_idx[el] = idx
                    sec_entry_count[current_sec] = idx + 1
    except Exception:
        pass

    try:
        for page in doc.pages:
            page_box = getattr(page, "_page_box", None)
            if not page_box:
                continue

            for block in page_box.descendants():
                if is_marker_box(block):
                    continue
                if type(block).__name__ not in ("BlockBox", "BlockReplacedBox"):
                    continue

                elem = getattr(block, "element", None)
                elem_tag = getattr(elem, "tag", None) or getattr(block, "element_tag", "") or ""
                classes = (elem.get("class") or "").split() if elem is not None and hasattr(elem, "get") else []
                is_target = elem_tag == "li" or any("bullet" in c for c in classes)

                if not is_target:
                    continue

                if elem is not None:
                    if elem in seen_elements:
                        continue
                    # Inspect each bullet only once: mark this element and its non-li DOM descendants seen
                    for sub in elem.iter():
                        if sub is elem or getattr(sub, "tag", None) != "li":
                            seen_elements.add(sub)
                else:
                    if id(block) in seen_blocks:
                        continue
                    seen_blocks.add(id(block))

                raw_lines = find_line_boxes(block)
                # Keep only lines that contain non-empty text (filters marker boxes / padding)
                lines = []
                for line in raw_lines:
                    txt = get_line_text(line).strip()
                    if txt:
                        lines.append((line, txt))

                line_count = len(lines)
                if line_count <= 1:
                    continue

                # Extract canonical DOM text excluding markers, preserving word spaces between wrapped lines
                if elem is not None:
                    dom_text = re.sub(r"\s+", " ", "".join(elem.itertext())).strip()
                    text = dom_text if dom_text else " ".join(txt for _, txt in lines)
                else:
                    text = " ".join(txt for _, txt in lines)

                if not text or len(text) < 40:
                    continue

                # Derive section classification and stable identity
                curr_el = elem
                section = None
                entry_idx = None
                bullet_idx = None

                if elem is not None:
                    attr_sec = elem.get("data-section") if hasattr(elem, "get") else None
                    attr_entry = elem.get("data-entry-idx") if hasattr(elem, "get") else None
                    attr_bullet = elem.get("data-bullet-idx") if hasattr(elem, "get") else None
                    if attr_sec:
                        section = attr_sec
                    if attr_entry is not None and str(attr_entry).isdigit():
                        entry_idx = int(attr_entry)
                    if attr_bullet is not None and str(attr_bullet).isdigit():
                        bullet_idx = int(attr_bullet)

                if not section:
                    while curr_el is not None:
                        if curr_el in elem_section:
                            section = elem_section[curr_el]
                            break
                        curr_el = parent_map.get(curr_el)

                if not section:
                    section = "experience"

                if entry_idx is None and elem is not None:
                    curr_el = elem
                    while curr_el is not None:
                        if curr_el in elem_entry_idx:
                            entry_idx = elem_entry_idx[curr_el]
                            break
                        curr_el = parent_map.get(curr_el)

                if bullet_idx is None and elem is not None:
                    parent = parent_map.get(elem)
                    if parent is not None:
                        li_siblings = [c for c in parent if getattr(c, "tag", None) == "li"]
                        if elem in li_siblings:
                            bullet_idx = li_siblings.index(elem)

                widths = [line.width for line, _ in lines]
                first_line_width = widths[0]
                full_width = max(widths[:-1]) if len(widths) > 1 else first_line_width

                if full_width <= 0:
                    continue

                last_line_width = widths[-1]
                last_line_fill = last_line_width / full_width

                # Derive chars-per-line from the first (full) line
                first_line_text = lines[0][1]
                if first_line_text and full_width > 0:
                    chars_per_line = len(first_line_text)
                else:
                    chars_per_line = 90

                if line_count == 2 and last_line_fill < ORPHAN_FILL_FLOOR:
                    target_min = int(chars_per_line * REPAIR_TARGET_LINES_MIN)
                    target_max = int(chars_per_line * REPAIR_TARGET_LINES_MAX)
                    chars_to_add_min = max(0, target_min - len(text))
                    chars_to_add_max = max(0, target_max - len(text))
                    suggestion = (
                        f"Last line is an orphan ({int(last_line_fill * 100)}% width). "
                        f"Expand by ~{chars_to_add_min}-{chars_to_add_max} chars to fill line 2 (>={round(ORPHAN_FILL_FLOOR * 100)}% width), "
                        f"or trim by ~{max(0, len(text) - chars_per_line)} chars to fit on 1 line."
                    )
                    orphan_data.append({
                        "fix_type": "expand",
                        "section": section,
                        "entry_idx": entry_idx,
                        "bullet_idx": bullet_idx,
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
                        "minimumLastLineFill": round(ORPHAN_FILL_FLOOR * 100),
                        "measuredAtFontSize": getattr(getattr(lines[0][0], "style", None), "font_size", None),
                        "suggestion": suggestion,
                    })
                elif line_count > 2:
                    # Keep oversize findings visible so a repair that regresses
                    # from two lines to three can be rolled back. The repair
                    # node only acts on these when they have repair history.
                    target_max = int(chars_per_line * REPAIR_TARGET_LINES_MAX)
                    orphan_data.append({
                        "fix_type": "oversize",
                        "section": section,
                        "entry_idx": entry_idx,
                        "bullet_idx": bullet_idx,
                        "text": text,
                        "currentChars": len(text),
                        "renderedLines": line_count,
                        "charsPerLine": chars_per_line,
                        "targetCharsMin": int(chars_per_line * REPAIR_TARGET_LINES_MIN),
                        "targetCharsMax": target_max,
                        "suggestion": (
                            f"Bullet spans {line_count} lines. Preserve the original if this was introduced by repair; "
                            "otherwise handle through page-fit/content reduction."
                        ),
                    })
    except Exception as e:
        if strict:
            raise
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
    section_order: list[str] | None = None,
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
    has_horizontal_overflow = False

    try:
        if font_size is not None:
            html = render_resume_html(
                template_id=template_id,
                profile=profile,
                resume=resume,
                font_size=font_size,
                page_margin_mm=page_margin_mm,
                section_order=section_order,
            )
            if html is None:
                return {"success": False, "error": f"Template '{template_id}' render failed at {font_size}pt."}
            doc = HTML(string=html, base_url=font_base_url, url_fetcher=safe_url_fetcher).render()
            page_count = len(doc.pages)
            has_horizontal_overflow = check_horizontal_overflow(doc, page_margin_mm)
            fits_target = page_count <= target_pages and not has_horizontal_overflow
        else:
            _last_fit_doc: list = [None]
            min_fs: float = manifest.get("min_font_size", 8.0)
            max_fs: float = manifest.get("max_font_size", 12.0)

            def _page_count(fs: float) -> tuple[int, bool]:
                h = render_resume_html(
                    template_id=template_id,
                    profile=profile,
                    resume=resume,
                    font_size=fs,
                    page_margin_mm=page_margin_mm,
                    section_order=section_order,
                )
                if h is None:
                    raise ValueError(f"Template '{template_id}' render failed at {fs}pt.")
                d = HTML(string=h, base_url=font_base_url, url_fetcher=safe_url_fetcher).render()
                p = len(d.pages)
                has_h = check_horizontal_overflow(d, page_margin_mm)
                if p <= target_pages and not has_h:
                    _last_fit_doc[0] = d
                else:
                    del d
                return p, has_h

            fit_result = find_best_font_size(
                render_page_count=_page_count,
                min_font_size=min_fs,
                max_font_size=max_fs,
                target_pages=target_pages,
            )
            effective_font_size = fit_result.font_size
            page_count = fit_result.page_count
            fits_target = fit_result.fits_target
            has_horizontal_overflow = fit_result.has_horizontal_overflow
            doc = _last_fit_doc[0]

            if doc is None:
                # Rendered at min font size
                h = render_resume_html(
                    template_id=template_id,
                    profile=profile,
                    resume=resume,
                    font_size=effective_font_size,
                    page_margin_mm=page_margin_mm,
                    section_order=section_order,
                )
                if h is not None:
                    doc = HTML(string=h, base_url=font_base_url, url_fetcher=safe_url_fetcher).render()
                    has_horizontal_overflow = check_horizontal_overflow(doc, page_margin_mm)
                    if has_horizontal_overflow:
                        fits_target = False

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
            f"according to the suggestions (expand to >={round(ORPHAN_FILL_FLOOR * 100)}% line fill or shorten), then call render_resume."
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
        "has_horizontal_overflow": has_horizontal_overflow,
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
    section_order: list[str] | None = None,
) -> str:
    """Build plain-text Markdown from profile + tailored resume dict.

    Follows section_order for body sections, preserving top candidate header
    and omitting empty sections.
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

    effective_order = (
        section_order
        if section_order
        else ["summary", "education", "skills", "projects", "experiences", "extracurriculars"]
    )

    for sec in effective_order:
        if sec == "summary" and resume.get("summary"):
            md_lines += ["## Professional Summary", resume["summary"], ""]
        elif sec == "education" and resume.get("education"):
            md_lines.append("## Education")
            for edu in resume["education"]:
                date_range = f"{edu.get('start_date', '')} – {edu.get('end_date', '')}"
                md_lines.append(f"### {edu.get('degree')} — {edu.get('institution')}")
                md_lines.append(f"_{date_range}_")
                if edu.get("gpa"):
                    md_lines.append(f"GPA: {edu['gpa']}")
                md_lines.append("")
        elif sec == "skills" and resume.get("skills"):
            md_lines.append("## Skills")
            for category, items in resume["skills"].items():
                skill_list = ", ".join(items) if isinstance(items, list) else str(items)
                md_lines.append(f"**{category}:** {skill_list}")
            md_lines.append("")
        elif sec == "projects" and resume.get("projects"):
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
        elif sec == "experiences" and resume.get("experiences"):
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
        elif sec == "extracurriculars" and resume.get("extracurriculars"):
            md_lines.append("## Extra-Curricular Activities & Achievements")
            for ex in resume["extracurriculars"]:
                md_lines.append(f"- {ex.get('description', '')}")
            md_lines.append("")

    return "\n".join(md_lines)
