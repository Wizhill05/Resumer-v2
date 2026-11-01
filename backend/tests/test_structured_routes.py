"""Exercise the real LangChain/OpenAI request and response path without network calls."""
import json
from dataclasses import replace

import httpx
import pytest
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from src.pipeline.nodes import _structured, _validate_selection, invoke_with_fallback, InferenceExhausted
from src.schemas.pipeline import StrictSelectedItems
from src.services.llm_config import llm_config_service


@pytest.mark.parametrize("content,valid", [
    ('{"selected_experience_indices":[0],"selected_project_indices":[0]}', True),
    ('```json\n{"selected_experience_indices":[0],"selected_project_indices":[0]}\n```', True),
    ('{"selected_experience_indices":[0.0],"selected_project_indices":[0]}', False),
    ('{"selected_experience_indices":[true],"selected_project_indices":[0]}', False),
    ('{}', False), ('This is not JSON', False),
    ('{"selected_experience_indices":[0],"selected_project_indices":[0]', False),
])
async def test_json_content_without_tool_calls(content, valid):
    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "synthetic", "object": "chat.completion", "created": 0,
            "model": "google/gemini-3.8-flash", "choices": [{"index": 0, "finish_reason": "stop",
            "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        llm = ChatOpenAI(model="google/gemini-3.8-flash", api_key="synthetic-key", max_retries=0,
                         base_url="https://openrouter.ai/api/v1", http_async_client=client)
        result = await _structured(llm, StrictSelectedItems).ainvoke([HumanMessage(content="Select index 0")])
    assert bool(result['parsed']) is valid
    assert bool(result['parsing_error']) is not valid
    assert result['raw'].usage_metadata['total_tokens'] == 15
    assert requests[0]['response_format']['type'] == 'json_schema'
    assert requests[0]['provider']['require_parameters'] is True
    assert 'tools' not in requests[0] and 'tool_choice' not in requests[0]
    if valid:
        _validate_selection(result['parsed'], 1, 1, 1, 1)
        assert ['experience'][result['parsed'].selected_experience_indices[0]] == 'experience'


@pytest.mark.parametrize('failure', ['missing_tool_text', 'invalid_selection', '502', 'timeout'])
async def test_real_clients_fallback_and_safe_metrics(monkeypatch, failure):
    from src.pipeline import nodes
    from src.core.config import settings
    cfg = replace(llm_config_service.get_tier_config('pro'), model='gemini-3.8-flash-tiered',
                  fallback_provider='openrouter', fallback_model='google/gemini-3.8-flash')
    monkeypatch.setattr(llm_config_service, 'get_tier_config', lambda tier: cfg)
    attempts, metrics = [], []
    def respond(request):
        primary = request.url.host != 'openrouter.ai'
        attempts.append('omniroute' if primary else 'openrouter')
        payload = json.loads(request.content)
        assert 'tools' not in payload
        if primary and failure == '502':
            return httpx.Response(502, json={'error': {'message': 'PRIVATE upstream response', 'type': 'gateway_error'}})
        if primary and failure == 'timeout':
            raise httpx.ReadTimeout('PRIVATE timeout', request=request)
        content = '{"selected_experience_indices":[0],"selected_project_indices":[0]}'
        if primary:
            content = 'PRIVATE prose with no required tool call' if failure == 'missing_tool_text' else '{"selected_experience_indices":[99],"selected_project_indices":[0]}'
        return httpx.Response(200, json={'id': 'synthetic', 'object': 'chat.completion', 'created': 0,
            'model': payload['model'], 'choices': [{'index': 0, 'finish_reason': 'stop',
            'message': {'role': 'assistant', 'content': content}}]})
    async def metric(*args, **kwargs):
        metrics.append((args, kwargs))
    monkeypatch.setattr(nodes, 'record_node_metric', metric)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        def make(primary):
            llm = ChatOpenAI(model=cfg.model if primary else cfg.fallback_model, api_key='synthetic-key', max_retries=0,
                base_url=settings.PRO_MODEL_BASE_URL if primary else 'https://openrouter.ai/api/v1', http_async_client=client)
            object.__setattr__(llm, '_route_provider', 'omniroute' if primary else 'openrouter')
            return llm
        monkeypatch.setattr(llm_config_service, 'get_llm', lambda **kw: make(True))
        monkeypatch.setattr(llm_config_service, 'get_fallback_llm', lambda **kw: make(False))
        result = await invoke_with_fallback(lambda llm, p: _structured(llm, StrictSelectedItems, p),
            [HumanMessage(content='Synthetic profile')], is_pro=True,
            validate_result=lambda value: _validate_selection(value, 1, 1, 1, 1))
    assert result.selected_project_indices == [0]
    assert attempts == ['omniroute'] * (1 if failure == '502' else 2) + ['openrouter']
    assert metrics[-1][1]['fallback_used'] is True
    assert 'PRIVATE' not in str(metrics) and 'synthetic-key' not in str(metrics)
