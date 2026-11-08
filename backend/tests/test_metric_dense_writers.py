"""Metric-dense writer prompts, density scoring and the 80% fill floor."""

import re

import pytest

from src.pipeline import nodes as nodes_mod
from src.services import resume_render


# ── Density scoring ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("span", ["42%", "sub-2s", "12K", "2.4x", "$1.2M", "300ms", "<50ms", "120 QPS", "95.4% F1"])
def test_metric_spans(span):
    assert nodes_mod._is_metric_span(span)


@pytest.mark.parametrize("span", ["Neo4j", "p5.js", "LLaMA 3", "FastAPI", "S3", "H100", "GPT-4o", "Python"])
def test_tool_names_with_digits_are_not_metrics(span):
    assert not nodes_mod._is_metric_span(span)


def test_bullet_density_counts_bold_spans():
    text = "Built **FastAPI** service on **Neo4j** cutting p95 latency **42%** to **180ms**"
    assert nodes_mod.bullet_density(text) == (2, 2)
    assert nodes_mod.bullet_density("no bold at all 40%") == (0, 0)


def test_density_summary():
    dense = "Built **A** and **B** with **40%** and **2s** gains"
    weak = "Built **A** quickly"
    summary = nodes_mod._density_summary([dense, weak])
    assert "1/2 bullets have >=2 bold metrics and >=2 bold tools" in summary
    assert "1/2 have a metric" in summary


# ── Source metrics ───────────────────────────────────────────────────────────

def test_source_metrics_extracts_numbers_and_skips_names_and_years():
    texts = [
        "Cut latency by 30% across 500+ users using Neo4j and p5.js in 2024",
        "Processed 2.4x more rows, 12K requests, $1.5M saved, 300ms p95. Again 30%.",
    ]
    assert nodes_mod._source_metrics(texts) == ["30%", "500+", "2.4x", "12K", "$1.5M", "300ms"]


def test_source_metrics_line_none_and_values():
    assert nodes_mod._source_metrics_line(["Built a thing"]) == "Source metrics: none\n"
    assert nodes_mod._source_metrics_line("desc 40%", ["x 3x"]) == "Source metrics: 40%, 3x\n"


# ── Prompts ──────────────────────────────────────────────────────────────────

MODES = ("proper", "larp", "super_larp")


@pytest.mark.parametrize("mode", MODES)
def test_writer_prompts_format_and_stay_small(mode):
    for system, user in (
        nodes_mod.experience_writer_default_prompts(mode),
        nodes_mod.projects_writer_default_prompts(mode),
    ):
        assert "{batch_len}" in system
        assert system.format(batch_len=2)  # no stray braces
        assert "{job_analysis}" in user and "{entries}" in user
        assert len(system) <= 3200
    system, _ = nodes_mod.synthetic_project_default_prompts()
    assert "{" not in system and len(system) <= 2600


def test_metric_rules_block_budget():
    for block in (nodes_mod._LARP_METRIC_RULES, nodes_mod._PROPER_METRIC_RULES):
        assert len(block) + len(nodes_mod._BULLET_STYLE_RULES) <= 2000


def test_larp_demands_metrics_and_proper_does_not_invent():
    larp, _ = nodes_mod.experience_writer_default_prompts("super_larp")
    proper, _ = nodes_mod.experience_writer_default_prompts("proper")
    assert "at least 2 bold metrics" in larp
    assert "LARP MODE" in larp and "embellish freely" in larp
    assert "Never use headcounts" in larp
    assert "First place every number listed under Source metrics" in larp
    # proper stays truthful and never asks for invented numbers
    assert "at least 2 bold metrics" not in proper
    assert "Do not invent employers, products, metrics" in proper
    assert "Quantify only with numbers stated" in proper
    assert "LARP MODE" not in proper and "plausible metrics" not in proper
    proj_proper, _ = nodes_mod.projects_writer_default_prompts("proper")
    proj_larp, _ = nodes_mod.projects_writer_default_prompts("larp")
    assert "Do not invent metrics" in proj_proper and "LARP MODE" not in proj_proper
    assert "LARP MODE" in proj_larp and "at least 2 bold metrics" in proj_larp


@pytest.mark.parametrize("mode", MODES)
def test_line_fit_tells_writers_the_new_target(mode):
    system, _ = nodes_mod.experience_writer_default_prompts(mode)
    assert "1.85-1.95" in system and "1.75" not in system
    assert not re.search(r"\*\*35%\*\*", system)  # example values leak into outputs


def test_repair_prompt_rewards_substance_not_filler():
    for larp in (False, True):
        _, user = nodes_mod.orphan_repair_default_prompts(larp)
        assert "never filler" in user and "Keep every bold metric" in user
        assert "**35%**" not in user
        assert len(user) <= 1900


def test_weak_bullet_hint_only_in_larp_repair():
    orphan = {"lastLineFillPercent": 40, "minimumLastLineFill": 80, "charsPerLine": 110}
    weak = "Built **FastAPI** service for users"
    larp = nodes_mod._repair_block(1, "ctx", weak, orphan, True)
    proper = nodes_mod._repair_block(1, "ctx", weak, orphan, False)
    strong = nodes_mod._repair_block(1, "ctx", "Cut p95 by **40%** to **90ms** on **FastAPI**", orphan, True)
    assert "the added words must include a new bold metric" in larp
    assert "new bold metric" not in proper
    assert "new bold metric" not in strong


# ── Fill floor ───────────────────────────────────────────────────────────────

def test_fill_constants():
    assert resume_render.ORPHAN_FILL_FLOOR == 0.80
    assert resume_render.REPAIR_TARGET_LINES_MIN < resume_render.REPAIR_TARGET_LINES_MAX < 2.0
    assert round(resume_render.ORPHAN_FILL_FLOOR * 100) == 80


def _render(bullet):
    return nodes_mod._render_for_verification(
        {
            "template_manifest": {"id": "personal-classic", "target_pages": 1, "max_font_size": 10.0, "page_margin_mm": 15.0},
            "profile": {"full_name": "T U", "email": "t@example.com"},
            "font_size": 10.0,
        },
        [{"role": "Engineer", "organization": "Acme", "bullet_points": [bullet]}], [], [],
    )[1]


def test_detector_flags_bullets_between_75_and_80_percent():
    base = (
        "Engineered real-time analytics engine with WebSockets handling 50k concurrent "
        "client streams with sub-second latency"
    )
    words = ["across", "three", "regions", "using", "partitioned", "Redis", "caching", "and",
             "automated", "failover", "for", "high", "availability", "under", "peak", "traffic"]
    seen = {}
    text = base + "."
    for word in [None] + words:
        if word:
            text = text[:-1] + f" {word}."
        found = _render(text)
        fill = found[0]["lastLineFillPercent"] if found and found[0]["fix_type"] == "expand" else None
        seen[text] = (found, fill)
    flagged = [f for found, f in seen.values() if f is not None]
    # every flagged bullet is below the floor, and floor is reported as 80
    assert flagged and all(f < 80 for f in flagged)
    assert all(o["minimumLastLineFill"] == 80 for found, _ in seen.values() for o in found if o["fix_type"] == "expand")
    # at least one candidate lands in the old-OK band (75-80) and is now flagged, not accepted
    assert any(75 <= f < 80 for f in flagged) or any(f >= 80 for found, f in seen.values() if not found)
