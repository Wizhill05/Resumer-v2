import pytest

from src.pipeline.nodes import invoke_with_fallback
from src.services.llm_config import llm_config_service


class FakeLLM:
    model_name = "fake-model"


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
    monkeypatch.setattr(llm_config_service, "get_fallback_llm", lambda tier="free", api_key_override=None: FakeLLM())

    with pytest.raises(RuntimeError, match="All LLM providers failed"):
        await invoke_with_fallback(
            lambda llm, provider: FakeRunnable(None),
            {},
            max_attempts_per_provider=1,
        )


@pytest.mark.asyncio
async def test_invoke_with_fallback_recovers_via_provider_fallback(monkeypatch):
    monkeypatch.setattr(llm_config_service, "get_llm", lambda tier="free", api_key_override=None: FakeLLM())
    monkeypatch.setattr(llm_config_service, "get_fallback_llm", lambda tier="free", api_key_override=None: FakeLLM())

    def chain_factory(llm, provider_name):
        if provider_name == "google":
            return FakeRunnable(SentinelResult())
        return FakeRunnable(None)

    result = await invoke_with_fallback(
        chain_factory,
        {},
        max_attempts_per_provider=1,
    )

    assert isinstance(result, SentinelResult)
