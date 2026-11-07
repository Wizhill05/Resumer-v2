"""Structured-output request shape tests through the real LangChain/OpenAI path."""
import json

import httpx
import pytest
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from src.pipeline.nodes import _structured, _validate_selection
from src.schemas.pipeline import StrictSelectedItems


@pytest.mark.parametrize("content,valid", [
    ('{"selected_experience_indices":[0],"selected_project_indices":[0]}', True),
    ('```json\n{"selected_experience_indices":[0],"selected_project_indices":[0]}\n```', True),
    ('{"selected_experience_indices":[0.0],"selected_project_indices":[0]}', False),
    ('{"selected_experience_indices":[true],"selected_project_indices":[0]}', False),
    ('{}', False), ('This is not JSON', False),
    ('{"selected_experience_indices":[0],"selected_project_indices":[0]', False),
])
@pytest.mark.parametrize("mode", ["json_schema", "json_object", "prompt_only"])
async def test_json_content_without_tool_calls(content, valid, mode):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "synthetic", "object": "chat.completion", "created": 0,
            "model": "m", "choices": [{"index": 0, "finish_reason": "stop",
            "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        llm = ChatOpenAI(model="m", api_key="synthetic-key", max_retries=0,
                         base_url="https://api.example.com/v1", http_async_client=client)
        object.__setattr__(llm, "_structured_mode", mode)
        result = await _structured(llm, StrictSelectedItems).ainvoke([HumanMessage(content="Select index 0")])
    assert bool(result["parsed"]) is valid
    assert bool(result["parsing_error"]) is not valid
    assert result["raw"].usage_metadata["total_tokens"] == 15
    assert "tools" not in requests[0] and "tool_choice" not in requests[0]
    if mode == "json_schema":
        assert requests[0]["response_format"]["type"] == "json_schema"
    elif mode == "json_object":
        assert requests[0]["response_format"] == {"type": "json_object"}
    else:
        assert "response_format" not in requests[0]
    # json_schema must not include the legacy provider hack
    if mode == "json_schema":
        assert "provider" not in requests[0]
    if valid:
        _validate_selection(result["parsed"], 1, 1, 1, 1)
        assert ["experience"][result["parsed"].selected_experience_indices[0]] == "experience"


async def test_json_schema_with_extra_body_provider_passthrough():
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "synthetic", "object": "chat.completion", "created": 0,
            "model": "m", "choices": [{"index": 0, "finish_reason": "stop",
            "message": {"role": "assistant", "content": '{"selected_experience_indices":[0],"selected_project_indices":[0]}'}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        llm = ChatOpenAI(model="m", api_key="synthetic-key", max_retries=0,
                         base_url="https://api.example.com/v1", http_async_client=client,
                         extra_body={"provider": {"require_parameters": True}})
        object.__setattr__(llm, "_structured_mode", "json_schema")
        result = await _structured(llm, StrictSelectedItems).ainvoke([HumanMessage(content="Select index 0")])
    assert result["parsed"] is not None
    assert requests[0]["provider"]["require_parameters"] is True


def _walk_objects(node):
    if isinstance(node, dict):
        if isinstance(node.get("properties"), dict):
            yield node
        for value in node.values():
            yield from _walk_objects(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk_objects(value)


def _wire_schemas():
    from src.schemas import pipeline
    from src.services.github_import import GitHubProjectDraft
    from src.services.resume_import import ResumeImportDraft

    return [
        pipeline.JobAnalysis, StrictSelectedItems, pipeline.TailoredSummaryAndSkills,
        pipeline.TailoredExperienceBatch, pipeline.TailoredProjectBatch, pipeline.TailoredProject,
        pipeline.TailoredExtracurricularBatch, ResumeImportDraft, GitHubProjectDraft,
    ]


@pytest.mark.parametrize("schema", _wire_schemas(), ids=lambda s: s.__name__)
def test_wire_schema_is_strict(schema):
    """Gemini skips optional fields; OpenAI strict mode rejects open objects (HTTP 400)."""
    from src.pipeline.nodes import _strict_json_schema

    contract = _strict_json_schema(schema)
    objects = list(_walk_objects(contract))
    assert objects
    for node in objects:
        assert node["additionalProperties"] is False
        assert sorted(node["required"]) == sorted(node["properties"])
    for node in objects:
        for prop in node["properties"].values():
            assert "default" not in prop
    # The Pydantic schema itself is untouched.
    assert schema.model_json_schema() != contract


def test_wire_schema_requires_project_and_experience_content():
    from src.pipeline.nodes import _strict_json_schema
    from src.schemas.pipeline import TailoredExperienceBatch, TailoredProjectBatch

    project = _strict_json_schema(TailoredProjectBatch)["$defs"]["TailoredProject"]
    assert {"description", "technologies", "bullet_points", "project_summary"} <= set(project["required"])
    experience = _strict_json_schema(TailoredExperienceBatch)["$defs"]["TailoredExperience"]
    assert {"bullet_points", "end_date", "location"} <= set(experience["required"])
    # Nullable fields stay nullable.
    assert {"type": "null"} in project["properties"]["description"]["anyOf"]


def test_optional_free_form_map_is_omitted_but_still_defaults_locally():
    from src.pipeline.nodes import _strict_json_schema
    from src.schemas.pipeline import TailoredSummaryAndSkills

    contract = _strict_json_schema(TailoredSummaryAndSkills)
    assert "skills" not in contract["properties"]
    parsed = TailoredSummaryAndSkills.model_validate_json(
        '{"summary": "Builds APIs.", "categories": [{"category": "Languages", "skills": ["Python"]}]}'
    )
    assert parsed.categories[0].skills == ["Python"]


async def test_json_schema_request_sends_strict_contract():
    from src.schemas.pipeline import TailoredProjectBatch

    requests = []
    content = json.dumps({"entries": [{
        "name": "Fraud API", "project_summary": "Scoring Service", "description": "Scores payments.",
        "technologies": ["Python"], "bullet_points": ["Built a **FastAPI** scorer."],
    }]})

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "synthetic", "object": "chat.completion", "created": 0,
            "model": "m", "choices": [{"index": 0, "finish_reason": "stop",
            "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        llm = ChatOpenAI(model="m", api_key="synthetic-key", max_retries=0,
                         base_url="https://api.example.com/v1", http_async_client=client)
        result = await _structured(llm, TailoredProjectBatch).ainvoke([HumanMessage(content="Rewrite")])

    sent = requests[0]["response_format"]["json_schema"]["schema"]
    assert sent["additionalProperties"] is False
    assert "bullet_points" in sent["$defs"]["TailoredProject"]["required"]
    # The prompt copy of the schema matches what the provider enforces.
    assert json.dumps(sent) in requests[0]["messages"][0]["content"]
    assert result["parsed"].entries[0].bullet_points == ["Built a **FastAPI** scorer."]
