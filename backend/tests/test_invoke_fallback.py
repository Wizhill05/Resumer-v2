import pytest

from src.pipeline.nodes import invoke_with_fallback
from src.services.llm_config import llm_config_service
from src.core.api_key_pool import ApiKeyPool


@pytest.fixture(autouse=True)
def isolated_config(monkeypatch):
    from src.services.llm_config import TierConfig
    cfg = TierConfig(tier="pro", provider_name="omniroute", base_url="https://omniroute.example/v1",
                     model="gemini-3.8-flash-tiered", fallback_model="google/gemini-3.8-flash")
    monkeypatch.setattr(llm_config_service, "get_tier_config", lambda tier: cfg)

class FakeLLM:
    model_name = "fake-model"
    openai_api_base = "https://omniroute.example/v1"


class FallbackLLM:
    model_name = "fallback-model"
    openai_api_base = "https://openrouter.ai/api/v1"


class FakeRunnable:
    def __init__(self, result):
        self._result = result

    async def ainvoke(self, invoke_args, **kwargs):
        return self._result


class SentinelResult:
    pass


@pytest.mark.asyncio
async def test_invoke_with_fallback_raises_when_all_structured_outputs_missing(monkeypatch):
    monkeypatch.setattr(llm_config_service, "get_llm", lambda tier="free", api_key_override=None: FakeLLM())
    monkeypatch.setattr(llm_config_service, "get_fallback_llm", lambda tier="free", api_key_override=None: FallbackLLM())

    with pytest.raises(RuntimeError, match="All LLM providers failed"):
        await invoke_with_fallback(
            lambda llm, provider: FakeRunnable(None),
            {},
            max_attempts_per_provider=1,
        )


@pytest.mark.asyncio
async def test_invoke_with_fallback_recovers_via_provider_fallback(monkeypatch):
    monkeypatch.setattr(llm_config_service, "get_llm", lambda tier="free", api_key_override=None: FakeLLM())
    monkeypatch.setattr(llm_config_service, "get_fallback_llm", lambda tier="free", api_key_override=None: FallbackLLM())

    def chain_factory(llm, provider_name):
        if provider_name == "openrouter":
            return FakeRunnable(SentinelResult())
        return FakeRunnable(None)

    result = await invoke_with_fallback(
        chain_factory,
        {},
        max_attempts_per_provider=1,
    )

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
    monkeypatch.setattr(llm_config_service, "get_llm", lambda **kwargs: FakeLLM())
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
    from src.core.api_key_pool import ApiKeyUnavailable
    def fail(**kwargs):
        raise ApiKeyUnavailable('secret')
    monkeypatch.setattr(llm_config_service, 'get_llm', fail)
    monkeypatch.setattr(llm_config_service, 'get_fallback_llm', lambda **kwargs: FallbackLLM())
    assert isinstance(await invoke_with_fallback(lambda *_: FakeRunnable(SentinelResult()), {}, max_attempts_per_provider=1), SentinelResult)

@pytest.mark.asyncio
@pytest.mark.parametrize('reason', ['length', 'content_filter'])
async def test_interrupted_parsed_output_rejected(monkeypatch, reason):
    from types import SimpleNamespace
    from src.pipeline.nodes import InferenceExhausted
    monkeypatch.setattr(llm_config_service, 'get_llm', lambda **kwargs: FakeLLM())
    monkeypatch.setattr(llm_config_service, 'get_fallback_llm', lambda **kwargs: FallbackLLM())
    raw = SimpleNamespace(response_metadata={'finish_reason': reason})
    with pytest.raises(InferenceExhausted):
        await invoke_with_fallback(lambda *_: FakeRunnable({'raw': raw, 'parsed': SentinelResult(), 'parsing_error': None}), {}, max_attempts_per_provider=1)

@pytest.mark.asyncio
@pytest.mark.parametrize('error', [TypeError('bug'), __import__('asyncio').CancelledError()])
async def test_programming_error_and_cancellation_propagate(monkeypatch, error):
    monkeypatch.setattr(llm_config_service, 'get_llm', lambda **kwargs: FakeLLM())
    class Broken:
        async def ainvoke(self, args):
            raise error
    with pytest.raises(type(error)):
        await invoke_with_fallback(lambda *_: Broken(), {}, max_attempts_per_provider=1)

@pytest.mark.asyncio
async def test_invalid_selection_retries(monkeypatch):
    from src.pipeline.nodes import InvalidSelection
    monkeypatch.setattr(llm_config_service, 'get_llm', lambda **kwargs: FakeLLM())
    calls = []
    def validate(result):
        calls.append(result)
        if len(calls) == 1:
            raise InvalidSelection('bad')
    await invoke_with_fallback(lambda *_: FakeRunnable(SentinelResult()), {}, validate_result=validate)
    assert len(calls) == 2

@pytest.mark.asyncio
async def test_duplicate_route_skips_key_acquisition(monkeypatch):
    from dataclasses import replace
    cfg = llm_config_service.get_tier_config('free')
    cfg = replace(cfg, base_url='https://openrouter.ai/api/v1/', model='same', fallback_provider='openrouter', fallback_model='same')
    monkeypatch.setattr(llm_config_service, 'get_tier_config', lambda tier: cfg)
    calls = []
    monkeypatch.setattr(llm_config_service, 'get_llm', lambda **kwargs: calls.append('primary') or FakeLLM())
    monkeypatch.setattr(llm_config_service, 'get_fallback_llm', lambda **kwargs: calls.append('fallback') or FallbackLLM())
    with pytest.raises(RuntimeError):
        await invoke_with_fallback(lambda *_: FakeRunnable(None), {}, max_attempts_per_provider=1)
    assert calls == ['primary']

@pytest.mark.asyncio
async def test_parse_failure_does_not_quarantine(monkeypatch):
    from src.core.api_key_pool import ApiKeyPool
    def unexpected(*args, **kwargs):
        raise AssertionError('credential quarantined')
    monkeypatch.setattr(ApiKeyPool, 'mark_failure', unexpected)
    monkeypatch.setattr(llm_config_service, 'get_llm', lambda **kwargs: FakeLLM())
    monkeypatch.setattr(llm_config_service, 'get_fallback_llm', lambda **kwargs: FallbackLLM())
    with pytest.raises(RuntimeError):
        await invoke_with_fallback(lambda *_: FakeRunnable(None), {}, max_attempts_per_provider=1)

@pytest.mark.asyncio
@pytest.mark.parametrize('status', [400, 429, 503])
async def test_api_error_falls_back(monkeypatch, status):
    from openai import APIStatusError
    import httpx
    monkeypatch.setattr(llm_config_service, 'get_llm', lambda **kwargs: FakeLLM())
    monkeypatch.setattr(llm_config_service, 'get_fallback_llm', lambda **kwargs: FallbackLLM())
    class Broken:
        async def ainvoke(self, args):
            raise APIStatusError('secret', response=httpx.Response(status, request=httpx.Request('POST', 'https://example.test')), body=None)
    result = await invoke_with_fallback(lambda llm, _: Broken() if isinstance(llm, FakeLLM) else FakeRunnable(SentinelResult()), {}, max_attempts_per_provider=1)
    assert isinstance(result, SentinelResult)

@pytest.mark.asyncio
async def test_quarantine_uses_actual_pool_with_shared_key(monkeypatch):
    from src.core.api_key_pool import ApiKeyPool
    from openai import APIStatusError
    import httpx
    owner = ApiKeyPool(['shared', 'other'], 'owner')
    other = ApiKeyPool(['shared', 'other'], 'other')
    llm = FakeLLM()
    llm._credential_owner = (owner, owner.next())
    monkeypatch.setattr(llm_config_service, 'get_llm', lambda **kwargs: llm)
    monkeypatch.setattr(llm_config_service, 'get_fallback_llm', lambda **kwargs: FallbackLLM())
    class Broken:
        async def ainvoke(self, args):
            raise APIStatusError('secret', response=httpx.Response(429, request=httpx.Request('POST', 'https://example.test')), body=None)
    await invoke_with_fallback(lambda client, _: Broken() if client is llm else FakeRunnable(SentinelResult()), {}, max_attempts_per_provider=1)
    assert owner.next() == 'other'
    assert owner.next() == 'other'
    assert other.next() == 'shared'

def test_client_factory_records_pool_that_supplied_shared_key(monkeypatch):
    from dataclasses import replace
    from src.core.api_key_pool import ApiKeyPool
    from src.services import llm_config
    pool = ApiKeyPool(['shared'], 'pro')
    other = ApiKeyPool(['shared'], 'openrouter')
    monkeypatch.setattr(llm_config, 'pro_pool', pool)
    monkeypatch.setattr(llm_config, 'openrouter_pool', other)
    cfg = replace(llm_config_service.get_tier_config('pro'), base_url=__import__('src.core.config', fromlist=['settings']).settings.PRO_MODEL_BASE_URL, provider_name='omniroute')
    monkeypatch.setattr(llm_config_service, 'get_tier_config', lambda tier: cfg)
    client = llm_config_service.get_llm('pro')
    assert client._credential_owner == (pool, 'shared')

@pytest.mark.asyncio
async def test_owned_credential_not_quarantined_on_parse_failure(monkeypatch):
    from src.core.api_key_pool import ApiKeyPool
    pool = ApiKeyPool(['first', 'second'], 'test')
    llm = FakeLLM()
    llm._credential_owner = (pool, pool.next())
    monkeypatch.setattr(llm_config_service, 'get_llm', lambda **kwargs: llm)
    monkeypatch.setattr(llm_config_service, 'get_fallback_llm', lambda **kwargs: FallbackLLM())
    with pytest.raises(RuntimeError):
        await invoke_with_fallback(lambda *_: FakeRunnable(None), {}, max_attempts_per_provider=1)
    assert pool.next() == 'second'
    assert pool.next() == 'first'


def test_validate_selection_rejects_float_ints():
    from types import SimpleNamespace
    from src.pipeline.nodes import _validate_selection
    with pytest.raises(ValueError):
        _validate_selection(SimpleNamespace(selected_experience_indices=[0.0], selected_project_indices=[]), 1, 0, 1, 0)


def test_validate_selection_rejects_non_int_float():
    """Float values that are not integers (like 0.5) should be rejected."""
    from types import SimpleNamespace
    from src.pipeline.nodes import _validate_selection
    with pytest.raises(ValueError):
        _validate_selection(
            SimpleNamespace(selected_experience_indices=[0.5], selected_project_indices=[]),
            experience_count=3, project_count=0, max_exp=1, max_proj=0
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [400, 402, 404, 422, 500, 502])
async def test_hard_errors_skip_to_next_provider(monkeypatch, status):
    """A 500 InternalServerError should immediately skip to the next provider
    without wasting a second retry attempt on the same failing provider."""
    from openai import APIStatusError
    import httpx
    monkeypatch.setattr(llm_config_service, 'get_llm', lambda **kwargs: FakeLLM())
    monkeypatch.setattr(llm_config_service, 'get_fallback_llm', lambda **kwargs: FallbackLLM())

    attempts = []

    class BrokenWith500:
        async def ainvoke(self, args):
            attempts.append('primary')
            # Simulate an InternalServerError (500)
            resp = httpx.Response(status, request=httpx.Request('POST', 'https://omniroute.ai/v1'))
            raise APIStatusError('Internal Server Error', response=resp, body=None)

    result = await invoke_with_fallback(
        lambda llm, _: BrokenWith500() if isinstance(llm, FakeLLM) else FakeRunnable(SentinelResult()),
        {},
        max_attempts_per_provider=2,  # would normally allow 2 attempts
    )
    # Should only have tried primary once (not twice) before falling back
    assert attempts == ['primary'], f"Expected 1 primary attempt, got {attempts}"
    assert isinstance(result, SentinelResult)
