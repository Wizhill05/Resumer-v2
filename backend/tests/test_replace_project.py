import pytest
from uuid import uuid4
from src.schemas.generation import ReplaceProjectRequest, ReplaceProjectResponse

def test_replace_project_request_schema():
    req = ReplaceProjectRequest(
        target_project_index=1,
        profile_project_id=uuid4(),
        current_resume={
            "summary": "Experienced engineer",
            "skills": {"Languages": ["Python", "TypeScript"]},
            "experiences": [],
            "projects": [{"name": "Old Project", "bullet_points": ["Did X"]}],
            "education": [],
            "extracurriculars": [],
        },
    )
    assert req.target_project_index == 1
    assert req.current_resume["summary"] == "Experienced engineer"

def test_replace_project_response_schema():
    res = ReplaceProjectResponse(
        success=True,
        generation_id=str(uuid4()),
        tailored_resume={"projects": []},
        orphans_detected=0,
        orphans_repaired=0,
    )
    assert res.success is True


@pytest.mark.asyncio
async def test_retailor_resume_invalid_index():
    from unittest.mock import AsyncMock, MagicMock
    from src.services.resume_retailor import retailor_resume_with_project

    mock_db = AsyncMock()
    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_project = MagicMock()
    mock_project.name = "New Test Project"

    current_resume = {
        "projects": [{"name": "P1"}]
    }

    with pytest.raises(ValueError, match="Invalid target_project_index"):
        await retailor_resume_with_project(
            db=mock_db,
            gen=mock_gen,
            target_project_index=5,
            new_project=mock_project,
            current_resume=current_resume,
            profile_data={},
        )


@pytest.mark.asyncio
async def test_retailor_resume_success(monkeypatch):
    from unittest.mock import AsyncMock, MagicMock
    from src.services.resume_retailor import retailor_resume_with_project
    from src.schemas.pipeline import TailoredProject, TailoredProjectBatch

    mock_db = AsyncMock()
    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.template_id = "personal-classic"
    mock_gen.section_order = ["experiences", "projects", "skills", "summary", "education", "extracurriculars"]
    mock_gen.job_title = "Backend Engineer"
    mock_gen.company = "Acme"
    mock_gen.job_description = "Write Python APIs."
    mock_gen.keywords = ["FastAPI", "Postgres"]
    mock_gen.render_metadata = {}

    mock_project = MagicMock()
    mock_project.name = "Profile Project X"
    mock_project.description = "A great project"
    mock_project.technologies = ["Python", "FastAPI"]
    mock_project.bullet_points = ["Engineered high-throughput service"]
    mock_project.github_url = "https://github.com/test/x"
    mock_project.live_url = None
    mock_project.start_date = None
    mock_project.end_date = None

    current_resume = {
        "summary": "Full-stack developer",
        "skills": {"Languages": ["Python"]},
        "experiences": [],
        "projects": [
            {"name": "Old Project", "bullet_points": ["Did old work"]},
            {"name": "Keep Project", "bullet_points": ["Did keep work"]},
        ],
        "education": [],
        "extracurriculars": [],
    }

    # Mock invoke_with_fallback
    async def mock_invoke(*args, **kwargs):
        return TailoredProjectBatch(
            entries=[
                TailoredProject(
                    name="Profile Project X",
                    project_summary="API Service",
                    description="A great project",
                    technologies=["Python", "FastAPI"],
                    bullet_points=["Engineered high-throughput service with **FastAPI**."],
                ),
                TailoredProject(
                    name="Keep Project",
                    project_summary="Web App",
                    description="Keep description",
                    technologies=["React"],
                    bullet_points=["Kept project running smoothly."],
                ),
            ]
        )

    monkeypatch.setattr("src.services.resume_retailor.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))
    monkeypatch.setattr("src.services.resume_retailor.invoke_with_fallback", mock_invoke)

    # Mock detect_resume_orphans
    def mock_detect(*args, **kwargs):
        assert kwargs["section_order"] == mock_gen.section_order
        return {
            "success": True,
            "orphans": [],
            "font_size": 10.0,
            "page_count": 1,
            "fits_target": True,
        }

    monkeypatch.setattr("src.services.resume_retailor.detect_resume_orphans", mock_detect)

    result = await retailor_resume_with_project(
        db=mock_db,
        gen=mock_gen,
        target_project_index=0,
        new_project=mock_project,
        current_resume=current_resume,
        profile_data={},
    )

    assert result["orphans_detected"] == 0
    assert result["orphans_repaired"] == 0
    assert len(result["tailored_resume"]["projects"]) == 2
    assert result["tailored_resume"]["projects"][0]["name"] == "Profile Project X"
    assert result["tailored_resume"]["projects"][0]["github_url"] == "https://github.com/test/x"
    assert result["tailored_resume"]["projects"][1]["name"] == "Keep Project"



@pytest.mark.asyncio
async def test_project_replacement_restricts_orphan_repair_and_preserves_unrelated_sections(monkeypatch):
    """(1) Restrict orphan repair to new target project and preserve all other projects,
    experiences, extracurriculars exactly, including on repair."""
    from unittest.mock import AsyncMock, MagicMock
    from src.services.resume_retailor import retailor_resume_with_project
    from src.schemas.pipeline import TailoredProject, TailoredProjectBatch

    mock_db = AsyncMock()
    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.template_id = "professional-sans"
    mock_gen.section_order = ["summary", "experiences", "projects", "skills", "education", "extracurriculars"]
    mock_gen.job_title = "Lead Engineer"
    mock_gen.company = "Tech Inc"
    mock_gen.job_description = "Distributed systems."
    mock_gen.keywords = ["Go", "Raft"]
    mock_gen.render_metadata = {}
    mock_gen.creativity_mode = "proper"

    new_proj = MagicMock()
    new_proj.name = "New Replacement Project"
    new_proj.description = "New project description"
    new_proj.technologies = ["Go"]
    new_proj.bullet_points = ["Replacement bullet that will trigger orphan line."]
    new_proj.github_url = "https://github.com/test/new"
    new_proj.live_url = None
    new_proj.start_date = None
    new_proj.end_date = None

    manual_exp = [
        {
            "role": "Staff Engineer",
            "organization": "ManualOrg",
            "location": "Remote",
            "start_date": "2020-01-01",
            "end_date": None,
            "bullet_points": ["Manual experience bullet that has orphan but must NOT be repaired."],
        }
    ]
    manual_extra = [{"description": "Manual extracurricular that must NOT be touched."}]
    untouched_proj = {
        "name": "Untouched Project A",
        "description": "Manual untouched description",
        "technologies": ["Python"],
        "bullet_points": ["Manual untouched project bullet."],
    }
    old_proj_to_replace = {
        "name": "Old Project B",
        "description": "Old description",
        "technologies": ["Java"],
        "bullet_points": ["Old bullet B"],
    }

    current_resume = {
        "summary": "Full-stack developer",
        "skills": {"Languages": ["Python"]},
        "experiences": manual_exp,
        "projects": [untouched_proj, old_proj_to_replace],
        "education": [],
        "extracurriculars": manual_extra,
    }

    tailored_batch = TailoredProjectBatch(
        entries=[
            TailoredProject(
                name="New Replacement Project",
                project_summary="Cloud Service",
                description="New project description",
                technologies=["Go"],
                bullet_points=["Replacement bullet that will trigger orphan line."],
            )
        ]
    )

    monkeypatch.setattr("src.services.resume_retailor.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))
    monkeypatch.setattr("src.services.resume_retailor.invoke_with_fallback", AsyncMock(return_value=tailored_batch))

    # Simulate orphan detection reporting 2 orphans:
    # 1 in experience (unrelated) and 1 in the new replacement project
    orphan_in_exp = {"fix_type": "expand", "text": "Manual experience bullet that has orphan but must NOT be repaired."}
    orphan_in_new_proj = {"fix_type": "expand", "text": "Replacement bullet that will trigger orphan line."}

    def mock_detect(*args, **kwargs):
        return {
            "success": True,
            "orphans": [orphan_in_exp, orphan_in_new_proj],
            "font_size": 10.0,
            "page_count": 1,
            "fits_target": True,
        }

    monkeypatch.setattr("src.services.resume_retailor.detect_resume_orphans", mock_detect)

    # Track what orphan_repair_node receives
    repair_states_received = []
    async def mock_repair_node(state, db, gen_id):
        repair_states_received.append(state)
        # Even if repair node returns modified experiences/projects,
        # retailor_resume_with_project MUST restrict updates to target_project_index!
        modified_projs = list(state.get("projects_draft") or [])
        if len(modified_projs) > 1:
            modified_projs[1]["bullet_points"] = ["Repaired replacement bullet with optimal line-wrap."]
        return {
            "projects_draft": modified_projs,
            "experience_draft": [{"role": "HACKED ROLE", "bullet_points": ["HACKED EXP"]}],
            "extracurriculars_draft": [{"description": "HACKED EXTRA"}],
        }

    monkeypatch.setattr("src.services.resume_retailor.orphan_repair_node", mock_repair_node)

    result = await retailor_resume_with_project(
        db=mock_db,
        gen=mock_gen,
        target_project_index=1,
        new_project=new_proj,
        current_resume=current_resume,
        profile_data={},
    )

    # 1. Verify orphan repair received ONLY the target project orphan!
    assert len(repair_states_received) == 1
    passed_orphans = repair_states_received[0]["orphans"]
    assert len(passed_orphans) == 1
    assert passed_orphans[0]["text"] == "Replacement bullet that will trigger orphan line."

    # 2. Verify all other sections preserved exactly!
    tailored_res = result["tailored_resume"]
    assert tailored_res["experiences"] == manual_exp
    assert tailored_res["extracurriculars"] == manual_extra
    assert tailored_res["projects"][0] == untouched_proj
    # Only target project updated
    assert tailored_res["projects"][1]["name"] == "New Replacement Project"


@pytest.mark.asyncio
async def test_replacement_empty_bullets_rejected_triggers_retry_and_fallback(monkeypatch):
    """(2) Full-count batch with empty/blank bullets in replacement rejects and falls back to source project."""
    from unittest.mock import AsyncMock, MagicMock
    from langchain_core.runnables import Runnable
    from src.services.resume_retailor import retailor_resume_with_project
    from src.schemas.pipeline import TailoredProject, TailoredProjectBatch

    mock_db = AsyncMock()
    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.template_id = "professional-sans"
    mock_gen.section_order = ["projects"]
    mock_gen.job_title = "Backend Engineer"
    mock_gen.company = "Acme"
    mock_gen.job_description = "API dev"
    mock_gen.keywords = ["Python"]
    mock_gen.render_metadata = {}
    mock_gen.creativity_mode = "proper"

    new_proj = MagicMock()
    new_proj.name = "Source Replacement Project"
    new_proj.description = "Source description"
    new_proj.technologies = ["Python"]
    new_proj.bullet_points = ["Valid source bullet 1", "Valid source bullet 2"]
    new_proj.github_url = None
    new_proj.live_url = None
    new_proj.start_date = None
    new_proj.end_date = None

    current_resume = {
        "projects": [{"name": "Old Project", "bullet_points": ["Old bullet"]}],
    }

    # Model returns blank bullets in the retained slice
    empty_batch = TailoredProjectBatch(
        entries=[
            TailoredProject(
                name="Source Replacement Project",
                project_summary="Dev",
                description="Desc",
                technologies=["Python"],
                bullet_points=[" ", "", "valid bullet that would be sliced off"],
            )
        ]
    )

    class BlankRunnable(Runnable):
        def invoke(self, *a, **k):
            return empty_batch
        async def ainvoke(self, *a, **k):
            return empty_batch

    monkeypatch.setattr("src.services.resume_retailor.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))
    monkeypatch.setattr("src.services.resume_retailor._structured", lambda llm, schema, prompt: BlankRunnable())
    monkeypatch.setattr("src.services.resume_retailor.detect_resume_orphans", lambda *a, **k: {"success": True, "orphans": [], "font_size": 10.0, "page_count": 1, "fits_target": True})

    result = await retailor_resume_with_project(
        db=mock_db,
        gen=mock_gen,
        target_project_index=0,
        new_project=new_proj,
        current_resume=current_resume,
        profile_data={},
    )

    # Must fall back non-destructively to source replacement project data with both bullets!
    assert result["fallback_used"] is True
    assert result["tailored_resume"]["projects"][0]["name"] == "Source Replacement Project"
    assert result["tailored_resume"]["projects"][0]["bullet_points"] == ["Valid source bullet 1", "Valid source bullet 2"]


@pytest.mark.asyncio
async def test_replacement_exhausted_fallback_preserves_all_bullets_including_third(monkeypatch):
    """(3) Replacement on exhausted fallback preserves complete fallback content including third bullet."""
    from unittest.mock import AsyncMock, MagicMock
    from src.services.resume_retailor import retailor_resume_with_project
    from src.pipeline.nodes import InferenceExhausted

    mock_db = AsyncMock()
    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.template_id = "professional-sans"  # manifest max_bullets_per_project is 2
    mock_gen.section_order = ["projects"]
    mock_gen.job_title = "Backend Engineer"
    mock_gen.company = "Acme"
    mock_gen.job_description = "API dev"
    mock_gen.keywords = ["Python"]
    mock_gen.render_metadata = {}
    mock_gen.creativity_mode = "proper"

    new_proj = MagicMock()
    new_proj.name = "Candidate Fallback Project"
    new_proj.description = "Candidate project with 3 bullets"
    new_proj.technologies = ["Python", "Docker"]
    new_proj.bullet_points = [
        "First solid achievement bullet.",
        "Second solid achievement bullet.",
        "Third crucial fallback bullet that must not be sliced to 2.",
    ]
    new_proj.github_url = None
    new_proj.live_url = None
    new_proj.start_date = None
    new_proj.end_date = None

    current_resume = {
        "projects": [{"name": "Old Project", "bullet_points": ["Old bullet"]}],
    }

    async def mock_invoke(*args, **kwargs):
        raise InferenceExhausted("All routes failed")

    monkeypatch.setattr("src.services.resume_retailor.get_prompt_config", AsyncMock(return_value=("Prompt {batch_len}", "User {entries}")))
    monkeypatch.setattr("src.services.resume_retailor.invoke_with_fallback", mock_invoke)
    monkeypatch.setattr("src.services.resume_retailor.detect_resume_orphans", lambda *a, **k: {"success": True, "orphans": [], "font_size": 10.0, "page_count": 1, "fits_target": True})

    result = await retailor_resume_with_project(
        db=mock_db,
        gen=mock_gen,
        target_project_index=0,
        new_project=new_proj,
        current_resume=current_resume,
        profile_data={},
    )

    bullets = result["tailored_resume"]["projects"][0]["bullet_points"]
    # All 3 bullets must be preserved on fallback; never sliced to 2!
    assert len(bullets) == 3
    assert bullets[2] == "Third crucial fallback bullet that must not be sliced to 2."
    assert result["fallback_used"] is True


@pytest.mark.asyncio
async def test_replacement_passes_mode_and_writer_config_for_larp_and_super_larp(monkeypatch):
    """(4) Replacement passes saved mode and selects corresponding writer config for larp and super_larp."""
    from unittest.mock import AsyncMock, MagicMock
    from src.services.resume_retailor import retailor_resume_with_project
    from src.schemas.pipeline import TailoredProject, TailoredProjectBatch

    mock_db = AsyncMock()
    mock_proj = MagicMock()
    mock_proj.name = "Test Project"
    mock_proj.description = "Desc"
    mock_proj.technologies = ["Python"]
    mock_proj.bullet_points = ["Bullet"]
    mock_proj.github_url = None
    mock_proj.live_url = None
    mock_proj.start_date = None
    mock_proj.end_date = None

    current_resume = {"projects": [{"name": "Old", "bullet_points": ["Old"]}]}

    for mode in ("proper", "larp", "super_larp"):
        mock_gen = MagicMock()
        mock_gen.id = uuid4()
        mock_gen.template_id = "professional-sans"
        mock_gen.section_order = ["projects"]
        mock_gen.job_title = "Backend Engineer"
        mock_gen.company = "Acme"
        mock_gen.job_description = "API dev"
        mock_gen.keywords = ["Python"]
        mock_gen.render_metadata = {}
        mock_gen.creativity_mode = mode

        captured_config_name = []
        captured_sys_prompt = []

        async def mock_get_config(db, name, default_system, default_user):
            captured_config_name.append(name)
            captured_sys_prompt.append(default_system)
            return default_system, default_user

        async def mock_invoke(chain_factory, invoke_args, **kwargs):
            return TailoredProjectBatch(
                entries=[
                    TailoredProject(
                        name="Test Project",
                        project_summary="Dev",
                        description="Desc",
                        technologies=["Python"],
                        bullet_points=["Bullet"],
                    )
                ]
            )

        monkeypatch.setattr("src.services.resume_retailor.get_prompt_config", mock_get_config)
        monkeypatch.setattr("src.services.resume_retailor.invoke_with_fallback", mock_invoke)
        monkeypatch.setattr("src.services.resume_retailor.detect_resume_orphans", lambda *a, **k: {"success": True, "orphans": [], "font_size": 10.0, "page_count": 1, "fits_target": True})

        await retailor_resume_with_project(
            db=mock_db,
            gen=mock_gen,
            target_project_index=0,
            new_project=mock_proj,
            current_resume=current_resume,
            profile_data={},
        )

        # Check prompt config name requested
        if mode in ("larp", "super_larp"):
            assert captured_config_name[0] == f"projects_writer_{mode}"
            assert "LARP MODE" in captured_sys_prompt[0]
        else:
            assert captured_config_name[0] == "projects_writer"
            assert "Do not invent metrics" in captured_sys_prompt[0]
