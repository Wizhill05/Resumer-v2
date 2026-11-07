"""Tests for invoke_with_fallback's result/parse/validate logic using patched routing."""
from unittest.mock import AsyncMock

import pytest

from src.pipeline import nodes
from src.pipeline.nodes import invoke_with_fallback
from src.services.llm_config import llm_config_service
from tests.llm_fixtures import make_target


@pytest.fixture(autouse=True)
def isolated_config(monkeypatch):
    primary = make_target(name="primary", model="primary", endpoint_id="e1", max_retries=1)
    fallback = make_target(name="fallback", model="fallback", endpoint_id="e2", max_retries=1)
    monkeypatch.setattr(llm_config_service, "ensure_fresh", AsyncMock())
    monkeypatch.setattr(llm_config_service, "resolve_targets", lambda role: [primary, fallback])
    monkeypatch.setattr(llm_config_service, "build_client", lambda target: FakeLLM() if target.endpoint.name == "primary" else FallbackLLM())
    monkeypatch.setattr(nodes, "record_node_metric", AsyncMock())


class FakeLLM:
    model_name = "fake-model"


class FallbackLLM:
    model_name = "fallback-model"


class FakeRunnable:
    def __init__(self, result):
        self._result = result

    async def ainvoke(self, invoke_args, **kwargs):
        return self._result


class SentinelResult:
    pass


@pytest.mark.asyncio
async def test_invoke_with_fallback_raises_when_all_structured_outputs_missing():
    with pytest.raises(RuntimeError, match="All LLM providers failed"):
        await invoke_with_fallback(
            lambda llm, provider: FakeRunnable(None),
            {},
            max_attempts_per_provider=1,
        )


@pytest.mark.asyncio
async def test_invoke_with_fallback_recovers_via_fallback_target():
    def chain_factory(llm, provider_name):
        if provider_name == "fallback":
            return FakeRunnable(SentinelResult())
        return FakeRunnable(None)

    result = await invoke_with_fallback(chain_factory, {}, max_attempts_per_provider=1)
    assert isinstance(result, SentinelResult)


def test_selection_schema_requires_strict_fields():
    from pydantic import ValidationError
    from src.schemas.pipeline import SelectedItems, StrictSelectedItems
    assert SelectedItems().selected_project_indices == []
    for value in ({}, {"selected_experience_indices": [], "selected_project_indices": ["0"]},
                  {"selected_experience_indices": [True], "selected_project_indices": []}):
        with pytest.raises(ValidationError):
            StrictSelectedItems.model_validate(value)


@pytest.mark.asyncio
async def test_metric_database_failure_is_not_retried(monkeypatch):
    from sqlalchemy.exc import SQLAlchemyError
    from src.pipeline import nodes

    async def fail_metric(*args, **kwargs):
        raise SQLAlchemyError("database unavailable")

    monkeypatch.setattr(nodes, "record_node_metric", fail_metric)
    with pytest.raises(SQLAlchemyError):
        await invoke_with_fallback(lambda llm, provider: FakeRunnable(SentinelResult()), {}, max_attempts_per_provider=1)


@pytest.mark.parametrize("indices", [[0, 0], [-1, 0], [0, 3], [0], [0, 1, 2], [True, 1]])
def test_selection_rejects_invalid_indices(indices):
    from types import SimpleNamespace
    from src.pipeline.nodes import _validate_selection
    with pytest.raises(ValueError):
        _validate_selection(SimpleNamespace(selected_experience_indices=indices, selected_project_indices=[]), 3, 0, 2, 0)


@pytest.mark.asyncio
async def test_initialization_failure_falls_back(monkeypatch):
    def build(target):
        if target.endpoint.name == "primary":
            raise ValueError("bad config")
        return FallbackLLM()

    monkeypatch.setattr(llm_config_service, "build_client", build)
    assert isinstance(await invoke_with_fallback(lambda *_: FakeRunnable(SentinelResult()), {}, max_attempts_per_provider=1), SentinelResult)


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["length", "content_filter"])
async def test_interrupted_parsed_output_rejected(reason):
    from types import SimpleNamespace
    from src.pipeline.nodes import InferenceExhausted
    raw = SimpleNamespace(response_metadata={"finish_reason": reason})
    with pytest.raises(InferenceExhausted):
        await invoke_with_fallback(lambda *_: FakeRunnable({"raw": raw, "parsed": SentinelResult(), "parsing_error": None}), {}, max_attempts_per_provider=1)


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [TypeError("bug"), __import__("asyncio").CancelledError()])
async def test_programming_error_and_cancellation_propagate(error):
    class Broken:
        async def ainvoke(self, args):
            raise error

    with pytest.raises(type(error)):
        await invoke_with_fallback(lambda *_: Broken(), {}, max_attempts_per_provider=1)


@pytest.mark.asyncio
async def test_invalid_selection_retries():
    from src.pipeline.nodes import InvalidSelection
    calls = []

    def validate(result):
        calls.append(result)
        if len(calls) == 1:
            raise InvalidSelection("bad")

    await invoke_with_fallback(lambda *_: FakeRunnable(SentinelResult()), {}, validate_result=validate)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_parse_failure_does_not_cooldown():
    import src.services.llm_config as llm_config_module

    def unexpected(endpoint_id):
        raise AssertionError("endpoint cooled down")

    import unittest.mock as mock

    with mock.patch.object(llm_config_service, "mark_cooldown", unexpected):
        with pytest.raises(RuntimeError):
            await invoke_with_fallback(lambda *_: FakeRunnable(None), {}, max_attempts_per_provider=1)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [400, 429, 503])
async def test_api_error_falls_back(status):
    from openai import APIStatusError
    import httpx

    class Broken:
        async def ainvoke(self, args):
            raise APIStatusError("secret", response=httpx.Response(status, request=httpx.Request("POST", "https://example.test")), body=None)

    result = await invoke_with_fallback(lambda llm, _: Broken() if isinstance(llm, FakeLLM) else FakeRunnable(SentinelResult()), {}, max_attempts_per_provider=1)
    assert isinstance(result, SentinelResult)


def test_validate_selection_rejects_float_ints():
    from types import SimpleNamespace
    from src.pipeline.nodes import _validate_selection
    with pytest.raises(ValueError):
        _validate_selection(SimpleNamespace(selected_experience_indices=[0.0], selected_project_indices=[]), 1, 0, 1, 0)


def test_validate_selection_rejects_non_int_float():
    from types import SimpleNamespace
    from src.pipeline.nodes import _validate_selection
    with pytest.raises(ValueError):
        _validate_selection(
            SimpleNamespace(selected_experience_indices=[0.5], selected_project_indices=[]),
            experience_count=3, project_count=0, max_exp=1, max_proj=0
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [400, 402, 404, 422, 500, 502])
async def test_hard_errors_skip_to_next_provider(status):
    from openai import APIStatusError
    import httpx

    attempts = []

    class BrokenWith500:
        async def ainvoke(self, args):
            attempts.append("primary")
            resp = httpx.Response(status, request=httpx.Request("POST", "https://example.test/v1"))
            raise APIStatusError("Internal Server Error", response=resp, body=None)

    result = await invoke_with_fallback(
        lambda llm, _: BrokenWith500() if isinstance(llm, FakeLLM) else FakeRunnable(SentinelResult()),
        {},
        max_attempts_per_provider=2,
    )
    assert attempts == ["primary"], f"Expected 1 primary attempt, got {attempts}"
    assert isinstance(result, SentinelResult)
