import asyncio
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
import pytest
from langchain_core.runnables import Runnable

from src.pipeline.nodes import experience_node, project_node
from src.schemas.pipeline import (
    TailoredExperience,
    TailoredExperienceBatch,
    TailoredProject,
    TailoredProjectBatch,
)
from src.services.resume_retailor import retailor_resume_with_project
from src.services.llm_config import llm_config_service
from tests.llm_fixtures import make_target


@pytest.fixture(autouse=True)
def _patched_routing(monkeypatch):
    target = make_target()
    monkeypatch.setattr(llm_config_service, "ensure_fresh", AsyncMock())
    monkeypatch.setattr(llm_config_service, "resolve_targets", lambda role: [target])
    monkeypatch.setattr(llm_config_service, "build_client", lambda target: object())
    import src.pipeline.nodes as _nodes_mod
    monkeypatch.setattr(_nodes_mod, "record_node_metric", AsyncMock())


class SequenceRunnable(Runnable):
    """Real LangChain runnable returning sequence of outputs on successive ainvoke calls."""

    def __init__(self, outputs: list):
        self.outputs = list(outputs)
        self.call_count = 0

    def invoke(self, input, config=None):
        idx = min(self.call_count, len(self.outputs) - 1)
        res = self.outputs[idx]
        self.call_count += 1
        return res

    async def ainvoke(self, input, config=None, **kwargs):
        idx = min(self.call_count, len(self.outputs) - 1)
        res = self.outputs[idx]
        self.call_count += 1
        return res


@pytest.mark.asyncio
async def test_experience_writer_validator_rejects_blanks_and_retains_normalized(monkeypatch):
    """(2) Experience writer validator checks exact retained slice; [' ','','valid'] fails, retry succeeds."""
    import src.pipeline.nodes as nodes_mod

    # max_bullets is 2.
    # Attempt 1: [' ', '', 'valid'] -> retained slice [:2] is [' ', ''] (all blanks) -> rejected!
    # Attempt 2: ['   Architected caching layer   ', '   Cut latency by 40%   '] -> accepted and normalized!
    bad_batch = TailoredExperienceBatch(
        entries=[
            TailoredExperience(
                role="Senior Engineer",
                organization="Acme",
                bullet_points=[" ", "", "valid bullet that would be sliced away"],
            )
        ]
    )
    good_batch = TailoredExperienceBatch(
        entries=[
            TailoredExperience(
                role="Senior Engineer",
                organization="Acme",
                bullet_points=[
                    "   Architected distributed caching layer   ",
                    "   Cut latency by 40% in production   ",
                ],
            )
        ]
    )

    runnable = SequenceRunnable([bad_batch, good_batch])
    monkeypatch.setattr(nodes_mod, "_structured", lambda llm, schema, prompt: runnable)

    state = {
        "experiences": [
            {
                "role": "Senior Engineer",
                "organization": "Acme",
                "bullet_points": ["Source bullet 1", "Source bullet 2"],
            }
        ],
        "content_split": {"experience": 1},
        "template_manifest": {"max_bullets_per_experience": 2},
        "job_analysis": "Target Role: Senior Engineer",
        "is_pro": False,
    }

    res = await experience_node(state, db=AsyncMock(), gen_id=str(uuid4()))
    assert runnable.call_count == 2, f"Expected 2 calls (retry on blank slice), got {runnable.call_count}"
    retained = res["experience_draft"][0]["bullet_points"]
    assert retained == [
        "Architected distributed caching layer",
        "Cut latency by 40% in production",
    ]


@pytest.mark.asyncio
async def test_project_writer_validator_rejects_blanks_and_falls_back(monkeypatch):
    """(2) Project writer validator rejects blank retained slice through real invoke_with_fallback."""
    import src.pipeline.nodes as nodes_mod

    # max_bullets is 2.
    # Returns only blank bullets -> exhausts retries via real invoke_with_fallback and triggers fallback
    empty_batch = TailoredProjectBatch(
        entries=[
            TailoredProject(
                name="Project Alpha",
                project_summary="API",
                description="Desc",
                technologies=["Python"],
                bullet_points=[" ", "", "   "],
            )
        ]
    )

    runnable = SequenceRunnable([empty_batch])
    monkeypatch.setattr(nodes_mod, "_structured", lambda llm, schema, prompt: runnable)

    source_projects = [
        {
            "name": "Project Alpha",
            "description": "Source desc",
            "technologies": ["Python"],
            "bullet_points": ["Source bullet 1", "Source bullet 2"],
        }
    ]
    state = {
        "projects": source_projects,
        "content_split": {"projects": 1},
        "template_manifest": {"max_bullets_per_project": 2},
        "job_analysis": "Target Role",
        "is_pro": False,
        "creativity_mode": "proper",
    }

    res = await project_node(state, db=AsyncMock(), gen_id=str(uuid4()))
    # Real invoke_with_fallback exhausted retries and fell back non-destructively
    assert res.get("projects_fallback") is True
    assert res["projects_draft"][0]["bullet_points"] == ["Source bullet 1", "Source bullet 2"]


@pytest.mark.asyncio
async def test_replacement_validator_rejects_blanks_and_normalizes_valid(monkeypatch):
    """(2) Replacement validator examines exact retained bullets with real invoke_with_fallback."""
    import src.services.resume_retailor as retailor_mod

    mock_db = AsyncMock()
    mock_gen = MagicMock()
    mock_gen.id = uuid4()
    mock_gen.template_id = "professional-sans"  # max_bullets_per_project is 2
    mock_gen.section_order = ["projects"]
    mock_gen.job_title = "Backend Engineer"
    mock_gen.company = "Acme"
    mock_gen.job_description = "API dev"
    mock_gen.keywords = ["Python"]
    mock_gen.render_metadata = {}
    mock_gen.creativity_mode = "proper"

    new_proj = MagicMock()
    new_proj.name = "Replacement Project"
    new_proj.description = "Source description"
    new_proj.technologies = ["Python"]
    new_proj.bullet_points = ["Source bullet 1", "Source bullet 2"]
    new_proj.github_url = None
    new_proj.live_url = None
    new_proj.start_date = None
    new_proj.end_date = None

    current_resume = {
        "projects": [{"name": "Old Project", "bullet_points": ["Old bullet"]}],
    }

    # Attempt 1: [' ', '', 'valid'] -> retained [:2] is [' ', ''] -> rejected!
    # Attempt 2: ['   Normalized bullet 1   ', '   Normalized bullet 2   '] -> accepted!
    bad_batch = TailoredProjectBatch(
        entries=[
            TailoredProject(
                name="Replacement Project",
                project_summary="Dev",
                description="Desc",
                technologies=["Python"],
                bullet_points=[" ", "", "valid bullet that would be sliced away"],
            )
        ]
    )
    good_batch = TailoredProjectBatch(
        entries=[
            TailoredProject(
                name="Replacement Project",
                project_summary="Dev",
                description="Desc",
                technologies=["Python"],
                bullet_points=[
                    "   Normalized bullet 1   ",
                    "   Normalized bullet 2   ",
                ],
            )
        ]
    )

    runnable = SequenceRunnable([bad_batch, good_batch])
    monkeypatch.setattr(retailor_mod, "_structured", lambda llm, schema, prompt: runnable)
    monkeypatch.setattr(
        retailor_mod,
        "detect_resume_orphans",
        lambda *a, **k: {
            "success": True,
            "orphans": [],
            "font_size": 10.0,
            "page_count": 1,
            "fits_target": True,
        },
    )

    result = await retailor_resume_with_project(
        db=mock_db,
        gen=mock_gen,
        target_project_index=0,
        new_project=new_proj,
        current_resume=current_resume,
        profile_data={},
    )

    assert runnable.call_count == 2, f"Expected 2 calls through real invoke_with_fallback, got {runnable.call_count}"
    assert result["fallback_used"] is False
    assert result["tailored_resume"]["projects"][0]["bullet_points"] == [
        "Normalized bullet 1",
        "Normalized bullet 2",
    ]
