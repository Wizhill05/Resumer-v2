"""Audio contract tests through the real LangChain/OpenAI serializer, without network."""
import base64
import json
from dataclasses import replace
from unittest.mock import AsyncMock

import httpx
import pytest
from langchain_openai import ChatOpenAI

from src.api.feedback import ALLOWED_VOICE_TYPES
from src.pipeline import nodes
from src.services import feedback_ai
from src.services.llm_config import llm_config_service


FORMATS = [
    ("audio/webm", "webm"), ("audio/webm;codecs=opus", "webm"),
    ("audio/ogg", "ogg"), ("audio/ogg;codecs=opus", "ogg"),
    ("audio/mp4", "mp4"), ("audio/mp4;codecs=mp4a.40.2", "mp4"),
    ("audio/wav", "wav"), ("audio/x-wav", "wav"),
    ("audio/mpeg", "mp3"), ("audio/mp3", "mp3"),
    (" Audio/WebM ; codecs=opus", "webm"),
]


def test_covers_every_upload_format():
    assert ALLOWED_VOICE_TYPES <= {mime for mime, _ in FORMATS}


@pytest.fixture
def route_setup(monkeypatch):
    cfg = replace(llm_config_service.get_tier_config("free"), provider_name="openrouter",
                  base_url="https://openrouter.ai/api/v1",
                  model="google/gemini-2.5-flash", fallback_provider="openrouter",
                  fallback_model="google/gemini-3.8-flash")
    monkeypatch.setattr(llm_config_service, "get_tier_config", lambda tier: cfg)
    metrics = AsyncMock()
    monkeypatch.setattr(nodes, "record_node_metric", metrics)
    monkeypatch.setattr(nodes.asyncio, "sleep", AsyncMock())
    return cfg, metrics


def completion(model, content):
    return httpx.Response(200, json={"id": "synthetic", "object": "chat.completion", "created": 0,
        "model": model, "choices": [{"index": 0, "finish_reason": "stop",
        "message": {"role": "assistant", "content": content}}]})


def install_clients(monkeypatch, client, cfg):
    def make(primary):
        llm = ChatOpenAI(model=cfg.model if primary else cfg.fallback_model, api_key="synthetic-key",
            base_url=cfg.base_url if primary else "https://openrouter.ai/api/v1",
            http_async_client=client, max_retries=0)
        object.__setattr__(llm, "_route_provider", cfg.provider_name if primary else "openrouter")
        return llm
    monkeypatch.setattr(llm_config_service, "get_llm", lambda **kw: make(True))
    monkeypatch.setattr(llm_config_service, "get_fallback_llm", lambda **kw: make(False))


@pytest.mark.parametrize("mime,fmt", FORMATS)
async def test_recorder_and_upload_formats_reach_gateway(monkeypatch, route_setup, mime, fmt):
    cfg, metrics = route_setup
    requests = []
    recording = b"synthetic audio payload"
    def respond(request):
        requests.append(json.loads(request.content))
        return completion(cfg.model, "  The export button failed. \n")
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        install_clients(monkeypatch, client, cfg)
        assert await feedback_ai.transcribe_audio_bytes(recording, mime) == "The export button failed."
    assert len(requests) == 1
    assert requests[0]["messages"][0]["content"][1] == {
        "type": "input_audio", "input_audio": {"format": fmt,
        "data": base64.b64encode(recording).decode()}}
    assert metrics.await_args.args[1] == "support_transcription"


@pytest.mark.parametrize("failure", ["unsupported_audio", "empty_transcript", "non_text", "timeout"])
async def test_audio_failure_uses_independent_fallback(monkeypatch, route_setup, failure):
    cfg, metrics = route_setup
    attempts = []
    def respond(request):
        primary = json.loads(request.content)["model"] == cfg.model
        attempts.append("primary" if primary else "fallback")
        if primary and failure == "unsupported_audio":
            return httpx.Response(400, json={"error": {"message": "PRIVATE audio not supported"}})
        if primary and failure == "timeout":
            raise httpx.ReadTimeout("PRIVATE timeout", request=request)
        content = (" " if failure == "empty_transcript" else None) if primary else "Recording transcribed."
        return completion(cfg.model, content)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        install_clients(monkeypatch, client, cfg)
        assert await feedback_ai.transcribe_audio_bytes(b"synthetic", "audio/webm;codecs=opus") == "Recording transcribed."
    assert attempts == ["primary", "fallback"]
    assert metrics.await_args.kwargs["fallback_used"] is True
    assert "PRIVATE" not in str(metrics.await_args_list)


async def test_unverified_omniroute_is_skipped_without_saving_unrelated_text(monkeypatch, route_setup, caplog):
    cfg, _ = route_setup
    cfg.provider_name = "omniroute"
    cfg.base_url = "https://omniroute-latest-rmm0.onrender.com/"
    cfg.model = "gemini-3.8-flash-tiered"
    requests = []
    def respond(request):
        requests.append(request.url.host)
        assert json.loads(request.content)["model"] == cfg.fallback_model
        return completion(cfg.fallback_model, "The export button failed.")
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        install_clients(monkeypatch, client, cfg)
        assert await feedback_ai.transcribe_audio_bytes(b"synthetic", "audio/webm") == "The export button failed."
    assert requests == ["openrouter.ai"]
    assert "OmniRoute audio transcription unavailable" in caplog.text


@pytest.mark.parametrize("status", [400, 402, 502])
async def test_exhausted_audio_routes_log_safe_failure(monkeypatch, route_setup, caplog, status):
    cfg, _ = route_setup
    def respond(request):
        return httpx.Response(status, json={"error": {"message": "PRIVATE audio payload synthetic-key"}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        install_clients(monkeypatch, client, cfg)
        assert await feedback_ai.transcribe_audio_bytes(b"PRIVATE recording", "audio/ogg") is None
    assert "Audio transcription failed" in caplog.text
    assert "PRIVATE" not in caplog.text and "synthetic-key" not in caplog.text


@pytest.mark.parametrize("data,mime", [(b"", "audio/wav"), (b"synthetic", "text/plain")])
async def test_unusable_input_skips_network_with_warning(monkeypatch, caplog, data, mime):
    invoke = AsyncMock()
    monkeypatch.setattr(feedback_ai, "invoke_with_fallback", invoke)
    assert await feedback_ai.transcribe_audio_bytes(data, mime) is None
    invoke.assert_not_called()
    assert "transcription skipped" in caplog.text
