"""Page fill measurement (usable-area relative) with real renders, and its use in the server pipeline."""

import json
from unittest.mock import AsyncMock

import pytest

from src.pipeline import nodes as nodes_mod
from src.services import resume_render
from tests.client_draft_fixtures import BACKEND_DIR, BULLET_BANK, cut_to

PROFILE = {"full_name": "Priya Raman", "email": "priya@example.com", "phone": "+1 415 555 0142"}


def _manifest(template_id):
    return json.loads((BACKEND_DIR / "templates" / template_id / "manifest.json").read_text())


def _resume(n_bullets, chars=185):
    bullets = [cut_to(BULLET_BANK[i % len(BULLET_BANK)], chars) for i in range(n_bullets)]
    half = (len(bullets) + 1) // 2
    return {
        "summary": "Backend engineer building **Python** services and data platforms.",
        "skills": {"Languages": ["Python", "SQL", "Go"], "Data": ["PostgreSQL", "Redis", "Kafka"]},
        "experiences": [{"role": "Engineer", "organization": "Acme", "start_date": "2021-01-01", "bullet_points": bullets[:half]}],
        "projects": [{"name": "FeatureLake", "bullet_points": bullets[half:]}] if bullets[half:] else [],
        "education": [{"degree": "B.S. Computer Science", "institution": "UW", "start_date": "2012-09-01", "end_date": "2016-06-01"}],
        "extracurriculars": [],
    }


def _doc(template_id, resume, font_size=10.0):
    m = _manifest(template_id)
    return resume_render.render_document_at(
        template_id=template_id, profile=PROFILE, resume=resume, font_size=font_size,
        page_margin_mm=m["page_margin_mm"], section_order=m["default_section_order"],
    )


@pytest.mark.parametrize("template_id", ["personal-classic", "professional-sans"])
def test_page_fill_is_monotonic_in_content(template_id):
    margin = _manifest(template_id)["page_margin_mm"]
    fills = [resume_render.measure_page_fill(_doc(template_id, _resume(n)), margin) for n in (0, 4, 8, 12)]
    assert all(0.0 <= f <= 1.0 for f in fills)
    assert fills == sorted(fills) and fills[0] < fills[-1], fills
    assert fills[0] < 0.35  # header + summary + skills + education only


def test_page_fill_is_relative_to_the_usable_area():
    """fill = (content bottom - top margin) / (page height - top - bottom margin), with the template's real
    (asymmetric) margins; page 1 of an overflowing résumé is nearly full."""
    template_id = "personal-classic"
    margin = _manifest(template_id)["page_margin_mm"]
    resume = _resume(0)
    resume["experiences"] = [
        {"role": f"Engineer {i}", "organization": "Acme", "start_date": "2020-01-01",
         "bullet_points": [cut_to(BULLET_BANK[(i + k) % len(BULLET_BANK)], 200) for k in range(3)]}
        for i in range(10)
    ]
    doc = _doc(template_id, resume, font_size=11.5)
    assert len(doc.pages) >= 2
    fill = resume_render.measure_page_fill(doc, margin)
    # entries are kept together, so page 1 can end with up to one entry's height of free space
    assert fill > 0.75

    px = 96 / 25.4
    top, bottom = margin * px, margin * 0.7 * px  # personal-classic: @page margin-bottom = 0.7 x margin
    page = doc.pages[0]
    lowest = max(
        b.position_y + b.margin_height() for b in page._page_box.descendants() if type(b).__name__ == "LineBox"
    )
    assert fill == pytest.approx((lowest - top) / (page.height - top - bottom), abs=1e-6)
    assert 0 < resume_render.measure_page_fill(doc, margin, page_index=1) <= 1.0
    with pytest.raises(ValueError):
        resume_render.measure_page_fill(doc, margin, page_index=9)


def test_render_fitted_document_matches_fit_and_render_pdf():
    m = _manifest("professional-sans")
    resume = _resume(8)
    fitted = resume_render.render_fitted_document(
        template_id="professional-sans", profile=PROFILE, resume=resume, manifest=m,
        section_order=m["default_section_order"],
    )
    pdf, fit = resume_render.fit_and_render_pdf(
        template_id="professional-sans", profile=PROFILE, resume=resume, manifest=m,
        section_order=m["default_section_order"],
    )
    assert fit == fitted.fit_result and pdf.startswith(b"%PDF")
    assert len(fitted.doc.pages) == fitted.page_count == 1


def test_render_fitted_document_keeps_the_min_font_doc_when_nothing_fits(monkeypatch):
    m = _manifest("personal-classic")
    calls = []
    real = resume_render.render_document_at
    monkeypatch.setattr(resume_render, "render_document_at", lambda **k: calls.append(k["font_size"]) or real(**k))
    fitted = resume_render.render_fitted_document(
        template_id="personal-classic", profile=PROFILE, resume=_resume(40, 200), manifest=m,
    )
    assert not fitted.fits_target and fitted.font_size == m["min_font_size"] and fitted.page_count >= 2
    assert len(calls) == len(set(calls))  # no size rendered twice


# ── Server pipeline records page_fill_percent ────────────────────────────────


def _state(template_id, resume):
    return {
        "template_manifest": _manifest(template_id),
        "profile": PROFILE,
        "tailored_resume": resume,
        "section_order": None,
        "repair_attempts": 1,  # skip the intermediate-snapshot DB write
    }


async def test_render_node_reports_page_fill(monkeypatch):
    monkeypatch.setattr(nodes_mod, "log_progress", AsyncMock(return_value=None))
    short = await nodes_mod.render_node(_state("personal-classic", _resume(2)), db=AsyncMock(), gen_id="g")
    full = await nodes_mod.render_node(_state("personal-classic", _resume(14)), db=AsyncMock(), gen_id="g")
    assert 0 < short["page_fill_percent"] < full["page_fill_percent"] <= 100
    assert isinstance(full["page_fill_percent"], float)
    assert "page_fill_percent" in nodes_mod.ResumeGraphState.__annotations__


async def test_finalize_layout_node_reports_fill_of_the_trimmed_document(monkeypatch):
    monkeypatch.setattr(nodes_mod, "log_progress", AsyncMock(return_value=None))
    long = cut_to(BULLET_BANK[0] + " " + BULLET_BANK[1], 300)
    resume = _resume(4)
    resume["projects"][0]["bullet_points"][0] = long
    state = dict(_state("personal-classic", resume), font_size=10.0, page_count=1)
    _, _, found = nodes_mod._render_pdf_at(state, resume, 10.0)
    assert any(o["fix_type"] == "oversize" for o in found)
    out = await nodes_mod.finalize_layout_node(dict(state, orphans=found), db=AsyncMock(), gen_id="g")
    assert out["page_fill_percent"] is not None
    _, _, _, fill = nodes_mod._render_measured_at(state, out["tailored_resume"], 10.0)
    assert out["page_fill_percent"] == fill


def test_trim_oversize_bullets_is_pure_and_reports_what_it_did():
    resume = _resume(4)
    resume["projects"][0]["bullet_points"][0] = cut_to(BULLET_BANK[0] + " " + BULLET_BANK[1], 300)
    state = dict(_state("personal-classic", resume))
    _, _, found = nodes_mod._render_pdf_at(state, resume, 10.0)
    oversize = [o for o in found if o["fix_type"] == "oversize"]
    out = nodes_mod.trim_oversize_bullets(resume, oversize, lambda r: nodes_mod._render_measured_at(state, r, 10.0))
    assert out.rendered and out.error is None and out.remaining_oversize == []
    assert len(out.trimmed) == 1 and out.chars_removed > 0
    assert resume["projects"][0]["bullet_points"][0] != out.resume["projects"][0]["bullet_points"][0]

    def broken(_):
        raise RuntimeError("no renderer")

    failed = nodes_mod.trim_oversize_bullets(resume, oversize, broken)
    assert failed.error is not None and not failed.rendered
    assert nodes_mod.trim_oversize_bullets(resume, [], broken).rendered is False
