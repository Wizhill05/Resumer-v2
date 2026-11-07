"""Tests for the runtime layer: resolve_targets, invoke_with_fallback, _structured, bootstrap."""
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI

from src.pipeline import nodes
from src.pipeline.nodes import (
    InferenceExhausted,
    LLMNotConfigured,
    _structured,
    invoke_with_fallback,
)
from src.schemas.pipeline import StrictSelectedItems
from src.services import llm_config
from src.services.llm_config import LLMConfigService, EndpointRuntime, ResolvedTarget
from tests.llm_fixtures import make_target


@pytest.fixture(autouse=True)
def _fresh(monkeypatch):
    monkeypatch.setattr(llm_config.llm_config_service, "ensure_fresh", AsyncMock())
    monkeypatch.setattr(nodes, "record_node_metric", AsyncMock())


def _service_with(endpoints, role_targets, role_overrides=None, cooldowns=None):
    svc = LLMConfigService()
    svc._endpoints = {e.id: e for e in endpoints}
    svc._role_targets = {role: list(v) for role, v in role_targets.items()}
    for role in ("default", "pro", "utility", "audio"):
        svc._role_targets.setdefault(role, [])
    svc._role_overrides = {role: {"temperature": None, "max_output_tokens": None} for role in ("default", "pro", "utility", "audio")}
    if role_overrides:
        for role, overrides in role_overrides.items():
            svc._role_overrides[role] = overrides
    if cooldowns:
        svc._cooldowns = dict(cooldowns)
    return svc


def test_resolve_targets_inheritance():
    ep = make_target(endpoint_id="e1", name="ep1", model="m1").endpoint
    svc = _service_with([ep], {"default": [{"endpoint_id": "e1", "model": "m1"}]})
    default = svc.resolve_targets("default")
    assert len(default) == 1 and default[0].inherited is False
    pro = svc.resolve_targets("pro")
    assert len(pro) == 1 and pro[0].inherited is True
    audio = svc.resolve_targets("audio")
    assert audio == []


def test_resolve_targets_skips_disabled_and_undecryptable():
    ep_on = make_target(endpoint_id="e1", name="ep1", model="m1").endpoint
    ep_off = make_target(endpoint_id="e2", name="ep2", model="m2").endpoint
    ep_bad = make_target(endpoint_id="e3", name="ep3", model="m3").endpoint
    from dataclasses import replace

    ep_off = replace(ep_off, enabled=False)
    ep_bad = replace(ep_bad, api_key_status="undecryptable", api_key=None)
    svc = _service_with(
        [ep_on, ep_off, ep_bad],
        {"default": [
            {"endpoint_id": "e1", "model": "m1"},
            {"endpoint_id": "e2", "model": "m2"},
            {"endpoint_id": "e3", "model": "m3"},
        ]},
    )
    targets = svc.resolve_targets("default")
    assert [t.endpoint.name for t in targets] == ["ep1"]


def test_resolve_targets_dedupe():
    ep = make_target(endpoint_id="e1", name="ep1", model="m1").endpoint
    svc = _service_with(
        [ep],
        {"default": [{"endpoint_id": "e1", "model": "m1"}, {"endpoint_id": "e1", "model": "m1"}]},
    )
    assert len(svc.resolve_targets("default")) == 1


def test_resolve_targets_cooldown_ordering():
    ep1 = make_target(endpoint_id="e1", name="ep1", model="m1").endpoint
    ep2 = make_target(endpoint_id="e2", name="ep2", model="m2").endpoint
    cooling = {"e1": time.monotonic() + 60}
    svc = _service_with(
        [ep1, ep2],
        {"default": [{"endpoint_id": "e1", "model": "m1"}, {"endpoint_id": "e2", "model": "m2"}]},
        cooldowns=cooling,
    )
    assert [t.endpoint.name for t in svc.resolve_targets("default")] == ["ep2", "ep1"]
    # All cooling -> original order
    all_cooling = {"e1": time.monotonic() + 60, "e2": time.monotonic() + 60}
    svc._cooldowns = all_cooling
    assert [t.endpoint.name for t in svc.resolve_targets("default")] == ["ep1", "ep2"]


class FakeRunnable:
    def __init__(self, result):
        self._result = result

    async def ainvoke(self, invoke_args, **kwargs):
        return self._result


@pytest.mark.asyncio
async def test_invoke_first_target_502_then_second_succeeds(monkeypatch):
    from openai import APIStatusError

    t1 = make_target(endpoint_id="e1", name="ep1", model="m1")
    t2 = make_target(endpoint_id="e2", name="ep2", model="m2")
    monkeypatch.setattr(llm_config.llm_config_service, "resolve_targets", lambda role: [t1, t2])
    monkeypatch.setattr(llm_config.llm_config_service, "build_client", lambda target: SimpleNamespace())

    class Broken:
        async def ainvoke(self, args):
            raise APIStatusError("bad", response=httpx.Response(502, request=httpx.Request("POST", "https://x")), body=None)

    sentinel = object()
    result = await invoke_with_fallback(
        lambda llm, name: Broken() if name == "ep1" else FakeRunnable(sentinel),
        {},
        max_attempts_per_provider=1,
    )
    assert result is sentinel
    # metric for the successful fallback must record fallback_used=True
    last_call = nodes.record_node_metric.await_args
    assert last_call.kwargs["fallback_used"] is True


@pytest.mark.asyncio
async def test_invoke_429_marks_cooldown(monkeypatch):
    from openai import APIStatusError

    t1 = make_target(endpoint_id="e1", name="ep1", model="m1")
    t2 = make_target(endpoint_id="e2", name="ep2", model="m2")
    marked = []
    monkeypatch.setattr(llm_config.llm_config_service, "resolve_targets", lambda role: [t1, t2])
    monkeypatch.setattr(llm_config.llm_config_service, "build_client", lambda target: SimpleNamespace())
    monkeypatch.setattr(llm_config.llm_config_service, "mark_cooldown", lambda endpoint_id: marked.append(endpoint_id))

    class Broken:
        async def ainvoke(self, args):
            raise APIStatusError("bad", response=httpx.Response(429, request=httpx.Request("POST", "https://x")), body=None)

    result = await invoke_with_fallback(
        lambda llm, name: Broken() if name == "ep1" else FakeRunnable("ok"),
        {},
        max_attempts_per_provider=1,
    )
    assert result == "ok"
    assert marked == ["e1"]


@pytest.mark.asyncio
async def test_invoke_no_targets_raises_not_configured(monkeypatch):
    monkeypatch.setattr(llm_config.llm_config_service, "resolve_targets", lambda role: [])
    with pytest.raises(LLMNotConfigured):
        await invoke_with_fallback(lambda llm, name: FakeRunnable("ok"), {}, role="audio")
    with pytest.raises(InferenceExhausted):
        await invoke_with_fallback(lambda llm, name: FakeRunnable("ok"), {}, role="audio")


@pytest.mark.asyncio
async def test_audio_role_skips_when_unconfigured(monkeypatch):
    monkeypatch.setattr(llm_config.llm_config_service, "resolve_targets", lambda role: [])
    from src.services import feedback_ai

    result = await feedback_ai.transcribe_audio_bytes(b"synthetic audio", "audio/webm")
    assert result is None


def _make_chat_openai(mode: str, extra_body=None, capture=None):
    def respond(request):
        payload = json.loads(request.content)
        capture.append(payload)
        content = '{"selected_experience_indices":[0],"selected_project_indices":[0]}'
        if payload.get("response_format", {}).get("type") == "json_object":
            content = '{"selected_experience_indices":[0],"selected_project_indices":[0]}'
        return httpx.Response(200, json={"id": "x", "object": "chat.completion", "created": 0,
            "model": "m", "choices": [{"index": 0, "finish_reason": "stop",
            "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": 10}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    llm = ChatOpenAI(
        model="m", api_key="sk-test", base_url="https://api.example.com/v1",
        max_retries=0, http_async_client=client,
        extra_body=extra_body or None,
    )
    object.__setattr__(llm, "_structured_mode", mode)
    return llm


@pytest.mark.asyncio
async def test_structured_json_schema():
    captured: list = []
    llm = _make_chat_openai("json_schema", capture=captured)
    result = await _structured(llm, StrictSelectedItems).ainvoke([HumanMessage(content="x")])
    assert result["parsed"] is not None
    assert captured[0]["response_format"]["type"] == "json_schema"
    assert "provider" not in captured[0] or "require_parameters" not in str(captured[0].get("provider", {}))


@pytest.mark.asyncio
async def test_structured_json_object():
    captured: list = []
    llm = _make_chat_openai("json_object", capture=captured)
    result = await _structured(llm, StrictSelectedItems).ainvoke([HumanMessage(content="x")])
    assert result["parsed"] is not None
    assert captured[0]["response_format"] == {"type": "json_object"}


@pytest.mark.asyncio
async def test_structured_prompt_only():
    captured: list = []
    llm = _make_chat_openai("prompt_only", capture=captured)
    result = await _structured(llm, StrictSelectedItems).ainvoke([HumanMessage(content="x")])
    assert result["parsed"] is not None
    assert "response_format" not in captured[0]


@pytest.mark.asyncio
async def test_structured_extra_body_provider_passthrough():
    captured: list = []
    llm = _make_chat_openai("json_schema", extra_body={"provider": {"require_parameters": True}}, capture=captured)
    result = await _structured(llm, StrictSelectedItems).ainvoke([HumanMessage(content="x")])
    assert result["parsed"] is not None
    assert captured[0].get("provider", {}).get("require_parameters") is True


def test_build_client_headers_and_body(monkeypatch):
    from src.services.llm_config import LLMConfigService
    from src.services.llm_config import EndpointRuntime, ResolvedTarget

    svc = LLMConfigService()
    endpoint = EndpointRuntime(
        id="e1", name="ep1", base_url="https://api.example.com/v1", api_key="sk-secret-key",
        api_key_status="ok", extra_headers={"X-Flag": "1"}, extra_body={"provider": {"require_parameters": True}},
        structured_output_mode="json_schema", timeout_seconds=42.0, max_retries=1,
        default_temperature=0.3, max_output_tokens=None, enabled=True,
    )
    target = ResolvedTarget(endpoint=endpoint, model="m9", temperature=0.3, max_output_tokens=8192, inherited=False)
    captured = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(llm_config, "ChatOpenAI", FakeChatOpenAI)
    client = svc.build_client(target)
    assert captured["model"] == "m9"
    assert captured["api_key"] == "sk-secret-key"
    assert captured["default_headers"] == {"X-Flag": "1"}
    assert captured["extra_body"] == {"provider": {"require_parameters": True}}


@pytest.mark.asyncio
async def test_bootstrap_seeds_once():
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

    from src.models.user import Base
    from src.models.llm import LlmEndpoint, LlmRoleAssignment
    from src.core.config import settings as cfg

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [Base.metadata.tables["llm_endpoints"], Base.metadata.tables["llm_role_assignments"]]
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tables))
    session_maker = async_sessionmaker(engine, expire_on_commit=False)

    class FakeSettings:
        LLM_BOOTSTRAP_BASE_URL = "https://bootstrap.example.com"
        LLM_BOOTSTRAP_MODEL = "boot-model"
        LLM_BOOTSTRAP_NAME = "Primary"
        LLM_BOOTSTRAP_API_KEY = "sk-boot"

    import src.services.llm_config as lc

    original = lc.settings
    lc.settings = FakeSettings()  # type: ignore
    try:
        svc = LLMConfigService()
        async with session_maker() as session:
            await svc.bootstrap_from_env(session)
            rows = (await session.execute(select(LlmEndpoint))).scalars().all()
            assert len(rows) == 1
            assert rows[0].default_model == "boot-model"
            roles = (await session.execute(select(LlmRoleAssignment))).scalars().all()
            assert len(roles) == 1
            assert len(roles[0].targets) == 1
        async with session_maker() as session:
            await svc.bootstrap_from_env(session)
            rows = (await session.execute(select(LlmEndpoint))).scalars().all()
            assert len(rows) == 1
    finally:
        lc.settings = original
    await engine.dispose()


@pytest.mark.asyncio
async def test_invoke_429_fails_over_without_retrying_same_target(monkeypatch):
    """Regression: 401/403/429 must move to the next target immediately (max_retries=1 default)."""
    from openai import APIStatusError

    t1 = make_target(endpoint_id="e1", name="ep1", model="m1", max_retries=1)
    t2 = make_target(endpoint_id="e2", name="ep2", model="m2")
    monkeypatch.setattr(llm_config.llm_config_service, "resolve_targets", lambda role: [t1, t2])
    monkeypatch.setattr(llm_config.llm_config_service, "build_client", lambda target: SimpleNamespace())
    monkeypatch.setattr(llm_config.llm_config_service, "mark_cooldown", lambda endpoint_id: None)
    calls = {"n": 0}

    class Broken:
        async def ainvoke(self, args):
            calls["n"] += 1
            raise APIStatusError("bad", response=httpx.Response(429, request=httpx.Request("POST", "https://x")), body=None)

    result = await invoke_with_fallback(lambda llm, name: Broken() if name == "ep1" else FakeRunnable("ok"), {})
    assert result == "ok"
    assert calls["n"] == 1


def test_llm_not_configured_is_single_inference_exhausted_class():
    from src.pipeline import nodes

    assert nodes.LLMNotConfigured is llm_config.LLMNotConfigured
    assert issubclass(llm_config.LLMNotConfigured, InferenceExhausted)
