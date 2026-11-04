import json
from types import SimpleNamespace

import pytest

from src.pipeline import nodes
from src.schemas.pipeline import TailoredProject
from src.services.llm_config import TierConfig, llm_config_service


SYNTHETIC = {
    "name": "Realtime Fraud Scoring API",
    "project_summary": "Fraud Scoring Service",
    "description": "Scores transactions in real time to help reviewers catch fraud.",
    "technologies": ["Python", "FastAPI", "PostgreSQL", "Redis"],
    "bullet_points": [
        "Built a **FastAPI** scoring service for transaction review.",
        "Added **Redis** caching to reduce repeated database reads.",
    ],
}


@pytest.mark.parametrize(
    "change",
    [
        {"name": "  "},
        {"description": None},
        {"description": "  "},
        {"technologies": []},
        {"technologies": ["Python", "FastAPI", "PostgreSQL", "  "]},
        {"bullet_points": []},
        {"bullet_points": ["Built a service.", "  "]},
    ],
)
def test_synthetic_project_rejects_incomplete_content(change):
    with pytest.raises(nodes.InvalidStructuredOutput, match="Incomplete synthetic project"):
        nodes._validate_synthetic_project(TailoredProject.model_validate({**SYNTHETIC, **change}))


def test_synthetic_project_rejects_omitted_optional_content():
    with pytest.raises(nodes.InvalidStructuredOutput, match="Incomplete synthetic project"):
        nodes._validate_synthetic_project(TailoredProject(name="Placeholder"))


@pytest.mark.parametrize("change", [
    {"technologies": ["Python"], "bullet_points": ["Built a service."]},
    {"technologies": ["Python"] * 9, "bullet_points": ["Built a service."] * 4},
])
def test_synthetic_project_accepts_complete_content_outside_prompt_targets(change):
    nodes._validate_synthetic_project(TailoredProject.model_validate({**SYNTHETIC, **change}))


class FakeLLM:
    def __init__(self, responses, base_url):
        self.responses = iter(responses)
        self.openai_api_base = base_url
        self.model_name = "fake-model"
        self.schemas = []
        self.calls = 0

    def bind(self, **kwargs):
        self.schemas.append(kwargs["response_format"]["json_schema"]["name"])
        return self

    async def ainvoke(self, messages, config=None):
        self.calls += 1
        return SimpleNamespace(
            content=json.dumps(next(self.responses)),
            response_metadata={"finish_reason": "stop"},
        )


@pytest.fixture
def project_node_setup(monkeypatch):
    cfg = TierConfig(
        tier="pro", provider_name="omniroute", base_url="https://omniroute.example/v1",
        model="primary", fallback_model="fallback",
    )
    monkeypatch.setattr(llm_config_service, "get_tier_config", lambda tier: cfg)

    async def prompt_config(db, name, default_system, default_user=None):
        return default_system, default_user

    messages = []

    async def progress(db, gen_id, node_name, message, level="info"):
        messages.append((message, level))

    async def metric(*args, **kwargs):
        pass

    async def no_sleep(seconds):
        pass

    monkeypatch.setattr(nodes, "get_prompt_config", prompt_config)
    monkeypatch.setattr(nodes, "log_progress", progress)
    monkeypatch.setattr(nodes, "record_node_metric", metric)
    monkeypatch.setattr(nodes.asyncio, "sleep", no_sleep)

    state = {
        "projects": [{
            "name": "Original Project",
            "description": "Original description.",
            "technologies": ["Python"],
            "bullet_points": ["Original work."],
            "github_url": "https://github.com/example/original",
        }],
        "content_split": {"projects": 1},
        "template_manifest": {"max_bullets_per_project": 3},
        "job_analysis": {"job_title": "Backend Engineer"},
        "creativity_mode": "super_larp",
        "is_pro": True,
    }
    tailored = {
        "entries": [{
            "name": "Original Project",
            "description": "Tailored original description.",
            "technologies": ["Python"],
            "bullet_points": ["Tailored original work."],
        }],
    }
    return state, tailored, messages


@pytest.mark.asyncio
async def test_synthetic_project_retries_incomplete_output(project_node_setup, monkeypatch):
    state, tailored, messages = project_node_setup
    primary = FakeLLM(
        [tailored, {**SYNTHETIC, "description": None}, SYNTHETIC],
        "https://omniroute.example/v1",
    )
    monkeypatch.setattr(llm_config_service, "get_llm", lambda **kwargs: primary)
    monkeypatch.setattr(llm_config_service, "get_fallback_llm", lambda **kwargs: pytest.fail("Fallback was unnecessary"))

    result = await nodes.project_node(state, None, "test-generation")

    assert result["projects_draft"][0]["name"] == SYNTHETIC["name"]
    assert result["projects_draft"][0]["bullet_points"] == SYNTHETIC["bullet_points"]
    assert primary.schemas == ["TailoredProjectBatch", "TailoredProject", "TailoredProject"]
    assert any("installed in slot 1" in message for message, _ in messages)


@pytest.mark.asyncio
async def test_synthetic_project_accepts_valid_fallback_output(project_node_setup, monkeypatch):
    state, tailored, _ = project_node_setup
    invalid = {**SYNTHETIC, "technologies": []}
    primary = FakeLLM([tailored, invalid, invalid], "https://omniroute.example/v1")
    fallback = FakeLLM([SYNTHETIC], "https://openrouter.ai/api/v1")
    monkeypatch.setattr(llm_config_service, "get_llm", lambda **kwargs: primary)
    monkeypatch.setattr(llm_config_service, "get_fallback_llm", lambda **kwargs: fallback)

    result = await nodes.project_node(state, None, "test-generation")

    assert result["projects_draft"][0]["name"] == SYNTHETIC["name"]
    assert primary.calls == 3
    assert fallback.calls == 1


@pytest.mark.asyncio
async def test_synthetic_project_preserves_tailored_project_after_provider_exhaustion(project_node_setup, monkeypatch):
    state, tailored, messages = project_node_setup
    invalid = {**SYNTHETIC, "bullet_points": []}
    primary = FakeLLM([tailored, invalid, invalid], "https://omniroute.example/v1")
    fallback = FakeLLM([invalid, invalid], "https://openrouter.ai/api/v1")
    monkeypatch.setattr(llm_config_service, "get_llm", lambda **kwargs: primary)
    monkeypatch.setattr(llm_config_service, "get_fallback_llm", lambda **kwargs: fallback)

    result = await nodes.project_node(state, None, "test-generation")

    first = result["projects_draft"][0]
    assert first["name"] == "Original Project"
    assert first["description"] == "Tailored original description."
    assert first["bullet_points"] == ["Tailored original work."]
    assert first["github_url"] == "https://github.com/example/original"
    assert primary.calls == 3
    assert fallback.calls == 2
    assert any("keeping tailored projects" in message and level == "warning" for message, level in messages)
