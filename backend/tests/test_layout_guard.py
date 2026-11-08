"""The layout guard: a bullet on 3+ lines must never reach the saved PDF."""

import re
from unittest.mock import AsyncMock

import pytest

from src.pipeline import nodes as nodes_mod
from src.pipeline.graph import compile_graph

VIS = nodes_mod._visible_len


# ── Deterministic trimming ───────────────────────────────────────────────────

LONG = (
    "Built a support-ticket triage API with **FastAPI** and **PostgreSQL**, adding asynchronous ingestion for every channel, "
    "careful validation of messy payloads, and detailed logging, cutting median triage time by **38%** across **2.4M tickets**, "
    "while keeping the on-call team informed with clear dashboards and weekly summaries"
)


def test_trim_fits_the_limit_and_keeps_bold_spans_over_plain_clauses():
    out = nodes_mod._trim_bullet(LONG, 150)
    assert VIS(out) <= 150
    assert out.startswith("Built a support-ticket triage API")
    for kept in ("**FastAPI**", "**PostgreSQL**", "**38%**", "**2.4M tickets**"):
        assert kept in out, out


def test_trim_leaves_short_text_untouched():
    assert nodes_mod._trim_bullet("Built **FastAPI** service cutting latency **40%**", 150) == (
        "Built **FastAPI** service cutting latency **40%**"
    )


def test_trim_never_leaves_dangling_connectors_or_unbalanced_bold():
    for limit in range(40, 220, 7):
        out = nodes_mod._trim_bullet(LONG, limit)
        assert VIS(out) <= limit, (limit, out)
        assert out.count("**") % 2 == 0, out
        assert not re.search(r"(?:\b(?:and|with|using|while|to|for|by)\b[\s,;:]*)$", out, re.I), out
        assert out and not out.endswith((",", ";", ":")), out


def test_trim_hard_cuts_a_single_overlong_clause_at_a_word_boundary():
    text = "Architected " + " ".join(f"module{i}" for i in range(60))
    out = nodes_mod._trim_bullet(text, 80)
    assert VIS(out) <= 80 and out.startswith("Architected") and not out.endswith(" ")


# ── Graph wiring ─────────────────────────────────────────────────────────────

async def _run_graph(monkeypatch, render_result):
    from src.pipeline import graph as graph_mod

    calls: list[str] = []

    def stub(name, result=None):
        async def run(state, config):
            calls.append(name)
            return result or {}
        return run

    for name in ("job_analysis", "selection", "summary_skills", "experience", "project",
                 "extracurricular", "assembly", "orphan_repair", "content_reduction",
                 "finalize_layout", "save_artifacts"):
        monkeypatch.setattr(graph_mod, f"wrap_{name}", stub(name, {"repair_attempts": 2} if name == "orphan_repair" else {}))
    monkeypatch.setattr(graph_mod, "wrap_render", stub("render", render_result))
    await graph_mod.compile_graph().ainvoke(
        {"template_manifest": {"target_pages": 1}, "content_reduction_step": 2},
        config={"configurable": {"db": None, "gen_id": "g"}, "recursion_limit": 40},
    )
    return calls


async def test_clean_render_still_passes_through_the_guard_before_saving(monkeypatch):
    calls = await _run_graph(monkeypatch, {"page_count": 1, "fits_target": True, "orphans": None})
    assert calls[-3:] == ["render", "finalize_layout", "save_artifacts"], calls


async def test_exhausted_repairs_pass_through_the_guard(monkeypatch):
    orphans = [{"fix_type": "oversize"}]
    calls = await _run_graph(monkeypatch, {"page_count": 1, "fits_target": True, "orphans": orphans})
    # first render routes to repair (attempts < 2); after repair attempts are exhausted it must finalize
    assert calls.index("orphan_repair") < calls.index("finalize_layout") < calls.index("save_artifacts"), calls


async def test_page_overflow_with_exhausted_reductions_passes_through_the_guard(monkeypatch):
    calls = await _run_graph(monkeypatch, {"page_count": 2, "fits_target": False, "orphans": None})
    assert calls[-3:] == ["render", "finalize_layout", "save_artifacts"], calls
    assert "save_artifacts" not in calls[: calls.index("finalize_layout")]


# ── Real renderer ────────────────────────────────────────────────────────────

BASE_STATE = {
    "template_manifest": {"id": "personal-classic", "target_pages": 1, "max_font_size": 10.0, "page_margin_mm": 10.0},
    "profile": {"full_name": "Test User", "email": "t@example.com"},
    "font_size": 10.0,
    "page_count": 1,
    "section_order": None,
}
THREE_LINES = (
    "Built a support-ticket triage API with **FastAPI** and **PostgreSQL**, adding asynchronous ingestion for every channel, "
    "careful validation of messy payloads, detailed logging, retries and dashboards, cutting median triage time by **38%** "
    "across **2.4M tickets**, while keeping the on-call team informed with clear weekly summaries and runbooks"
)


def _render(resume):
    pdf, pages, found = nodes_mod._render_pdf_at(BASE_STATE, resume, 10.0)
    return pdf, pages, found


def _resume(bullets):
    return {
        "summary": "x", "skills": {}, "education": [], "extracurriculars": [],
        "projects": [{"name": "P", "bullet_points": list(bullets)}],
        "experiences": [{"role": "Eng", "organization": "Acme", "bullet_points": ["Led **Python** migration cutting cost by **30%** for **500+ users** across regions"]}],
    }


async def test_guard_removes_three_line_bullets_in_the_real_render(monkeypatch):
    monkeypatch.setattr(nodes_mod, "log_progress", AsyncMock(return_value=None))
    resume = _resume([THREE_LINES, THREE_LINES.replace("support-ticket", "billing")])
    _, _, found = _render(resume)
    oversize = [o for o in found if o["fix_type"] == "oversize"]
    assert len(oversize) == 2 and all(o["renderedLines"] >= 3 for o in oversize)

    state = dict(BASE_STATE, tailored_resume=resume, orphans=found)
    out = await nodes_mod.finalize_layout_node(state, db=AsyncMock(), gen_id="g")

    _, pages, after = _render(out["tailored_resume"])
    assert not [o for o in after if o["fix_type"] == "oversize"], after
    assert pages == 1 and out["page_count"] == 1
    assert out["pdf_bytes"].startswith(b"%PDF") and out["markdown"]
    bullets = out["tailored_resume"]["projects"][0]["bullet_points"]
    assert all("**38%**" in b and "**FastAPI**" in b for b in bullets)  # metrics survive
    assert out["tailored_resume"]["experiences"] == resume["experiences"]  # untouched bullets stay
    # the caller's resume was not mutated in place
    assert resume["projects"][0]["bullet_points"][0] == THREE_LINES


async def test_guard_is_a_noop_without_oversize_findings(monkeypatch):
    monkeypatch.setattr(nodes_mod, "log_progress", AsyncMock(return_value=None))
    state = dict(BASE_STATE, tailored_resume=_resume(["Short **Python** bullet"]),
                 orphans=[{"fix_type": "expand", "section": "projects", "entry_idx": 0, "bullet_idx": 0}])
    assert await nodes_mod.finalize_layout_node(state, db=AsyncMock(), gen_id="g") == {}
    assert await nodes_mod.finalize_layout_node(dict(state, orphans=None), db=AsyncMock(), gen_id="g") == {}


async def test_guard_handles_three_line_extracurricular_descriptions(monkeypatch):
    monkeypatch.setattr(nodes_mod, "log_progress", AsyncMock(return_value=None))
    resume = _resume(["Short **Python** bullet"])
    resume["extracurriculars"] = [{"title": "Club", "description": THREE_LINES}]
    _, _, found = _render(resume)
    oversize = [o for o in found if o["fix_type"] == "oversize"]
    if not oversize:
        pytest.skip("template renders extracurricular descriptions outside bullet detection")
    state = dict(BASE_STATE, tailored_resume=resume, orphans=found)
    out = await nodes_mod.finalize_layout_node(state, db=AsyncMock(), gen_id="g")
    _, _, after = _render(out["tailored_resume"])
    assert not [o for o in after if o["fix_type"] == "oversize"]


# ── Trimmer quality: real overflowing bullets that earlier versions garbled ───

REAL_OVERFLOWS = [
    "Architected multi-agent GenAI workflows utilizing **LangChain**, **Hermes Agents**, and custom A2A Protocols, cutting redundant LLM API token consumption by **30%** across automated document summarization pipelines processing **1.45M** records",
    "Built end-to-end data processing pipelines using **Python**, **SQL**, and **Pandas** to extract, clean, and analyze engagement metrics across **10+** academic institutions and **500+** active users to drive platform improvements at **1.25M** QPS",
    "Engineered responsive user portals and analytics dashboards using **NextJS**, **Streamlit**, and **Supabase**, reducing checkout drop-offs by **25%** and accelerating web page load performance by **40%** across all clients saving **14.2%** server costs",
    "Built end-to-end analytics pipelines with **Python**, **SQL**, and **Pandas**, validating data contracts across **10+** academic institutions and **500+** active users to support reliable, evidence-driven platform improvements",
    "Delivered hands-on training in agentic orchestration and **Prompt Engineering** with **Python**, equipping **20+ developers** to build analytics prototypes **2.4x faster** and documenting reusable model-development practices",
    "Engineered practical automation proof-of-concepts with **FastAPI**, **Python**, and vector databases, translating cross-functional business requirements into production-ready **AI** tools to accelerate **Retrieval-Augmented Generation** feature delivery by **3.7x** with **99.4%** test coverage",
]
FRAGMENT = re.compile(r"[,;]\s+(?:by|to|for|across|of|in|on)\s|\b(?:and|or|to|for|by|with|reliable)\s*$|\*\*,\s*(?:and\s+)?[a-z]+\s*$", re.I)


@pytest.mark.parametrize("limit", [205, 195, 180])
def test_trim_never_leaves_fragments_or_stubs_on_real_overflows(limit):
    kept_ratio = []
    for text in REAL_OVERFLOWS:
        out = nodes_mod._trim_bullet(text, limit)
        assert VIS(out) <= limit and out.count("**") % 2 == 0, out
        assert not FRAGMENT.search(out), out
        assert VIS(out) >= 120, f"collapsed to a stub: {out!r}"
        before = len(nodes_mod._BOLD_SPAN.findall(text))
        kept_ratio.append(len(nodes_mod._BOLD_SPAN.findall(out)) / before)
    assert sum(kept_ratio) / len(kept_ratio) >= 0.75


def test_trim_keeps_a_metric_with_the_verb_that_governs_it():
    out = nodes_mod._trim_bullet(REAL_OVERFLOWS[0], 195)
    # earlier versions produced "..., by **30%** across ..." (the verb "cutting" dropped, "by 30%" stranded)
    assert "cutting redundant LLM API token consumption by **30%**" in out


def test_trim_does_not_break_a_list_of_tools():
    for limit in (205, 195, 180):
        out = nodes_mod._trim_bullet(REAL_OVERFLOWS[1], limit)
        # earlier versions produced "using **Python**, **SQL**, and analyze ..." (list truncated mid-way)
        assert "**SQL**, and analyze" not in out, out
        assert "**Python**" not in out or "**Pandas**" in out or "**SQL**" not in out, out
