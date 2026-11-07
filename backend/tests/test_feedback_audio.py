"""Audio transcription tests: the `audio` role gates network access."""
import base64
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from langchain_openai import ChatOpenAI

from src.api.feedback import ALLOWED_VOICE_TYPES
from src.pipeline import nodes
from src.services import feedback_ai
from src.services.llm_config import llm_config_service
from tests.llm_fixtures import make_target


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
    audio_target = make_target(name="audio-ep", model="whisper-1", endpoint_id="a1", max_retries=0)
    metrics = AsyncMock()
    monkeypatch.setattr(llm_config_service, "ensure_fresh", AsyncMock())
    monkeypatch.setattr(llm_config_service, "resolve_targets", lambda role: [audio_target] if role == "audio" else [])
    monkeypatch.setattr(nodes, "record_node_metric", metrics)
    monkeypatch.setattr(nodes.asyncio, "sleep", AsyncMock())
    return audio_target, metrics


def completion(model, content):
    return httpx.Response(200, json={"id": "synthetic", "object": "chat.completion", "created": 0,
        "model": model, "choices": [{"index": 0, "finish_reason": "stop",
        "message": {"role": "assistant", "content": content}}]})


@pytest.fixture
def audio_clients(monkeypatch):
    """Build real ChatOpenAI clients pointed at the given MockTransport client."""
    def install(client, captured=None):
        captured = captured if captured is not None else []
        def build(target):
            assert target.endpoint.name == "audio-ep"
            llm = ChatOpenAI(model=target.model, api_key="synthetic-key",
                base_url=target.endpoint.base_url, http_async_client=client, max_retries=0)
            return llm
        monkeypatch.setattr(llm_config_service, "build_client", build)
        return captured
    return install


@pytest.mark.parametrize("mime,fmt", FORMATS)
async def test_recorder_and_upload_formats_reach_gateway(monkeypatch, route_setup, audio_clients, mime, fmt):
    audio_target, metrics = route_setup
    requests = []
    recording = b"synthetic audio payload"

    def respond(request):
        requests.append(json.loads(request.content))
        return completion(audio_target.model, "  The export button failed. \n")

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        audio_clients(client)
        assert await feedback_ai.transcribe_audio_bytes(recording, mime) == "The export button failed."
    assert len(requests) == 1
    assert requests[0]["messages"][0]["content"][1] == {
        "type": "input_audio", "input_audio": {"format": fmt,
        "data": base64.b64encode(recording).decode()}}
    assert metrics.await_args.args[1] == "support_transcription"


async def test_audio_role_unconfigured_skips(monkeypatch, caplog):
    import logging

    caplog.set_level(logging.INFO, logger="src.services.feedback_ai")
    monkeypatch.setattr(llm_config_service, "ensure_fresh", AsyncMock())
    monkeypatch.setattr(llm_config_service, "resolve_targets", lambda role: [])
    assert await feedback_ai.transcribe_audio_bytes(b"synthetic", "audio/webm") is None
    assert "audio role not configured" in caplog.text


@pytest.mark.parametrize("status", [400, 402, 502])
async def test_exhausted_audio_routes_log_safe_failure(monkeypatch, route_setup, audio_clients, caplog, status):
    def respond(request):
        return httpx.Response(status, json={"error": {"message": "PRIVATE audio payload synthetic-key"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        audio_clients(client)
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
