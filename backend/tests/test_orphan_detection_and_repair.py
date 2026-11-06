import json
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
import pytest
from weasyprint import HTML

from src.pipeline import nodes as nodes_mod
from src.schemas.pipeline import TailoredProject, TailoredProjectBatch
from src.services.resume_render import (
    detect_orphans_in_weasyprint,
    render_resume_html,
)
from src.services.resume_retailor import retailor_resume_with_project
from src.template_registry.service import TemplateRegistryService


def test_weasyprint_orphan_detection_canonical_text_and_no_markers():
    """(1) detect_orphans_in_weasyprint extracts canonical DOM text without markers,

    preserves word spaces between wrapped lines, and inspects each bullet only once.
    """
    resume = {
        "experiences": [
            {
                "role": "Senior Backend Engineer",
                "organization": "Acme Corp",
                "start_date": "2021-01-01",
                "end_date": "2023-01-01",
                "bullet_points": [
                    "Built **distributed caching layer** with consistent hashing cutting p95 latency across multiple regions significantly for high throughput workloads.",
                    "Short single-line bullet.",
                ],
            }
        ],
        "projects": [
            {
                "name": "Project Alpha",
                "bullet_points": [
                    "Engineered real-time *analytics engine* with `WebSockets` handling 50k concurrent client streams with sub-second latency.",
                ],
            }
        ],
        "education": [],
        "skills": {"Languages": ["Python", "Go"]},
    }
    profile = {"full_name": "Test User", "email": "test@example.com"}

    html = render_resume_html(
        template_id="personal-classic",
        profile=profile,
        resume=resume,
        font_size=10.0,
        page_margin_mm=15.0,
    )
    assert html is not None
    doc = HTML(string=html).render()

    orphans = detect_orphans_in_weasyprint(doc)
    assert len(orphans) >= 1

    # Check every detected orphan
    texts = [o["text"] for o in orphans]
    # Inspect each bullet only once: no duplicate texts!
    assert len(texts) == len(set(texts)), f"Duplicate orphan findings detected: {texts}"

    for o in orphans:
        text = o["text"]
        # Must exclude list markers (such as bullet points, circle, disc)
        assert "•" not in text
        assert "◦" not in text
        assert "▪" not in text
        assert not text.startswith("- ")

        # Preserves word spaces between wrapped lines (no concatenated words)
        words = text.split()
        for word in words:
            # Words shouldn't be bizarre concatenations like 'multipleregions' or 'latencyacross'
            assert word not in ("multipleregions", "latencyacross", "ApacheKafka", "end-to-endlatency")

    # Specific check for the experience bullet
    exp_orphan = next((o for o in orphans if "distributed caching layer" in o["text"]), None)
    assert exp_orphan is not None
    # Word spaces between wrapped lines are present
    assert "across multiple regions" in exp_orphan["text"]
    assert exp_orphan["renderedLines"] == 2


@pytest.mark.asyncio
async def test_orphan_repair_node_real_weasyprint_5_line_rollback(monkeypatch):
    """(1) Real WeasyPrint verification correctly matches and rejects a 5-line repair,

    reverting it to the pre-repair original.
    """
    original_bullet = (
        "Engineered real-time analytics engine with WebSockets handling 50k concurrent client streams with sub-second latency."
    )

    state = {
        "template_id": "personal-classic",
        "template_manifest": {
            "id": "personal-classic",
            "target_pages": 1,
            "max_font_size": 10.0,
            "page_margin_mm": 15.0,
        },
        "profile": {"full_name": "Test User", "email": "test@example.com"},
        "page_count": 1,
        "font_size": 10.0,
        "experience_draft": [
            {
                "role": "Senior Backend Engineer",
                "organization": "Acme Corp",
                "bullet_points": [original_bullet],
            }
        ],
        "projects_draft": [],
        "extracurriculars_draft": [],
        "keywords": ["Python", "WebSockets"],
        "orphans": [
            {
                "fix_type": "expand",
                "section": "experience",
                "text": original_bullet,
                "renderedLines": 2,
                "lastLineFillPercent": 34.5,
                "minimumLastLineFill": 75,
            }
        ],
        "repair_attempts": 0,
        "repair_history": {},
    }

    # Simulate LLM returning a 5-line expansion repair with markdown
    five_line_repair = (
        "Engineered real-time analytics engine with **WebSockets** handling 50k concurrent client streams with sub-second latency "
        "across multiple geographic regions utilizing distributed clustering, partitioned Redis caching, fault-tolerant message brokers, "
        "automated failover mechanisms, continuous load monitoring, and highly optimized database querying protocols."
    )

    class FakeLLMResp:
        content = json.dumps({"bullets": [{"index": 1, "replacement": five_line_repair}]})

    monkeypatch.setattr(
        nodes_mod,
        "invoke_with_fallback",
        AsyncMock(return_value=FakeLLMResp()),
    )
    monkeypatch.setattr(
        nodes_mod,
        "get_prompt_config",
        AsyncMock(return_value=("System prompt", "User prompt {kw_text} {bullet_blocks}")),
    )

    # Note: detect_orphans_in_weasyprint is NOT mocked! WeasyPrint renders real document!
    result = await nodes_mod.orphan_repair_node(state, db=AsyncMock(), gen_id=str(uuid4()))

    # Verification must catch the >2 line regression and roll back to original
    final_bullet = result["experience_draft"][0]["bullet_points"][0]
    assert final_bullet == original_bullet
    assert result["repair_history"] == {}


@pytest.mark.asyncio
async def test_orphan_repair_node_real_weasyprint_clean_expansion_kept(monkeypatch):
    """(1) Real WeasyPrint verification keeps a clean expansion that stays <=2 lines."""
    original_bullet = (
        "Engineered real-time analytics engine with WebSockets handling 50k concurrent client streams with sub-second latency."
    )
    # Moderate expansion that completes line 2 without spilling onto line 3
    clean_expansion = (
        "Engineered real-time **analytics engine** with **WebSockets** handling 50k concurrent client streams with sub-second latency in production."
    )

    state = {
        "template_id": "personal-classic",
        "template_manifest": {
            "id": "personal-classic",
            "target_pages": 1,
            "max_font_size": 10.0,
            "page_margin_mm": 15.0,
        },
        "profile": {"full_name": "Test User", "email": "test@example.com"},
        "page_count": 1,
        "font_size": 10.0,
        "experience_draft": [
            {
                "role": "Senior Backend Engineer",
                "organization": "Acme Corp",
                "bullet_points": [original_bullet],
            }
        ],
        "projects_draft": [],
        "extracurriculars_draft": [],
        "keywords": ["Python"],
        "orphans": [
            {
                "fix_type": "expand",
                "section": "experience",
                "text": original_bullet,
                "renderedLines": 2,
                "lastLineFillPercent": 34.5,
                "minimumLastLineFill": 75,
            }
        ],
        "repair_attempts": 0,
        "repair_history": {},
    }

    class FakeLLMResp:
        content = json.dumps({"bullets": [{"index": 1, "replacement": clean_expansion}]})

    monkeypatch.setattr(
        nodes_mod,
        "invoke_with_fallback",
        AsyncMock(return_value=FakeLLMResp()),
    )
    monkeypatch.setattr(
        nodes_mod,
        "get_prompt_config",
        AsyncMock(return_value=("System prompt", "User prompt {kw_text} {bullet_blocks}")),
    )

    result = await nodes_mod.orphan_repair_node(state, db=AsyncMock(), gen_id=str(uuid4()))

    final_bullet = result["experience_draft"][0]["bullet_points"][0]
    assert final_bullet == clean_expansion
    assert len(result["repair_history"]) == 1


@pytest.mark.asyncio
async def test_replacement_propagates_creativity_mode_to_repair_state(monkeypatch):
    """(3) retailor_resume_with_project propagates active creativity_mode to replacement repair state."""
    from langchain_core.runnables import Runnable

    mock_db = AsyncMock()
    captured_repair_states = []

    async def mock_repair(repair_state, db, gen_id):
        captured_repair_states.append(repair_state)
        return {"projects_draft": repair_state["projects_draft"]}

    monkeypatch.setattr(
        "src.services.resume_retailor.orphan_repair_node",
        mock_repair,
    )
    monkeypatch.setattr(
        "src.services.resume_retailor.get_prompt_config",
        AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")),
    )

    class PassthroughRunnable(Runnable):
        def __init__(self, batch):
            self.batch = batch
        def invoke(self, *a, **k):
            return self.batch
        async def ainvoke(self, *a, **k):
            return self.batch

    for mode in ("proper", "larp", "super_larp"):
        captured_repair_states.clear()

        mock_gen = MagicMock()
        mock_gen.id = uuid4()
        mock_gen.template_id = "personal-classic"
        mock_gen.section_order = ["projects"]
        mock_gen.job_title = "Backend Engineer"
        mock_gen.company = "Acme"
        mock_gen.job_description = "API dev"
        mock_gen.keywords = ["Python"]
        mock_gen.render_metadata = {}
        mock_gen.creativity_mode = mode

        new_proj = MagicMock()
        new_proj.name = "Candidate Project"
        new_proj.description = "Candidate description"
        new_proj.technologies = ["Python"]
        new_proj.bullet_points = [
            "Built distributed caching layer with consistent hashing cutting p95 latency across multiple regions significantly for high throughput workloads."
        ]
        new_proj.github_url = None
        new_proj.live_url = None
        new_proj.start_date = None
        new_proj.end_date = None

        tailored_batch = TailoredProjectBatch(
            entries=[
                TailoredProject(
                    name="Candidate Project",
                    project_summary="Caching",
                    description="Desc",
                    technologies=["Python"],
                    bullet_points=[
                        "Built distributed caching layer with consistent hashing cutting p95 latency across multiple regions significantly for high throughput workloads."
                    ],
                )
            ]
        )

        monkeypatch.setattr(
            "src.services.resume_retailor._structured",
            lambda llm, schema, prompt: PassthroughRunnable(tailored_batch),
        )

        result = await retailor_resume_with_project(
            db=mock_db,
            gen=mock_gen,
            target_project_index=0,
            new_project=new_proj,
            current_resume={"projects": [{"name": "Old", "bullet_points": ["Old"]}]},
            profile_data={"full_name": "Test User", "email": "test@example.com"},
        )

        assert len(captured_repair_states) == 1, f"Expected 1 repair pass for mode {mode}"
        assert captured_repair_states[0]["creativity_mode"] == mode, (
            f"Expected creativity_mode '{mode}' in repair_state, got '{captured_repair_states[0].get('creativity_mode')}'"
        )


@pytest.mark.asyncio
async def test_description_only_project_visible_on_fallback_both_templates_and_replacement(monkeypatch):
    """(1) Ensure source project description remains visible when no bullets and LLM fallback occurs,

    preserving evidence without inventing fake achievement bullets; test real production render on both templates.
    """
    import copy
    from src.pipeline.nodes import InferenceExhausted

    profile = {"full_name": "Test Candidate", "email": "candidate@example.com"}
    current_resume = {
        "projects": [{"name": "Old Project", "bullet_points": ["Old bullet"]}],
        "experiences": [],
        "education": [],
        "skills": {"Languages": ["Rust"]},
    }

    # Description-only candidate project (no bullets)
    new_proj = MagicMock()
    new_proj.name = "Realtime Analytics Engine"
    new_proj.description = "Custom ClickHouse pipeline processing 10k events per second across multi-region clusters."
    new_proj.technologies = ["Rust", "ClickHouse"]
    new_proj.bullet_points = []
    new_proj.github_url = "https://github.com/candidate/engine"
    new_proj.live_url = None
    new_proj.start_date = None
    new_proj.end_date = None

    # Test both templates
    for tmpl_id in ["personal-classic", "professional-sans"]:
        mock_db = AsyncMock()
        mock_gen = MagicMock()
        mock_gen.id = uuid4()
        mock_gen.template_id = tmpl_id
        mock_gen.section_order = ["projects"]
        mock_gen.job_title = "Data Platform Engineer"
        mock_gen.company = "BigData Co"
        mock_gen.job_description = "High scale data pipelines"
        mock_gen.keywords = ["Rust", "ClickHouse"]
        mock_gen.render_metadata = {}
        mock_gen.creativity_mode = "proper"

        # LLM tailoring fails, triggering retries and exhausted fallback
        async def mock_invoke(*args, **kwargs):
            raise InferenceExhausted("All LLM routes failed")

        monkeypatch.setattr("src.services.resume_retailor.get_prompt_config", AsyncMock(return_value=("Prompt", "User")))
        monkeypatch.setattr("src.services.resume_retailor.invoke_with_fallback", mock_invoke)

        result = await retailor_resume_with_project(
            db=mock_db,
            gen=mock_gen,
            target_project_index=0,
            new_project=new_proj,
            current_resume=current_resume,
            profile_data=profile,
        )

        assert result["fallback_used"] is True
        proj = result["tailored_resume"]["projects"][0]
        assert proj["name"] == "Realtime Analytics Engine"
        # Preserves evidence without inventing fake achievement bullets
        assert proj["bullet_points"] == []
        assert proj["description"] == "Custom ClickHouse pipeline processing 10k events per second across multi-region clusters."

        # Real production render check (WeasyPrint HTML + layout)
        html = render_resume_html(
            template_id=tmpl_id,
            profile=profile,
            resume=result["tailored_resume"],
            font_size=10.0,
            page_margin_mm=14.0,
        )
        assert "Custom ClickHouse pipeline processing 10k events per second" in html
        doc = HTML(string=html).render()
        assert len(doc.pages) >= 1


@pytest.mark.asyncio
async def test_replacement_orphans_repaired_stable_identity_does_not_count_still_orphaned_bullet(monkeypatch):
    """(2) replacement orphans_repaired counts remaining findings by stable target bullet identity/current text

    so a still-orphaned rewritten bullet is NOT counted as repaired.
    """
    import copy
    from langchain_core.runnables import Runnable

    mock_db = AsyncMock()
    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.template_id = "personal-classic"
    mock_gen.section_order = ["projects"]
    mock_gen.job_title = "Backend Engineer"
    mock_gen.company = "Acme"
    mock_gen.job_description = "API"
    mock_gen.keywords = ["Python"]
    mock_gen.render_metadata = {}
    mock_gen.creativity_mode = "proper"

    new_proj = MagicMock()
    new_proj.name = "Project Beta"
    new_proj.description = "Desc"
    new_proj.technologies = ["Python"]
    initial_bullet = "Initial bullet with orphan wrap text that causes an orphan finding."
    new_proj.bullet_points = [initial_bullet]
    new_proj.github_url = None
    new_proj.live_url = None
    new_proj.start_date = None
    new_proj.end_date = None

    current_resume = {"projects": [{"name": "Old", "bullet_points": ["Old"]}]}

    # Return initial tailored batch
    tailored_batch = TailoredProjectBatch(
        entries=[
            TailoredProject(
                name="Project Beta",
                project_summary="Dev",
                description="Desc",
                technologies=["Python"],
                bullet_points=[initial_bullet],
            )
        ]
    )

    class PassthroughRunnable(Runnable):
        def invoke(self, *a, **k):
            return tailored_batch
        async def ainvoke(self, *a, **k):
            return tailored_batch

    monkeypatch.setattr("src.services.resume_retailor._structured", lambda *a, **k: PassthroughRunnable())
    monkeypatch.setattr("src.services.resume_retailor.get_prompt_config", AsyncMock(return_value=("Prompt", "User")))

    # Case A: Rewritten bullet is STILL an orphan (e.g. rewritten to a different text that also has an orphan)
    rewritten_bullet_with_orphan = "Rewritten bullet with a short trailing orphan line."

    detect_call_count = [0]
    def mock_detect(*args, **kwargs):
        detect_call_count[0] += 1
        if detect_call_count[0] == 1:
            # First detect: initial bullet has orphan
            return {
                "success": True,
                "orphans": [{"text": initial_bullet, "renderedLines": 2, "section": "projects"}],
                "font_size": 10.0,
                "page_count": 1,
                "fits_target": True,
            }
        else:
            # Second detect: rewritten bullet STILL has orphan!
            return {
                "success": True,
                "orphans": [{"text": rewritten_bullet_with_orphan, "renderedLines": 2, "section": "projects"}],
                "font_size": 10.0,
                "page_count": 1,
                "fits_target": True,
            }

    async def mock_orphan_repair(repair_state, db, gen_id):
        # Rewrites bullet to rewritten_bullet_with_orphan
        projs = copy.deepcopy(repair_state["projects_draft"])
        projs[0]["bullet_points"][0] = rewritten_bullet_with_orphan
        return {"projects_draft": projs}

    monkeypatch.setattr("src.services.resume_retailor.detect_resume_orphans", mock_detect)
    monkeypatch.setattr("src.services.resume_retailor.orphan_repair_node", mock_orphan_repair)

    res_still_orphaned = await retailor_resume_with_project(
        db=mock_db,
        gen=mock_gen,
        target_project_index=0,
        new_project=new_proj,
        current_resume=current_resume,
        profile_data={},
    )
    assert res_still_orphaned["orphans_detected"] == 1
    # MUST NOT be counted repaired because the rewritten bullet is still an orphan!
    assert res_still_orphaned["orphans_repaired"] == 0

    # Case B: Rewritten bullet is successfully repaired (clean, no orphan in second detect)
    detect_call_count[0] = 0
    clean_rewritten_bullet = "Rewritten bullet that is cleanly balanced across two full lines."

    def mock_detect_clean(*args, **kwargs):
        detect_call_count[0] += 1
        if detect_call_count[0] == 1:
            return {
                "success": True,
                "orphans": [{"text": initial_bullet, "renderedLines": 2, "section": "projects"}],
                "font_size": 10.0,
                "page_count": 1,
                "fits_target": True,
            }
        else:
            return {
                "success": True,
                "orphans": [],
                "font_size": 10.0,
                "page_count": 1,
                "fits_target": True,
            }

    async def mock_orphan_repair_clean(repair_state, db, gen_id):
        projs = copy.deepcopy(repair_state["projects_draft"])
        projs[0]["bullet_points"][0] = clean_rewritten_bullet
        return {"projects_draft": projs}

    monkeypatch.setattr("src.services.resume_retailor.detect_resume_orphans", mock_detect_clean)
    monkeypatch.setattr("src.services.resume_retailor.orphan_repair_node", mock_orphan_repair_clean)

    res_clean = await retailor_resume_with_project(
        db=mock_db,
        gen=mock_gen,
        target_project_index=0,
        new_project=new_proj,
        current_resume=current_resume,
        profile_data={},
    )
    assert res_clean["orphans_detected"] == 1
    assert res_clean["orphans_repaired"] == 1


def test_detector_targets_bullets_only_and_classifies_by_dom_context_both_templates():
    """(3) detector targets actual bullets only (excludes summary paragraphs) and derives

    section classification from DOM section context; tested on real WeasyPrint render for both templates.
    """
    profile = {"full_name": "Test User", "email": "user@example.com"}
    resume = {
        # Summary paragraph that wraps onto 2 lines with a short final line
        "summary": "Senior software engineer with deep specialization in distributed backend services and infrastructure optimization for real-time scale systems.",
        "experiences": [
            {
                "role": "Staff Engineer",
                "organization": "Platform Inc",
                "bullet_points": [
                    # Bullet containing "project" and "tech", but located in EXPERIENCE section
                    "Led cross-functional project and tech modernization initiative migrating monolith to Kubernetes microservices.",
                ],
            }
        ],
        "projects": [
            {
                "name": "Distributed KV Store",
                "bullet_points": [
                    # Bullet in PROJECTS section that does not contain the word "project"
                    "Implemented Raft consensus algorithm in Go with automated leader election and snapshot compaction.",
                ],
            }
        ],
        "education": [],
        "skills": {"Languages": ["Go", "Python"]},
    }

    for tmpl_id in ["personal-classic", "professional-sans"]:
        html = render_resume_html(
            template_id=tmpl_id,
            profile=profile,
            resume=resume,
            font_size=10.0,
            page_margin_mm=14.0,
        )
        assert html is not None
        doc = HTML(string=html).render()
        orphans = detect_orphans_in_weasyprint(doc)

        # 1. Summary paragraph is NOT reported as an orphan bullet
        summary_orphans = [o for o in orphans if "Senior software engineer" in o["text"]]
        assert len(summary_orphans) == 0, f"Summary was mistakenly reported as an orphan bullet in {tmpl_id}"

        # 2. Section classification is derived from DOM section context
        for o in orphans:
            if "monolith to Kubernetes" in o["text"]:
                assert o["section"] == "experience", f"Experience bullet misclassified in {tmpl_id}: {o['section']}"
            elif "Raft consensus" in o["text"]:
                assert o["section"] == "projects", f"Project bullet misclassified in {tmpl_id}: {o['section']}"


@pytest.mark.asyncio
async def test_orphan_repair_prompt_creativity_mode_semantics_across_templates(monkeypatch):
    """(4) Personal-classic and professional-sans apply explicit correct creativity mode semantics in orphan repair:

    Proper mode retains factual/supported technical constraints; LARP/super_larp allows embellishment
    without restrictive proper-only language, verified by capturing the real prompts.
    """
    from src.pipeline.nodes import _professional_sans_policy, orphan_repair_node

    for tmpl_id in ["personal-classic", "professional-sans"]:
        for mode in ["proper", "larp", "super_larp"]:
            mock_db = AsyncMock()
            bullet_text = "Built distributed caching layer with consistent hashing cutting p95 latency across multiple regions significantly for high throughput workloads."
            state = {
                "template_id": tmpl_id,
                "template_manifest": {"id": tmpl_id, "target_pages": 1, "max_font_size": 10.0},
                "section_order": ["projects"],
                "projects_draft": [{"name": "Cache", "bullet_points": [bullet_text]}],
                "experience_draft": [],
                "extracurriculars_draft": [],
                "orphans": [{"text": bullet_text, "fix_type": "expand", "minimumLastLineFill": 75, "lastLineFillPercent": 40}],
                "keywords": ["Python"],
                "repair_attempts": 0,
                "repair_history": {},
                "creativity_mode": mode,
                "profile": {"full_name": "Test User", "email": "test@example.com"},
            }

            captured_messages = []
            async def mock_invoke(chain_factory, invoke_args, **kwargs):
                if isinstance(invoke_args, list):
                    captured_messages.extend(invoke_args)
                mock_msg = MagicMock()
                mock_msg.content = json.dumps({"bullets": [{"index": 1, "replacement": bullet_text}]})
                return mock_msg

            captured_prompt_config = []
            async def mock_get_prompt_config(db, name, default_system, default_user):
                captured_prompt_config.append((name, default_system, default_user))
                return default_system, default_user

            monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", mock_invoke)
            monkeypatch.setattr("src.pipeline.nodes.get_prompt_config", mock_get_prompt_config)
            monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())

            await orphan_repair_node(state, mock_db, str(uuid4()))

            assert len(captured_prompt_config) == 1
            config_name, sys_prompt, usr_prompt = captured_prompt_config[0]
            policy = _professional_sans_policy(state, "orphan_repair")
            assert len(captured_messages) == 2
            full_prompt = f"{captured_messages[0].content}\n{captured_messages[1].content}"

            if mode in ("larp", "super_larp"):
                assert config_name == f"orphan_repair_{mode}"
                assert "LARP MODE" in full_prompt
                assert "embellish freely" in full_prompt
                # Restrictive proper-only language must NOT be present
                assert "supported technical detail" not in full_prompt
                assert "Add truthful" not in full_prompt
                assert "Never invent facts or drop factual claims" not in full_prompt
                if tmpl_id == "professional-sans":
                    assert "Preserves active LARP/Super-LARP mode rules above without restricting embellishment." in policy
            else:
                assert config_name == "orphan_repair"
                assert "supported technical detail" in full_prompt
                assert "Add truthful" in full_prompt
                assert "Preserve meaning and truth" in full_prompt
                assert "LARP MODE" not in full_prompt
                if tmpl_id == "professional-sans":
                    assert "Never invent facts or drop factual claims" in policy
