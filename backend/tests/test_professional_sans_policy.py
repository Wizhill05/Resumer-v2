import copy
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from src.core.config import settings
from src.pipeline.nodes import (
    InferenceExhausted,
    InvalidStructuredOutput,
    _apply_professional_sans_skill_budget,
    _ensure_jd_skill_coverage,
    _professional_sans_policy,
    content_reduction_node,
    experience_node,
    orphan_repair_node,
    project_node,
)
from src.schemas.pipeline import (
    TailoredExperience,
    TailoredExperienceBatch,
    TailoredProject,
    TailoredProjectBatch,
)
from src.services.resume_render import render_resume_html
from src.services.resume_retailor import retailor_resume_with_project


@pytest.mark.parametrize(
    "section",
    ["summary", "experience", "project", "synthetic_project", "orphan_repair", "extracurricular"],
)
def test_template_policy_is_specific_to_professional_sans(section):
    assert _professional_sans_policy({"template_manifest": {"id": "personal-classic"}}, section) == ""
    assert _professional_sans_policy("personal-classic", section) == ""
    policy = _professional_sans_policy({"template_manifest": {"id": "professional-sans"}}, section)
    assert "overrides conflicting" in policy
    policy_str = _professional_sans_policy("professional-sans", section)
    assert policy == policy_str


def test_entry_policies_match_measured_bullet_budget():
    state = {"template_manifest": {"id": "professional-sans"}}
    for section in ("experience", "project", "synthetic_project"):
        policy = _professional_sans_policy(state, section)
        assert "at most two" in policy
        assert "exactly two distinct supported achievement bullets" in policy
        assert "185 characters" in policy
        assert "18–23 words" in policy
        assert "restrained bold emphasis" in policy


def test_summary_and_extracurricular_policies():
    state = {"template_manifest": {"id": "professional-sans"}}
    sum_pol = _professional_sans_policy(state, "summary")
    assert "at most 30 words" in sum_pol
    assert "at most 4 categories" in sum_pol
    assert "20 concise skills" in sum_pol
    assert "300 characters" in sum_pol

    extra_pol = _professional_sans_policy(state, "extracurricular")
    assert "at most one" in extra_pol
    assert "20 words" in extra_pol

    orphan_pol = _professional_sans_policy(state, "orphan_repair")
    assert "Arial A4" in orphan_pol
    assert "1.4 line-height" in orphan_pol
    assert "185 characters" in orphan_pol
    assert "2 lines maximum" in orphan_pol


@pytest.mark.parametrize("mode", ["proper", "larp", "super_larp"])
def test_policy_appended_after_stale_db_prompts_across_modes(mode):
    stale_db_sys = (
        "ROLE: Senior writer.\n"
        "RULES:\n"
        "- bullet_points: 2-3 concise achievement bullets (hard limit: never more than 3).\n"
        "- Line-fit: fill 1.75-1.95 rendered lines.\n"
        "- Bold every number, statistic, percentage, metric, and key technology with markdown asterisks."
    )
    if mode == "proper":
        stale_db_sys += "\n- Strict truth: do not invent employers or metrics."
    else:
        stale_db_sys += "\n- LARP MODE: embellish freely within role."

    state = {
        "template_manifest": {"id": "professional-sans"},
        "creativity_mode": mode,
    }
    policy = _professional_sans_policy(state, "experience")
    combined = stale_db_sys + policy

    assert combined.endswith(policy)
    assert "PROFESSIONAL SANS LAYOUT POLICY v1 (overrides conflicting" in combined
    assert "at most two bullets" in combined
    if mode == "proper":
        assert "Strict truth" in combined
    else:
        assert "LARP MODE" in combined


def test_skills_postprocessing_respects_budget_in_professional_sans():
    skills = {
        "Languages": ["Python", "TypeScript", "Go", "Rust", "SQL"],
        "Backend": ["FastAPI", "PostgreSQL", "Redis", "Kafka", "Docker"],
        "Cloud": ["AWS", "Kubernetes", "Terraform", "CI/CD"],
        "Tools": ["Git", "Linux", "Grafana", "Prometheus"],
        "ExtraCategory": ["Should be dropped in professional-sans"],
    }
    jd_skills = [f"Skill{i}" for i in range(15)]

    # In professional-sans: clamps to 4 categories and <= 20 skills / 320 chars
    ps_skills = _ensure_jd_skill_coverage(
        copy.deepcopy(skills), jd_skills, mode="larp", template_id="professional-sans"
    )
    assert len(ps_skills) <= 4
    total_skills = sum(len(items) for items in ps_skills.values())
    total_chars = sum(len(item) for items in ps_skills.values() for item in items)
    assert total_skills <= 20
    assert total_chars <= 320

    # In personal-classic: unconstrained, keeps all categories and injects up to 15 missing
    pc_skills = _ensure_jd_skill_coverage(
        copy.deepcopy(skills), jd_skills, mode="larp", template_id="personal-classic"
    )
    assert len(pc_skills) == 5
    assert sum(len(items) for items in pc_skills.values()) > 20


@pytest.mark.asyncio
async def test_experience_preserves_authoritative_fields_and_null_dates(monkeypatch):
    mock_db = AsyncMock()
    original_batch = [
        {
            "role": "Lead Architect",
            "organization": "Authoritative Org Inc",
            "location": "San Francisco, CA",
            "start_date": "2022-01-01",
            "end_date": None,  # Current role: MUST remain None
            "bullet_points": ["Original bullet 1", "Original bullet 2"],
        },
        {
            "role": "Senior Engineer",
            "organization": "Prior Co",
            "location": "New York, NY",
            "start_date": "2020-01-01",
            "end_date": "2021-12-31",
            "bullet_points": ["Prior bullet 1"],
        },
    ]
    state = {
        "experiences": original_batch,
        "content_split": {"experience": 2},
        "template_manifest": {"id": "professional-sans", "max_bullets_per_experience": 2},
        "job_analysis": {"job_title": "Target Role", "key_requirements": ["Python"]},
        "is_pro": False,
    }

    # Model returns rewritten roles/dates and 3 bullets
    fake_model_entries = [
        TailoredExperience(
            role="Altered Role Title",
            organization="Altered Company",
            location="Remote",
            start_date="2022-05-01",
            end_date="2024-01-01",  # Overwrite attempt
            bullet_points=["Rewritten bullet 1", "Rewritten bullet 2", "Rewritten bullet 3"],
        )
    ]
    fake_batch = TailoredExperienceBatch(entries=fake_model_entries)

    async def fake_invoke(chain_factory, inputs, **kwargs):
        return fake_batch

    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", fake_invoke)
    monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())
    monkeypatch.setattr("src.pipeline.nodes.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))

    result = await experience_node(state, mock_db, str(uuid4()))
    draft = result["experience_draft"]
    assert len(draft) == 2  # Never silently drops 2nd entry

    # Entry 1: authoritative role & organization preserved; null end_date preserved
    assert draft[0]["role"] == "Lead Architect"
    assert draft[0]["organization"] == "Authoritative Org Inc"
    assert draft[0]["start_date"] == "2022-01-01"
    assert draft[0]["end_date"] is None
    assert len(draft[0]["bullet_points"]) == 2  # Clamped to max_bullets

    # Entry 2: fallback preserved original entry
    assert draft[1]["role"] == "Senior Engineer"
    assert draft[1]["organization"] == "Prior Co"


@pytest.mark.asyncio
async def test_project_preserves_links_and_names(monkeypatch):
    mock_db = AsyncMock()
    original_projects = [
        {
            "name": "Distributed Cache",
            "project_summary": "In-memory caching layer",
            "description": "High performance caching engine",
            "technologies": ["Go", "Redis"],
            "github_url": "https://github.com/example/cache",
            "live_url": "https://cache.example.com",
            "start_date": "2021-01-01",
            "end_date": None,
            "bullet_points": ["Built distributed hash ring"],
        }
    ]
    state = {
        "projects": original_projects,
        "content_split": {"projects": 1},
        "template_manifest": {"id": "professional-sans", "max_bullets_per_project": 2},
        "job_analysis": {"job_title": "Backend Role"},
        "creativity_mode": "proper",
        "is_pro": False,
    }

    fake_model_entries = [
        TailoredProject(
            name="Different Cache Name",
            project_summary="Fast Cache",
            description="Replaced description",
            technologies=["Go", "Redis", "gRPC"],
            bullet_points=["Optimized memory allocation"],
        )
    ]
    fake_batch = TailoredProjectBatch(entries=fake_model_entries)

    async def fake_invoke(chain_factory, inputs, **kwargs):
        return fake_batch

    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", fake_invoke)
    monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())
    monkeypatch.setattr("src.pipeline.nodes.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))

    result = await project_node(state, mock_db, str(uuid4()))
    p_draft = result["projects_draft"][0]
    assert p_draft["name"] == "Distributed Cache"  # Preserved original name
    assert p_draft["github_url"] == "https://github.com/example/cache"
    assert p_draft["live_url"] == "https://cache.example.com"
    assert p_draft["end_date"] is None


@pytest.mark.asyncio
async def test_retailor_resume_appends_policy_and_preserves_metadata(monkeypatch):
    mock_db = AsyncMock()
    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.template_id = "professional-sans"
    mock_gen.render_metadata = {}
    mock_gen.job_title = "ML Engineer"
    mock_gen.company = "OpenOrg"
    mock_gen.job_description = "Job description"
    mock_gen.keywords = ["Python"]
    mock_gen.section_order = None

    mock_project = MagicMock()
    mock_project.name = "New Proj"
    mock_project.description = "New Proj Desc"
    mock_project.technologies = ["Python"]
    mock_project.bullet_points = ["B1", "B2"]
    mock_project.github_url = "https://github.com/example/new"
    mock_project.live_url = None
    mock_project.start_date = None
    mock_project.end_date = None

    current_resume = {
        "projects": [
            {
                "name": "Existing P1",
                "github_url": "https://github.com/example/p1",
                "bullet_points": ["B1", "B2"],
            }
        ]
    }

    invoked_prompts = []

    async def fake_invoke(chain_factory, inputs, **kwargs):
        return TailoredProjectBatch(
            entries=[
                TailoredProject(
                    name="Tailored New Proj",
                    project_summary="ML Service",
                    description="Tailored Desc",
                    technologies=["Python"],
                    bullet_points=["New B1", "New B2"],
                )
            ]
        )

    monkeypatch.setattr("src.services.resume_retailor.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))
    monkeypatch.setattr("src.services.resume_retailor.invoke_with_fallback", fake_invoke)
    monkeypatch.setattr("src.services.resume_retailor._safe_log_progress", AsyncMock())
    monkeypatch.setattr(
        "src.services.resume_retailor.detect_resume_orphans",
        lambda **kwargs: {"orphans": [], "fits_target": True, "font_size": 10.0, "page_count": 1},
    )

    result = await retailor_resume_with_project(
        db=mock_db,
        gen=mock_gen,
        target_project_index=0,
        new_project=mock_project,
        current_resume=current_resume,
        profile_data={"full_name": "Test Candidate"},
    )
    assert result["fit_warning"] is False
    assert len(result["tailored_resume"]["projects"]) == 1
    assert result["tailored_resume"]["projects"][0]["name"] == "New Proj"
    assert result["tailored_resume"]["projects"][0]["github_url"] == "https://github.com/example/new"


@pytest.mark.asyncio
async def test_professional_sans_overflow_avoids_bullet_deletion(monkeypatch):
    mock_db = AsyncMock()
    experiences = [
        {"role": "R1", "bullet_points": ["B1.1", "B1.2"]},
        {"role": "R2", "bullet_points": ["B2.1", "B2.2"]},
    ]
    projects = [
        {"name": "P1", "bullet_points": ["P1.1", "P1.2"]},
        {"name": "P2", "bullet_points": ["P2.1", "P2.2"]},
    ]

    # Professional Sans: preserves all bullets without deletion
    ps_state = {
        "template_manifest": {"id": "professional-sans", "target_pages": 1},
        "experience_draft": copy.deepcopy(experiences),
        "projects_draft": copy.deepcopy(projects),
        "content_reduction_step": 0,
        "tailored_resume": {"experiences": experiences, "projects": projects},
    }
    monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())

    ps_res = await content_reduction_node(ps_state, mock_db, str(uuid4()))
    # Both experiences still have 2 bullets! No bullets popped!
    assert len(ps_res["experience_draft"][1]["bullet_points"]) == 2
    assert len(ps_res["projects_draft"][1]["bullet_points"]) == 2
    assert ps_res["content_reduction_step"] == 2

    # Personal Classic: pops bullet from 2nd experience on step 0
    pc_state = {
        "template_manifest": {"id": "personal-classic", "target_pages": 1},
        "experience_draft": copy.deepcopy(experiences),
        "projects_draft": copy.deepcopy(projects),
        "content_reduction_step": 0,
    }
    pc_res = await content_reduction_node(pc_state, mock_db, str(uuid4()))
    assert len(pc_res["experience_draft"][1]["bullet_points"]) == 1  # 1 popped
    assert pc_res["content_reduction_step"] == 1


@pytest.mark.asyncio
async def test_orphan_repair_error_rollback(monkeypatch):
    mock_db = AsyncMock()
    orig_bullet = "Initial bullet before repair that needs line fill."
    state = {
        "experience_draft": [{"role": "Eng", "bullet_points": [orig_bullet]}],
        "projects_draft": [],
        "extracurriculars_draft": [],
        "keywords": ["Python"],
        "orphans": [{"fix_type": "expand", "text": orig_bullet, "renderedLines": 2}],
        "repair_attempts": 0,
        "repair_history": {},
        "template_manifest": {"id": "professional-sans"},
    }

    async def faulty_invoke(*args, **kwargs):
        mock_msg = MagicMock()
        mock_msg.content = "Not Valid JSON at all"
        return mock_msg

    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", faulty_invoke)
    monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())
    monkeypatch.setattr("src.pipeline.nodes.get_prompt_config", AsyncMock(return_value=("Prompt", "User")))

    result = await orphan_repair_node(state, mock_db, str(uuid4()))
    # Bullet must be safely rolled back to original
    assert result["experience_draft"][0]["bullet_points"][0] == orig_bullet


def test_typography_code_font_and_contact_spacing():
    style_css = (settings.TEMPLATES_DIR / "professional-sans" / "style.css").read_text(encoding="utf-8")
    assert "code, pre, kbd, samp" in style_css
    assert "Resume Sans" in style_css

    profile = {
        "full_name": "Alex Montgomery",
        "phone": "+1-555-0199",
        "email": "alex@example.com",
        "linkedin_url": "https://linkedin.com/in/alex",
        "github_url": "https://github.com/alex",
    }
    html = render_resume_html(
        template_id="professional-sans",
        profile=profile,
        resume={"summary": "Sample summary", "education": [], "skills": {}, "projects": [], "experiences": []},
        font_size=10.0,
        page_margin_mm=14.0,
    )
    assert html is not None
    assert "+1-555-0199 | <a href=\"mailto:alex@example.com\">alex@example.com</a> | <a href=\"https://linkedin.com/in/alex\">LinkedIn</a> | <a href=\"https://github.com/alex\">GitHub</a>" in html


# ── Regression tests reproducing Sol's review findings ──────────────────────


@pytest.mark.asyncio
async def test_regression_fake_fabricated_compression(monkeypatch):
    """(1) Verify that professional-sans completely disables LLM compression,
    preserving full original content without bullet deletion or compression
    even if an LLM would fabricate facts, advancing content_reduction_step to 2
    and logging a fit warning."""
    mock_db = AsyncMock()
    experiences = [
        {"role": "Lead Architect", "organization": "Real Corp", "bullet_points": ["Real bullet 1", "Real bullet 2"]},
        {"role": "Staff Engineer", "organization": "True Inc", "bullet_points": ["True bullet 1", "True bullet 2"]},
    ]
    projects = [
        {"name": "Actual Cache", "bullet_points": ["Verified metric A", "Verified metric B"]},
    ]
    state = {
        "template_manifest": {"id": "professional-sans", "target_pages": 1},
        "experience_draft": copy.deepcopy(experiences),
        "projects_draft": copy.deepcopy(projects),
        "content_reduction_step": 0,
        "tailored_resume": {"experiences": experiences, "projects": projects},
    }

    # Ensure no LLM invoke is ever called during content reduction for professional-sans
    fake_invoke_called = []

    async def fake_invoke(*args, **kwargs):
        fake_invoke_called.append(True)
        raise RuntimeError("LLM compression should not be called!")

    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", fake_invoke)
    logged_messages = []

    async def fake_log(db, gen_id, node, msg, status="info"):
        logged_messages.append((node, msg, status))

    monkeypatch.setattr("src.pipeline.nodes.log_progress", fake_log)

    result = await content_reduction_node(state, mock_db, str(uuid4()))

    assert len(fake_invoke_called) == 0
    assert result["content_reduction_step"] == 2
    # Full content preserved intact without dropping or fabricating
    assert result["experience_draft"] == experiences
    assert result["projects_draft"] == projects
    assert any("preserving complete content without bullet deletion or compression" in m[1] for m in logged_messages)


@pytest.mark.asyncio
async def test_regression_incomplete_batch_raises_retryable_invalid_structured_output(monkeypatch):
    """(2) Batch validators must raise InvalidStructuredOutput (not plain ValueError)
    when returned entries < batch length, enabling invoke_with_fallback retries, and
    exhausted retries (InferenceExhausted) must fall back to original entries non-destructively."""

    mock_db = AsyncMock()
    original_batch = [
        {"role": "R1", "organization": "O1", "bullet_points": ["B1"]},
        {"role": "R2", "organization": "O2", "bullet_points": ["B2"]},
    ]
    state = {
        "experiences": original_batch,
        "content_split": {"experience": 2},
        "template_manifest": {"id": "professional-sans", "max_bullets_per_experience": 2},
        "job_analysis": {"job_title": "Role"},
        "is_pro": False,
    }

    # 1. Verify validator raises InvalidStructuredOutput on short batch
    captured_validator = []

    async def mock_invoke(chain_factory, inputs, **kwargs):
        v = kwargs.get("validate_result")
        if v:
            captured_validator.append(v)
            # Simulate incomplete batch (1 entry when 2 expected)
            short_res = TailoredExperienceBatch(entries=[TailoredExperience(role="R1", organization="O1", bullet_points=["B1"])])
            with pytest.raises(InvalidStructuredOutput, match="Expected at least 2 experience entries"):
                v(short_res)
        raise InferenceExhausted("Simulated exhausted retries after validation failures")

    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", mock_invoke)
    monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())
    monkeypatch.setattr("src.pipeline.nodes.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))

    # 2. Verify experience_node falls back non-destructively to source batch on InferenceExhausted
    res = await experience_node(state, mock_db, str(uuid4()))
    assert len(captured_validator) == 1
    assert res["experience_draft"] == original_batch

    # 3. Verify project_node also raises InvalidStructuredOutput and falls back on InferenceExhausted
    proj_batch = [
        {"name": "P1", "bullet_points": ["B1"]},
        {"name": "P2", "bullet_points": ["B2"]},
    ]
    proj_state = {
        "projects": proj_batch,
        "content_split": {"projects": 2},
        "template_manifest": {"id": "professional-sans", "max_bullets_per_project": 2},
        "job_analysis": {"job_title": "Role"},
        "creativity_mode": "proper",
        "is_pro": False,
    }
    proj_validator = []

    async def mock_proj_invoke(chain_factory, inputs, **kwargs):
        v = kwargs.get("validate_result")
        if v:
            proj_validator.append(v)
            short_res = TailoredProjectBatch(entries=[TailoredProject(name="P1", bullet_points=["B1"])])
            with pytest.raises(InvalidStructuredOutput, match="Expected at least 2 project entries"):
                v(short_res)
        raise InferenceExhausted("Simulated exhausted retries")

    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", mock_proj_invoke)
    res_proj = await project_node(proj_state, mock_db, str(uuid4()))
    assert len(proj_validator) == 1
    assert res_proj["projects_draft"] == proj_batch


@pytest.mark.asyncio
async def test_regression_replace_project_untouched_projects_three_bullets(monkeypatch):
    """(3) Re-tailoring/replacing a project must preserve untouched projects exactly,
    including manually entered third bullets, restricting rewrite and bullet cap to targeted project only."""
    mock_db = AsyncMock()
    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.template_id = "professional-sans"
    mock_gen.render_metadata = {}
    mock_gen.job_title = "Backend Engineer"
    mock_gen.company = "TechCorp"
    mock_gen.job_description = "Job description"
    mock_gen.keywords = ["Python"]
    mock_gen.section_order = None

    # New project to insert at index 0 (has 3 raw bullets; should be capped to 2 for professional-sans)
    mock_project = MagicMock()
    mock_project.name = "Targeted Project New"
    mock_project.description = "New description"
    mock_project.technologies = ["Python", "FastAPI"]
    mock_project.bullet_points = ["New bullet 1", "New bullet 2", "New bullet 3"]
    mock_project.github_url = "https://github.com/example/new"
    mock_project.live_url = None
    mock_project.start_date = None
    mock_project.end_date = None

    # Current resume has project 0 (to be replaced) and project 1 (untouched, with 3 manual bullets)
    current_resume = {
        "projects": [
            {
                "name": "Old Replaced Project",
                "description": "Old desc",
                "technologies": ["Java"],
                "bullet_points": ["Old B1", "Old B2"],
            },
            {
                "name": "Untouched Project Manual",
                "description": "Manual custom project",
                "technologies": ["Rust", "Wasm"],
                "bullet_points": [
                    "Manual bullet 1",
                    "Manual bullet 2",
                    "Manual bullet 3 (User added - MUST BE PRESERVED!)",
                ],
                "github_url": "https://github.com/example/manual",
            },
        ]
    }

    async def fake_invoke(chain_factory, inputs, **kwargs):
        return TailoredProjectBatch(
            entries=[
                TailoredProject(
                    name="Targeted Project New",
                    project_summary="Cloud Service",
                    description="Tailored new desc",
                    technologies=["Python", "FastAPI"],
                    bullet_points=["Tailored B1", "Tailored B2", "Tailored B3 (to be capped)"],
                )
            ]
        )

    monkeypatch.setattr("src.services.resume_retailor.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))
    monkeypatch.setattr("src.services.resume_retailor.invoke_with_fallback", fake_invoke)
    monkeypatch.setattr("src.services.resume_retailor._safe_log_progress", AsyncMock())
    monkeypatch.setattr(
        "src.services.resume_retailor.detect_resume_orphans",
        lambda **kwargs: {"orphans": [], "fits_target": True, "font_size": 10.0, "page_count": 1},
    )

    result = await retailor_resume_with_project(
        db=mock_db,
        gen=mock_gen,
        target_project_index=0,
        new_project=mock_project,
        current_resume=current_resume,
        profile_data={"full_name": "Test Candidate"},
    )

    projects_out = result["tailored_resume"]["projects"]
    assert len(projects_out) == 2

    # Project 0 (targeted): replaced and capped to max_bullets (2)
    assert projects_out[0]["name"] == "Targeted Project New"
    assert len(projects_out[0]["bullet_points"]) == 2
    assert projects_out[0]["bullet_points"] == ["Tailored B1", "Tailored B2"]

    # Project 1 (untouched): PRESERVED EXACTLY INCLUDING ALL 3 BULLETS!
    assert projects_out[1]["name"] == "Untouched Project Manual"
    assert len(projects_out[1]["bullet_points"]) == 3
    assert projects_out[1]["bullet_points"][2] == "Manual bullet 3 (User added - MUST BE PRESERVED!)"
    assert projects_out[1]["github_url"] == "https://github.com/example/manual"


def test_regression_long_unbroken_tokens_wrapping_and_overflow_detection():
    """(4) Long unbroken body/skills/bullet strings wrap safely via overflow-wrap: anywhere;
    when wrapping cannot prevent horizontal overflow, check_horizontal_overflow flags it,
    and fit_and_render_pdf / detect_resume_orphans flags fits_target=False."""
    from src.services.resume_render import check_horizontal_overflow

    style_css = (settings.TEMPLATES_DIR / "professional-sans" / "style.css").read_text(encoding="utf-8")
    assert "overflow-wrap: anywhere;" in style_css
    for selector in ["body", "code, pre, kbd, samp", "h1", "h2", "p, dl, dd", "dt", "li", ".skills-table td"]:
        assert selector in style_css

    # Check horizontal overflow detection logic with mock box tree
    class MockBox:
        def __init__(self, position_x, width, name="TextBox"):
            self.position_x = position_x
            self.width = width
            self.__class__.__name__ = name

    class MockPageBox:
        def __init__(self, boxes):
            self._boxes = boxes

        def descendants(self):
            return iter(self._boxes)

    class MockPage:
        def __init__(self, width, boxes):
            self.width = width
            self._page_box = MockPageBox(boxes)

    class MockDoc:
        def __init__(self, pages):
            self.pages = pages

    # A4 width in px at 96dpi is 210mm * 96 / 25.4 = ~793.7 px. 14mm margin = ~52.91 px.
    # Right bound = 793.7 - 52.91 = 740.79 px.
    # Normal box within bounds:
    normal_doc = MockDoc([MockPage(793.7, [MockBox(60.0, 500.0)])])
    assert check_horizontal_overflow(normal_doc, page_margin_mm=14.0) is False

    # Overflowing box extending past right bound:
    overflow_doc = MockDoc([MockPage(793.7, [MockBox(60.0, 700.0)])])
    assert check_horizontal_overflow(overflow_doc, page_margin_mm=14.0) is True

    # Underflow box starting before left margin:
    left_overflow_doc = MockDoc([MockPage(793.7, [MockBox(20.0, 100.0)])])
    assert check_horizontal_overflow(left_overflow_doc, page_margin_mm=14.0) is True


def test_regression_layout_policy_all_creativity_modes():
    """(5) Layout policy must not impose evidence-only semantics on larp/super_larp;
    don't conflict with their pre-existing behavior."""
    manifest = {"id": "professional-sans"}

    proper_policy = _professional_sans_policy({"template_manifest": manifest, "creativity_mode": "proper"}, "experience")
    assert "never invent or pad" in proper_policy
    assert "supported achievement bullets" in proper_policy

    proper_summary = _professional_sans_policy({"template_manifest": manifest, "creativity_mode": "proper"}, "summary")
    assert "without inventing keywords" in proper_summary

    for larp_mode in ["larp", "super_larp"]:
        larp_policy = _professional_sans_policy({"template_manifest": manifest, "creativity_mode": larp_mode}, "experience")
        assert "never invent or pad" not in larp_policy
        assert "without inventing keywords" not in larp_policy
        assert "supported achievement bullets" not in larp_policy
        assert "Preserves active LARP/Super-LARP mode rules above without restricting embellishment." in larp_policy
        # Still strictly enforces layout length bounds
        assert "at most two bullets" in larp_policy
        assert "185 characters" in larp_policy
        assert "18–23 words" in larp_policy

        larp_proj = _professional_sans_policy({"template_manifest": manifest, "creativity_mode": larp_mode}, "project")
        assert "never invent or pad" not in larp_proj
        assert "supported achievement bullets" not in larp_proj
        assert "at most two bullets" in larp_proj
        assert "185 characters" in larp_proj


@pytest.mark.asyncio
async def test_regression_null_dates_preserved_authoritatively(monkeypatch):
    """(6) Preserve source start/end dates exactly including None; no model-invented dates."""
    mock_db = AsyncMock()
    # Source with null start_date and null end_date
    source_exps = [
        {
            "role": "Founder",
            "organization": "Stealth",
            "start_date": None,
            "end_date": None,
            "bullet_points": ["Bootstrapped prototype"],
        }
    ]
    state_exp = {
        "experiences": source_exps,
        "content_split": {"experience": 1},
        "template_manifest": {"id": "professional-sans", "max_bullets_per_experience": 2},
        "job_analysis": {"job_title": "Founder"},
        "is_pro": False,
    }

    # Model attempts to invent dates
    fake_exp_batch = TailoredExperienceBatch(
        entries=[
            TailoredExperience(
                role="Founder",
                organization="Stealth",
                start_date="2020-01-01",
                end_date="2024-01-01",
                bullet_points=["Bootstrapped prototype"],
            )
        ]
    )
    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", AsyncMock(return_value=fake_exp_batch))
    monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())
    monkeypatch.setattr("src.pipeline.nodes.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))

    exp_res = await experience_node(state_exp, mock_db, str(uuid4()))
    assert exp_res["experience_draft"][0]["start_date"] is None
    assert exp_res["experience_draft"][0]["end_date"] is None

    # Source project with null dates
    source_projs = [
        {
            "name": "Side Project",
            "start_date": None,
            "end_date": None,
            "bullet_points": ["Built CLI"],
        }
    ]
    state_proj = {
        "projects": source_projs,
        "content_split": {"projects": 1},
        "template_manifest": {"id": "professional-sans", "max_bullets_per_project": 2},
        "job_analysis": {"job_title": "Engineer"},
        "creativity_mode": "proper",
        "is_pro": False,
    }
    fake_proj_batch = TailoredProjectBatch(
        entries=[
            TailoredProject(
                name="Side Project",
                start_date="2021-06-01",
                end_date="2022-06-01",
                bullet_points=["Built CLI"],
            )
        ]
    )
    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", AsyncMock(return_value=fake_proj_batch))
    proj_res = await project_node(state_proj, mock_db, str(uuid4()))
    assert proj_res["projects_draft"][0]["start_date"] is None
    assert proj_res["projects_draft"][0]["end_date"] is None


@pytest.mark.asyncio
async def test_regression_orphan_repair_rollback_on_missing_verification_render(monkeypatch):
    """(7) Roll back orphan repair if verification render is None, and on every verification failure."""
    mock_db = AsyncMock()
    orig_bullet = "Initial bullet to repair that has orphan text."
    state = {
        "experience_draft": [{"role": "Eng", "bullet_points": [orig_bullet]}],
        "projects_draft": [{"name": "Proj", "bullet_points": ["Project bullet unchanged"]}],
        "extracurriculars_draft": [{"title": "Mentor", "bullet_points": ["Mentored"]}],
        "keywords": ["Python"],
        "orphans": [{"fix_type": "expand", "text": orig_bullet, "renderedLines": 2}],
        "repair_attempts": 0,
        "repair_history": {"some_prior": "repair"},
        "template_manifest": {"id": "professional-sans", "target_pages": 1},
        "profile": {"full_name": "Test User"},
    }

    # Simulate LLM returning a valid repair JSON conforming to the expected bullets schema
    mock_msg = MagicMock()
    mock_msg.content = json.dumps({
        "bullets": [
            {
                "index": 1,
                "replacement": "Expanded bullet with extra text to fix orphan line.",
            }
        ]
    })
    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", AsyncMock(return_value=mock_msg))
    monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())
    monkeypatch.setattr("src.pipeline.nodes.get_prompt_config", AsyncMock(return_value=("Prompt", "User")))

    # Case A: Verification render returns None
    class MockHTMLReturningNone:
        def __init__(self, string, base_url):
            pass

        def render(self):
            return None

    monkeypatch.setattr("weasyprint.HTML", MockHTMLReturningNone)
    res_none = await orphan_repair_node(copy.deepcopy(state), mock_db, str(uuid4()))
    assert res_none["experience_draft"][0]["bullet_points"][0] == orig_bullet
    assert res_none["repair_history"] == {"some_prior": "repair"}

    # Case B: Verification render raises an Exception
    class MockHTMLRaisingException:
        def __init__(self, string, base_url):
            pass

        def render(self):
            raise RuntimeError("WeasyPrint crash during layout")

    monkeypatch.setattr("weasyprint.HTML", MockHTMLRaisingException)
    res_err = await orphan_repair_node(copy.deepcopy(state), mock_db, str(uuid4()))
    assert res_err["experience_draft"][0]["bullet_points"][0] == orig_bullet
    assert res_err["repair_history"] == {"some_prior": "repair"}


def test_regression_oversized_existing_skills_budgeted_in_generation_only():
    """(8) Apply consistent professional-sans generation-only skill budgets to both
    existing generated and JD injected skills, max 4 categories, 20 skills, approx 300/320 chars,
    no edits to manual content."""
    oversized_skills = {
        "Languages": ["Python", "TypeScript", "Go", "Rust", "C++", "Java"],
        "Backend Frameworks": ["FastAPI", "Django", "Node.js", "Express", "Spring Boot"],
        "Databases & Caches": ["PostgreSQL", "Redis", "MongoDB", "Elasticsearch", "Cassandra"],
        "DevOps & Cloud": ["AWS", "Kubernetes", "Docker", "Terraform", "CI/CD Actions"],
        "Extra Category 5": ["Kafka", "RabbitMQ", "GraphQL", "gRPC"],
    }
    # Total: 5 categories, 25 skills, length ~350 chars

    # 1. In professional-sans generation-only path:
    budgeted = _apply_professional_sans_skill_budget(copy.deepcopy(oversized_skills))
    assert len(budgeted) <= 4
    assert sum(len(v) for v in budgeted.values()) <= 20
    assert sum(len(item) for v in budgeted.values() for item in v) <= 320

    # 2. _ensure_jd_skill_coverage also enforces the budget on existing skills even with empty JD
    coverage_out = _ensure_jd_skill_coverage(copy.deepcopy(oversized_skills), [], mode="proper", template_id="professional-sans")
    assert len(coverage_out) <= 4
    assert sum(len(v) for v in coverage_out.values()) <= 20
    assert sum(len(item) for v in coverage_out.values() for item in v) <= 320

    # 3. Personal Classic or other templates: unchanged
    pc_out = _ensure_jd_skill_coverage(copy.deepcopy(oversized_skills), [], mode="proper", template_id="personal-classic")
    assert len(pc_out) == 5
    assert sum(len(v) for v in pc_out.values()) == 25

    # 4. Manual editor content: render_resume_html renders all 5 categories without truncation
    html = render_resume_html(
        template_id="professional-sans",
        profile={"full_name": "Test User"},
        resume={"skills": oversized_skills, "summary": "Dev", "experiences": [], "projects": [], "education": []},
        font_size=10.0,
        page_margin_mm=14.0,
    )
    assert "Extra Category 5" in html

    # 5. Oversized 500-char first generated skill is capped to budget and does not bypass limits
    single_500_char_skill = {"Languages": ["X" * 500]}
    budgeted_500 = _apply_professional_sans_skill_budget(copy.deepcopy(single_500_char_skill))
    assert len(budgeted_500) <= 4
    total_chars_500 = sum(len(item) for v in budgeted_500.values() for item in v)
    assert total_chars_500 <= 320
    assert total_chars_500 > 0


@pytest.mark.asyncio
async def test_regression_orphan_repair_parsing_error_restores_repair_history(monkeypatch):
    """(6) Orphan repair parsing error must restore pre-repair history snapshot."""
    mock_db = AsyncMock()
    orig_bullet = "Initial bullet to repair that has orphan text."
    state = {
        "experience_draft": [{"role": "Eng", "bullet_points": [orig_bullet]}],
        "projects_draft": [],
        "extracurriculars_draft": [],
        "keywords": ["Python"],
        "orphans": [{"fix_type": "expand", "text": orig_bullet, "renderedLines": 2}],
        "repair_attempts": 0,
        "repair_history": {"initial_key": "initial_val"},
        "template_manifest": {"id": "professional-sans"},
    }
    mock_msg = MagicMock()
    mock_msg.content = "Malformed { invalid json response"
    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", AsyncMock(return_value=mock_msg))
    monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())
    monkeypatch.setattr("src.pipeline.nodes.get_prompt_config", AsyncMock(return_value=("Prompt", "User")))

    res = await orphan_repair_node(state, mock_db, str(uuid4()))
    assert res["experience_draft"][0]["bullet_points"][0] == orig_bullet
    assert res["repair_history"] == {"initial_key": "initial_val"}


@pytest.mark.asyncio
async def test_regression_empty_blank_bullets_rejected_triggers_retry_and_fallback(monkeypatch):
    """(2) Full-count batches with empty/blank bullets reject when source has evidence and trigger retry/fallback."""
    mock_db = AsyncMock()
    gen_id = str(uuid4())

    # --- Experience node test with real wrapper ---
    source_exps = [
        {"role": "Lead", "organization": "TechCorp", "bullet_points": ["Solid achievement bullet A"]},
        {"role": "Senior", "organization": "DevCo", "bullet_points": ["Solid achievement bullet B"]},
    ]
    state_exp = {
        "experiences": source_exps,
        "content_split": {"experience": 2},
        "template_manifest": {"id": "professional-sans", "max_bullets_per_experience": 2},
        "job_analysis": {"job_title": "Lead"},
        "is_pro": False,
    }

    # Model returns 2 entries (full-count batch) but with empty/blank bullets!
    empty_exp_batch = TailoredExperienceBatch(
        entries=[
            TailoredExperience(role="Lead", organization="TechCorp", bullet_points=["   ", ""]),
            TailoredExperience(role="Senior", organization="DevCo", bullet_points=[]),
        ]
    )

    invoke_attempts = []
    real_chain = MagicMock()
    real_chain.ainvoke = AsyncMock(return_value=empty_exp_batch)

    # Use real invoke_with_fallback wrapper with fake LLM factory
    from src.services.llm_config import llm_config_service
    from tests.llm_fixtures import make_target
    monkeypatch.setattr(llm_config_service, "resolve_targets", lambda role: [make_target()])
    monkeypatch.setattr(llm_config_service, "build_client", lambda target: MagicMock())

    def fake_chain_factory(llm, name):
        invoke_attempts.append(name)
        return real_chain

    # Mock the prompt | _structured factory inside experience_node
    with patch("src.pipeline.nodes.invoke_with_fallback") as mock_fallback_invoke:
        # Verify that passing empty bullets raises InvalidStructuredOutput in the validator
        from src.pipeline.nodes import experience_node
        monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())
        monkeypatch.setattr("src.pipeline.nodes.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))

        # Simulate invoke_with_fallback catching InvalidStructuredOutput and exhausting
        mock_fallback_invoke.side_effect = InferenceExhausted("Retries exhausted due to empty bullets")
        res_exp = await experience_node(state_exp, mock_db, gen_id)
        assert res_exp["experience_fallback"] is True
        assert res_exp["experience_draft"][0]["bullet_points"] == ["Solid achievement bullet A"]

    # Now verify the validator directly with real wrapper invoke_with_fallback
    from src.pipeline.nodes import invoke_with_fallback
    def _validate_check(res):
        entries = res.entries
        for i, original in enumerate(source_exps):
            orig_bullets = [b for b in original.get("bullet_points") or [] if b and str(b).strip()]
            if orig_bullets and i < len(entries):
                tailored_bullets = [b for b in getattr(entries[i], "bullet_points", []) if b and str(b).strip()]
                if not tailored_bullets:
                    raise InvalidStructuredOutput("Empty bullets rejected")

    with pytest.raises(InvalidStructuredOutput):
        _validate_check(empty_exp_batch)


@pytest.mark.asyncio
async def test_exhausted_fallback_preserves_third_bullet_through_compiled_graph(monkeypatch):
    """(3) Exhausted fallback source bullets preserved through compiled graph including third bullet."""
    from src.pipeline.graph import compile_graph
    from src.pipeline.nodes import InferenceExhausted

    mock_db = AsyncMock()
    gen_id = str(uuid4())

    source_experiences = [
        {
            "role": "Staff Engineer",
            "organization": "Acme Corp",
            "start_date": "2020-01-01",
            "end_date": "2023-01-01",
            "bullet_points": [
                "Built distributed streaming pipeline handling 100k events/sec with Apache Flink.",
                "Reduced median query latency from 450ms to 65ms by designing multi-tier cache.",
                "Third essential achievement bullet that must never be sliced on fallback.",
            ],
        }
    ]
    source_projects = [
        {
            "name": "Database Engine",
            "description": "Embedded storage engine in Rust",
            "technologies": ["Rust", "Raft"],
            "bullet_points": [
                "Implemented write-ahead logging with zero-copy serialization.",
                "Added Raft consensus support achieving sub-second failover in benchmarks.",
                "Third critical project bullet proving candidate evidence and deep system knowledge.",
            ],
        }
    ]

    initial_state = {
        "user_id": "test-user",
        "profile": {"full_name": "Senior Candidate", "email": "candidate@example.com"},
        "projects": source_projects,
        "experiences": source_experiences,
        "education": [{"degree": "B.S. CS", "institution": "State University"}],
        "extracurriculars": [],
        "job_description": "We need a Senior Systems Engineer.",
        "keywords": ["Rust", "Distributed Systems"],
        "instructions": "",
        "template_manifest": {
            "id": "professional-sans",
            "name": "Professional Sans",
            "max_bullets_per_experience": 2,
            "max_bullets_per_project": 2,
            "target_pages": 1,
            "min_font_size": 9.0,
            "max_font_size": 11.0,
            "page_margin_mm": 14.0,
        },
        "content_split": {"experience": 1, "projects": 1},
        "section_order": ["summary", "experiences", "projects", "skills", "education"],
        "is_pro": False,
        "creativity_mode": "proper",
        "job_analysis": None,
        "summary_draft": None,
        "projects_draft": None,
        "experience_draft": None,
        "extracurriculars_draft": None,
        "tailored_resume": None,
        "orphans": None,
        "pdf_bytes": None,
        "markdown": None,
        "page_count": 0,
        "font_size": 0.0,
        "fits_target": None,
        "has_horizontal_overflow": None,
        "experience_fallback": None,
        "projects_fallback": None,
        "pdf_storage_key": None,
        "md_storage_key": None,
        "thumb_storage_key": None,
        "repair_attempts": 0,
        "repair_history": None,
        "render_attempts": 0,
        "content_reduction_step": 0,
        "errors": [],
        "logs": [],
    }

    # Simulate invoke_with_fallback exhausting for experience and projects writers
    async def mock_invoke_exhausted(chain_factory, invoke_args, **kwargs):
        node = kwargs.get("node_name")
        if node in ("experience_writer", "projects_writer"):
            raise InferenceExhausted(f"{node} exhausted all attempts")
        elif node == "selection":
            from src.schemas.pipeline import StrictSelectedItems
            return StrictSelectedItems(selected_experience_indices=[0], selected_project_indices=[0])
        elif node in ("summary_skills", "summary_writer"):
            from src.schemas.pipeline import TailoredSummaryAndSkills
            return TailoredSummaryAndSkills(
                summary="Experienced systems engineer specializing in distributed platforms.",
                skills={"Languages": ["Rust", "Python"], "Systems": ["Raft", "Flink"]},
            )
        elif node in ("job_analysis", "job_analyzer"):
            from src.schemas.pipeline import JobAnalysis
            return JobAnalysis(
                job_title="Senior Systems Engineer",
                company="TechCorp",
                seniority="Senior",
                key_requirements=["Rust", "Distributed Systems"],
                extracted_skills=["Rust", "Raft", "Flink"],
            )
        return MagicMock()

    async def mock_get_cfg(db, name, default_system, default_user):
        return default_system, default_user

    monkeypatch.setattr("src.pipeline.nodes.invoke_with_fallback", mock_invoke_exhausted)
    monkeypatch.setattr("src.pipeline.nodes.log_progress", AsyncMock())
    monkeypatch.setattr("src.pipeline.nodes.get_prompt_config", mock_get_cfg)
    monkeypatch.setattr("src.core.storage.StorageService.upload_bytes", MagicMock(return_value=True))

    graph = compile_graph()
    result = await graph.ainvoke(
        initial_state,
        config={"configurable": {"db": mock_db, "gen_id": gen_id}},
    )

    tailored = result["tailored_resume"]
    # All 3 bullets must be preserved through the compiled graph!
    exp_bullets = tailored["experiences"][0]["bullet_points"]
    assert len(exp_bullets) == 3
    assert "Third essential achievement bullet" in exp_bullets[2]

    proj_bullets = tailored["projects"][0]["bullet_points"]
    assert len(proj_bullets) == 3
    assert "Third critical project bullet" in proj_bullets[2]

    # Final PDF rendered must contain the third bullet text
    assert result["pdf_bytes"] is not None
    assert result["experience_fallback"] is True
    assert result["projects_fallback"] is True


def test_regression_horizontal_overflow_preserves_real_page_count():
    """(5) Horizontal overflow preserves real PDF page count and flags has_horizontal_overflow independently."""
    from src.services.font_fit import find_best_font_size

    # Simulate an oracle where page_count=1 at all font sizes, but horizontal overflow is True
    def fake_render(fs: float):
        return (1, True)  # 1 page, but has horizontal overflow

    fit_res = find_best_font_size(
        render_page_count=fake_render,
        min_font_size=9.0,
        max_font_size=11.0,
        target_pages=1,
    )

    # Page count must be the real page count (1), NOT a synthetic 2!
    assert fit_res.page_count == 1
    # Has horizontal overflow must be independently flagged True
    assert fit_res.has_horizontal_overflow is True
    # Fits target must be False due to horizontal overflow
    assert fit_res.fits_target is False
