"""Fallback verification for orphan_repair_node.

Covers the user-reported bug: an expand repair that grows a bullet from
2 lines to 3 (or pushes a 1-page resume to 2 pages) must fall back to the
pre-repair original instead of keeping the over-long expansion.
"""

import json
import sys
import types
from unittest.mock import AsyncMock, patch

from src.pipeline import nodes as nodes_mod


def _make_state(original_bullet: str) -> dict:
    return {
        "experience_draft": [
            {
                "role": "Backend Engineer",
                "organization": "Acme",
                "bullet_points": [original_bullet],
            }
        ],
        "projects_draft": [],
        "extracurriculars_draft": [],
        "keywords": ["Python"],
        "is_pro": False,
        "repair_attempts": 0,
        "repair_history": {},
        "page_count": 1,
        "font_size": 10.0,
        "template_manifest": {
            "id": "personal-classic",
            "target_pages": 1,
            "max_font_size": 10.0,
            "page_margin_mm": 15.0,
        },
        "profile": {"full_name": "Test User"},
        "tailored_resume": {
            "summary": "Backend engineer.",
            "skills": {},
            "experiences": [],
            "projects": [],
            "education": [],
            "extracurriculars": [],
        },
        "orphans": [
            {
                "fix_type": "expand",
                "section": "experience",
                "text": original_bullet,
                "renderedLines": 2,
                "lastLineFillPercent": 30.0,
                "minimumLastLineFill": 75,
            }
        ],
    }


def _install_fake_weasyprint(monkeypatch, page_count: int):
    """Stub the weasyprint module so the verification render is deterministic."""
    fake_mod = types.ModuleType("weasyprint")

    class _FakeDoc:
        pages = [object()] * page_count

    class _FakeHTML:
        def __init__(self, string=None, base_url=None):
            pass

        def render(self):
            return _FakeDoc()

    fake_mod.HTML = _FakeHTML
    monkeypatch.setitem(sys.modules, "weasyprint", fake_mod)


async def _run_repair(monkeypatch, state, expanded_text, verify_orphans, verify_pages):
    """Run orphan_repair_node with LLM + render layers fully mocked."""
    llm_resp = AsyncMock()
    llm_resp.content = json.dumps(
        {"bullets": [{"index": 1, "replacement": expanded_text}]}
    )

    _install_fake_weasyprint(monkeypatch, verify_pages)
    monkeypatch.setattr(
        nodes_mod.TemplateRegistryService,
        "render_template",
        staticmethod(lambda *a, **k: "<html></html>"),
    )
    monkeypatch.setattr(
        nodes_mod, "detect_orphans_in_weasyprint", lambda doc: verify_orphans
    )
    monkeypatch.setattr(
        nodes_mod, "log_progress", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        nodes_mod,
        "get_prompt_config",
        AsyncMock(return_value=("sys", "user {kw_text} {bullet_blocks}")),
    )
    monkeypatch.setattr(
        nodes_mod, "invoke_with_fallback", AsyncMock(return_value=llm_resp)
    )

    return await nodes_mod.orphan_repair_node(state, db=AsyncMock(), gen_id="test-gen")


async def test_grown_bullet_reverts_to_original(monkeypatch):
    """2-line orphan expanded to 3 lines -> fallback keeps the original text."""
    original = "Built caching layer cutting p95 latency."
    expanded = (
        "Built distributed caching layer with consistent hashing cutting p95 "
        "latency across regions significantly."
    )
    state = _make_state(original)
    verify_orphans = [
        {
            "fix_type": "oversize",
            "text": expanded,
            "renderedLines": 3,
        }
    ]

    result = await _run_repair(monkeypatch, state, expanded, verify_orphans, 1)

    assert result["experience_draft"][0]["bullet_points"][0] == original
    assert result["repair_history"] == {}


async def test_overflow_reverts_all_repairs(monkeypatch):
    """Expansion that pushes 1 page -> 2 pages -> all repairs reverted."""
    original = "Built caching layer cutting p95 latency."
    expanded = original + " Extra truthful detail about scope and impact."
    state = _make_state(original)

    result = await _run_repair(monkeypatch, state, expanded, [], 2)

    assert result["experience_draft"][0]["bullet_points"][0] == original
    assert result["repair_history"] == {}


async def test_clean_expansion_is_kept(monkeypatch):
    """Expansion that stays at <=2 lines and fits the page is applied."""
    original = "Built caching layer cutting p95 latency."
    expanded = original + " Covering three services in production."
    state = _make_state(original)

    result = await _run_repair(monkeypatch, state, expanded, [], 1)

    assert result["experience_draft"][0]["bullet_points"][0] == expanded
