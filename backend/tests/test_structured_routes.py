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
