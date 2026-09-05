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

    monkeypatch.setattr("src.services.resume_retailor.invoke_with_fallback", mock_invoke)

    # Mock detect_resume_orphans
    def mock_detect(*args, **kwargs):
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

