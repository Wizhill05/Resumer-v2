"""Tests for src/services/llm_probe.py. All HTTP is mocked."""
import asyncio
import json

import httpx
import pytest

from src.services import llm_probe
from src.services.llm_probe import (
    ProbeError,
    assert_host_allowed,
    candidate_api_bases,
    classify_model,
    detect_structured_output,
    fetch_models,
    normalize_base_url,
    parse_models_payload,
    suggest_model,
)


_REAL_ASSERT_HOST_ALLOWED = llm_probe.assert_host_allowed


@pytest.fixture(autouse=True)
def _no_dns(monkeypatch):
    monkeypatch.setattr(llm_probe, "assert_host_allowed", _noop_host_allowed)


async def _noop_host_allowed(url: str):
    return None


@pytest.mark.parametrize(
    "raw,expected",
    [
        (" api.x.com/ ", "https://api.x.com"),
        ("https://x/v1/chat/completions", "https://x/v1"),
        ("https://x/v1/models", "https://x/v1"),
        ("https://x/v1/completions/", "https://x/v1"),
    ],
)
def test_normalize_base_url(raw, expected):
    assert normalize_base_url(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["ftp://x", "https://u:p@x", "https://x?a=1", "https://x#frag", ""],
)
def test_normalize_base_url_rejects(raw):
    with pytest.raises(ProbeError) as exc:
        normalize_base_url(raw)
    assert exc.value.code == "invalid_url"


def test_candidate_api_bases():
    assert candidate_api_bases("https://x") == ["https://x/v1", "https://x"]
    assert candidate_api_bases("https://x/api/v1") == ["https://x/api/v1"]
    assert candidate_api_bases("https://g/v1beta/openai") == ["https://g/v1beta/openai"]
    assert candidate_api_bases("https://x/openai") == ["https://x/openai"]


def test_parse_models_payload_shapes():
    payload = {"data": [{"id": "b", "owned_by": "o"}, {"id": "a"}]}
    models = parse_models_payload(payload)
    assert [m["id"] for m in models] == ["a", "b"]

    models = parse_models_payload({"models": [{"name": "solo"}]})
    assert models[0]["id"] == "solo"

    models = parse_models_payload(["z", "y"])
    assert [m["id"] for m in models] == ["y", "z"]

    models = parse_models_payload({"data": {"models": [{"model": "m1"}]}})
    assert models[0]["id"] == "m1"

    models = parse_models_payload({"data": [{"id": "dup"}, {"id": "dup"}]})
    assert len(models) == 1


def test_parse_models_payload_empty_and_bad():
    with pytest.raises(ProbeError) as exc:
        parse_models_payload({"data": []})
    assert exc.value.code == "no_models"
    with pytest.raises(ProbeError) as exc:
        parse_models_payload({"foo": 1})
    assert exc.value.code == "bad_response"


def test_parse_models_payload_capabilities_and_context():
    payload = {
        "data": [
            {
                "id": "gpt-4.1",
                "owned_by": "openai",
                "context_length": 128000,
                "supported_parameters": ["response_format", "tools"],
                "architecture": {"input_modalities": ["image", "audio"]},
            }
        ]
    }
    models = parse_models_payload(payload)
    assert models[0]["context_length"] == 128000
    assert set(models[0]["capabilities"]) == {"json_schema", "tools", "vision", "audio_input"}


@pytest.mark.parametrize(
    "model_id,kind",
    [
        ("text-embedding-3-small", "embedding"),
        ("whisper-1", "audio"),
        ("dall-e-3", "image"),
        ("flux-pro", "image"),
        ("gpt-4o", "chat"),
    ],
)
def test_classify_model(model_id, kind):
    assert classify_model(model_id) == kind


def test_suggest_model_prefers_chat():
    models = parse_models_payload(
        {"data": [{"id": "text-embedding-3-small"}, {"id": "gpt-4.1-mini"}, {"id": "other"}]}
    )
    assert suggest_model(models) == "gpt-4.1-mini"
    models = parse_models_payload({"data": [{"id": "text-embedding-3-small"}]})
    assert suggest_model(models) is None


def _transport(handler):
    return httpx.MockTransport(handler)


async def test_fetch_models_v1_fallback():
    seen_auth = []

    def handler(request: httpx.Request):
        seen_auth.append(request.headers.get("authorization"))
        if str(request.url) == "https://x/v1/models":
            return httpx.Response(404, json={"error": "nope"})
        if str(request.url) == "https://x/models":
            return httpx.Response(200, json={"data": [{"id": "m1"}]})
        return httpx.Response(404)

    result = await fetch_models("https://x", "sk-secret-token", {}, transport=_transport(handler))
    assert result["ok"] is True
    assert result["normalized_base_url"] == "https://x"
    assert seen_auth[0] == "Bearer sk-secret-token"
    assert all("sk-secret" not in a["url"] for a in result["attempts"])


async def test_fetch_models_v1_direct():
    def handler(request: httpx.Request):
        if str(request.url) == "https://x/v1/models":
            return httpx.Response(200, json={"data": [{"id": "m1"}]})
        return httpx.Response(404)

    result = await fetch_models("https://x", None, {}, transport=_transport(handler))
    assert result["ok"] is True
    assert result["normalized_base_url"] == "https://x/v1"


async def test_fetch_models_401_stops():
    calls = []

    def handler(request: httpx.Request):
        calls.append(str(request.url))
        return httpx.Response(401, json={"error": "bad"})

    result = await fetch_models("https://x", "sk-secret", {}, transport=_transport(handler))
    assert result["ok"] is False
    assert result["error"]["code"] == "unauthorized"
    assert len(calls) == 1
    assert "sk-secret" not in result["error"]["message"]
    assert all("sk-secret" not in a["url"] for a in result["attempts"])


async def test_fetch_models_timeout():
    def handler(request: httpx.Request):
        raise httpx.ReadTimeout("timed out", request=request)

    result = await fetch_models("https://x", None, {}, transport=_transport(handler))
    assert result["ok"] is False
    assert result["error"]["code"] == "timeout"


async def test_fetch_models_too_large():
    def handler(request: httpx.Request):
        return httpx.Response(200, content=b"x" * (2_000_001), headers={"content-type": "application/json"})

    result = await fetch_models("https://x/v1", None, {}, transport=_transport(handler))
    assert result["ok"] is False
    assert result["error"]["code"] == "too_large"


async def test_fetch_models_non_json():
    def handler(request: httpx.Request):
        return httpx.Response(200, content=b"<html>nope</html>")

    result = await fetch_models("https://x/v1", None, {}, transport=_transport(handler))
    assert result["ok"] is False
    assert result["error"]["code"] == "bad_response"


async def test_assert_host_allowed_blocks_metadata(monkeypatch):
    async def fake_getaddrinfo(host, port, proto=0):
        return [(2, 1, 6, "", ("169.254.169.254", port))]

    class FakeLoop:
        async def getaddrinfo(self, host, port, proto=0):
            return await fake_getaddrinfo(host, port, proto)

    monkeypatch.setattr(asyncio, "get_running_loop", lambda: FakeLoop())
    with pytest.raises(ProbeError) as exc:
        await assert_host_allowed("https://169.254.169.254/v1")
    assert exc.value.code == "blocked_host"


async def test_assert_host_allowed_allows_loopback(monkeypatch):
    class FakeLoop:
        async def getaddrinfo(self, host, port, proto=0):
            return [(2, 1, 6, "", ("127.0.0.1", port))]

    monkeypatch.setattr(asyncio, "get_running_loop", lambda: FakeLoop())
    await assert_host_allowed("https://127.0.0.1:9911")


def _completion(content, status=200):
    return httpx.Response(
        status,
        json={
            "id": "x",
            "object": "chat.completion",
            "created": 0,
            "model": "m",
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        },
    )


async def test_detect_structured_json_schema():
    def handler(request: httpx.Request):
        body = json.loads(request.content)
        rf = body.get("response_format") or {}
        if rf.get("type") == "json_schema":
            return _completion('{"ok": true}')
        return _completion("pong")

    result = await detect_structured_output(
        "https://x/v1", None, {}, {}, "m", 5.0, _transport(handler)
    )
    assert result["mode"] == "json_schema"


async def test_detect_structured_json_object_fallback():
    def handler(request: httpx.Request):
        body = json.loads(request.content)
        rf = body.get("response_format") or {}
        if rf.get("type") == "json_schema":
            return httpx.Response(400, json={"error": "bad"})
        if rf.get("type") == "json_object":
            return _completion('{"ok": true}')
        return _completion("pong")

    result = await detect_structured_output(
        "https://x/v1", None, {}, {}, "m", 5.0, _transport(handler)
    )
    assert result["mode"] == "json_object"


async def test_detect_structured_prompt_only():
    def handler(request: httpx.Request):
        return httpx.Response(400, json={"error": "bad"})

    result = await detect_structured_output(
        "https://x/v1", None, {}, {}, "m", 5.0, _transport(handler)
    )
    assert result["mode"] == "prompt_only"
    assert len(result["checks"]) == 2


def test_normalize_base_url_rejects_invalid_port():
    with pytest.raises(ProbeError) as exc:
        normalize_base_url("https://x:99999")
    assert exc.value.code == "invalid_url"


def test_extra_headers_reject_non_ascii():
    from src.schemas.llm import LlmEndpointCreate

    with pytest.raises(Exception):
        LlmEndpointCreate(base_url="https://x", extra_headers={"X-Test": "café"})


@pytest.mark.asyncio
async def test_test_completion_blocks_metadata_host_and_never_sends(monkeypatch):
    monkeypatch.setattr(llm_probe, "assert_host_allowed", _REAL_ASSERT_HOST_ALLOWED)
    from src.services.llm_probe import run_test_completion

    sent = []

    def handler(request):
        sent.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "pong"}}]})

    result = await run_test_completion(
        "http://169.254.169.254/latest", None, {}, {}, "m", None, 5.0,
        transport=httpx.MockTransport(handler),
    )
    assert result["ok"] is False
    assert result["error"]["code"] == "blocked_host"
    assert sent == []


@pytest.mark.asyncio
async def test_detect_structured_output_blocks_metadata_host(monkeypatch):
    monkeypatch.setattr(llm_probe, "assert_host_allowed", _REAL_ASSERT_HOST_ALLOWED)
    from src.services.llm_probe import detect_structured_output

    sent = []

    def handler(request):
        sent.append(request)
        return httpx.Response(200, json={})

    res = await detect_structured_output(
        "http://169.254.169.254", None, {}, {}, "m", 5.0, transport=httpx.MockTransport(handler)
    )
    assert res["mode"] == "prompt_only"
    assert sent == []


@pytest.mark.asyncio
async def test_extra_body_cannot_override_probe_fields(monkeypatch):
    from src.services import llm_probe

    async def allow(url):
        return None

    monkeypatch.setattr(llm_probe, "assert_host_allowed", allow)
    seen = {}

    def handler(request):
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "pong"}}]})

    await llm_probe.run_test_completion(
        "https://x/v1", None, {}, {"max_tokens": 99999, "temperature": 2}, "m", None, 5.0,
        transport=httpx.MockTransport(handler),
    )
    assert seen["max_tokens"] == 64
    assert seen["temperature"] == 0


@pytest.mark.asyncio
async def test_completion_response_size_cap(monkeypatch):
    from src.services import llm_probe

    async def allow(url):
        return None

    monkeypatch.setattr(llm_probe, "assert_host_allowed", allow)
    big = b"x" * (llm_probe.MAX_RESPONSE_BYTES + 10)
    res = await llm_probe.run_test_completion(
        "https://x/v1", None, {}, {}, "m", None, 5.0,
        transport=httpx.MockTransport(lambda r: httpx.Response(200, content=big)),
    )
    assert res["ok"] is False and res["error"]["code"] == "too_large"
