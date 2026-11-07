"""Pure helpers and async httpx probes for OpenAI-compatible endpoints. No DB access."""
from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import re
import socket
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

logger = logging.getLogger(__name__)

MAX_RESPONSE_BYTES = 2_000_000


class ProbeError(Exception):
    def __init__(self, code: str, message: str, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "status_code": self.status_code}


_TRAILING_SUFFIXES = ("/chat/completions", "/completions", "/models")
_V1_PATH_RE = re.compile(r"/v\d+[a-z]*(/openai)?$")


def normalize_base_url(raw: str) -> str:
    if raw is None:
        raise ProbeError("invalid_url", "A base URL is required.")
    value = str(raw).strip()
    if not value:
        raise ProbeError("invalid_url", "A base URL is required.")
    if "://" not in value:
        value = "https://" + value
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https"):
        raise ProbeError("invalid_url", "The base URL must use http or https.")
    if parts.username or parts.password:
        raise ProbeError("invalid_url", "The base URL must not contain credentials.")
    if parts.query or parts.fragment:
        raise ProbeError("invalid_url", "The base URL must not contain a query string or fragment.")
    if not parts.hostname:
        raise ProbeError("invalid_url", "The base URL must include a host.")
    host = parts.hostname.lower()
    scheme = parts.scheme.lower()
    netloc = host
    try:
        port = parts.port
    except ValueError:
        raise ProbeError("invalid_url", "The base URL has an invalid port.") from None
    if port:
        netloc = f"{host}:{port}"
    path = parts.path.rstrip("/") or ""
    # Strip a trailing endpoint suffix once, e.g. .../v1/chat/completions -> .../v1
    for suffix in _TRAILING_SUFFIXES:
        if path.endswith(suffix):
            path = path[: -len(suffix)]
            break
    path = path.rstrip("/")
    return f"{scheme}://{netloc}{path}"


def candidate_api_bases(normalized: str) -> list[str]:
    parts = urlsplit(normalized)
    path = parts.path.rstrip("/") or ""
    if _V1_PATH_RE.search(path) or path.endswith("/openai"):
        return [normalized]
    with_v1 = f"{normalized}/v1"
    result = [with_v1, normalized]
    seen: set[str] = set()
    out: list[str] = []
    for item in result:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


async def assert_host_allowed(url: str) -> None:
    parts = urlsplit(url)
    host = parts.hostname
    if not host:
        raise ProbeError("invalid_url", "The base URL must include a host.")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ProbeError("dns_error", f"Could not resolve host {host!r}. Check the URL.") from exc
    except OSError as exc:
        raise ProbeError("dns_error", f"Could not resolve host {host!r}. Check the URL.") from exc
    for info in infos:
        sockaddr = info[4]
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if (
            ip.is_link_local
            or ip.is_multicast
            or ip.is_unspecified
            or ip.is_reserved
            or ip == ipaddress.ip_address("169.254.169.254")
            or ip == ipaddress.ip_address("fd00:ec2::254")
        ):
            raise ProbeError(
                "blocked_host",
                "That host resolves to a blocked address. Link-local and metadata addresses are not allowed.",
            )


def build_headers(api_key: str | None, extra_headers: dict[str, str]) -> dict[str, str]:
    headers: dict[str, str] = {"Accept": "application/json"}
    headers.update(extra_headers or {})
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def classify_model(model_id: str, item: dict | None = None) -> str:
    mid = (model_id or "").lower()
    if "embed" in mid:
        return "embedding"
    if any(p in mid for p in ("whisper", "tts", "transcri", "audio")):
        return "audio"
    if any(p in mid for p in ("dall-e", "image", "imagen", "flux", "stable-diffusion", "sdxl")):
        return "image"
    if any(p in mid for p in ("moderation", "guard", "rerank")):
        return "moderation"
    return "chat"


def _first_int(item: dict, keys: list[str]) -> int | None:
    for key in keys:
        value = item.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
        if isinstance(value, float) and float(value).is_integer():
            return int(value)
        if isinstance(value, str) and value.strip().isdigit():
            return int(value.strip())
    return None


def parse_models_payload(payload: Any) -> list[dict]:
    items: Any = None
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            items = payload["data"]
        elif isinstance(payload.get("models"), list):
            items = payload["models"]
        elif isinstance(payload.get("data"), dict) and isinstance(payload["data"].get("models"), list):
            items = payload["data"]["models"]
    if items is None:
        raise ProbeError("bad_response", "The server returned an unrecognised models payload.")
    if len(items) == 0:
        raise ProbeError("no_models", "The server returned no models.")

    models: dict[str, dict] = {}
    for item in items:
        if isinstance(item, str):
            model_id = item.strip()
            if not model_id:
                continue
            owned_by = None
            context_length = None
            capabilities: list[str] = []
            raw_item: dict | None = None
        elif isinstance(item, dict):
            model_id = str(item.get("id") or item.get("name") or item.get("model") or "").strip()
            if not model_id:
                continue
            owned_by = item.get("owned_by") or item.get("owner") or item.get("organization")
            owned_by = str(owned_by) if owned_by else None
            context_length = _first_int(
                item,
                ["context_length", "context_window", "max_context_length", "max_model_len", "inputTokenLimit"],
            )
            if context_length is None:
                top_provider = item.get("top_provider")
                if isinstance(top_provider, dict):
                    context_length = _first_int(top_provider, ["context_length"])
            capabilities = []
            supported = item.get("supported_parameters") or []
            if isinstance(supported, list):
                if "response_format" in supported or "structured_outputs" in supported:
                    capabilities.append("json_schema")
                if "tools" in supported:
                    capabilities.append("tools")
            architecture = item.get("architecture")
            modalities: list = []
            if isinstance(architecture, dict):
                modalities = architecture.get("input_modalities") or []
            if isinstance(modalities, list):
                if "image" in modalities:
                    capabilities.append("vision")
                if "audio" in modalities:
                    capabilities.append("audio_input")
            raw_item = item
        else:
            continue
        if model_id in models:
            continue
        models[model_id] = {
            "id": model_id,
            "owned_by": owned_by,
            "context_length": context_length,
            "kind": classify_model(model_id, raw_item),
            "capabilities": capabilities,
        }
    if not models:
        raise ProbeError("bad_response", "The server returned an unrecognised models payload.")
    result = sorted(models.values(), key=lambda m: m["id"].lower())
    return result[:5000]


def suggest_model(models: list[dict]) -> str | None:
    chat = [m for m in models if m.get("kind") == "chat"]
    if not chat:
        return None
    patterns = [
        r"gpt-4\.1-mini|gpt-4o-mini",
        r"flash",
        r"mini",
        r"sonnet|haiku",
        r"instruct|chat",
    ]
    for pattern in patterns:
        for model in chat:
            if re.search(pattern, model["id"], flags=re.I):
                return model["id"]
    return chat[0]["id"]


def suggest_name(normalized_url: str) -> str:
    hostname = (urlsplit(normalized_url).hostname or "").lower()
    if hostname.startswith("www."):
        hostname = hostname[4:]
    if hostname.startswith("api."):
        hostname = hostname[4:]
    return hostname or "Endpoint"


def map_http_error(exc_or_status: Any) -> ProbeError:
    status: int | None = None
    if isinstance(exc_or_status, bool):
        status = None
    elif isinstance(exc_or_status, int):
        status = exc_or_status
    else:
        status = getattr(exc_or_status, "status_code", None)

    if isinstance(exc_or_status, httpx.ConnectTimeout) or isinstance(exc_or_status, httpx.ReadTimeout):
        return ProbeError("timeout", "The request timed out. Try a longer timeout or check the server.")
    if isinstance(exc_or_status, httpx.TimeoutException):
        return ProbeError("timeout", "The request timed out. Try a longer timeout or check the server.")
    if isinstance(exc_or_status, httpx.ConnectError):
        text = str(exc_or_status).lower()
        if "ssl" in text or "tls" in text or "certificate" in text:
            return ProbeError("tls_error", "The server TLS handshake failed. Check the URL and certificates.")
        return ProbeError("connect_error", "Could not connect to the server. Check the URL and that it is reachable.")
    if isinstance(exc_or_status, httpx.HTTPError):
        return ProbeError("connect_error", "Could not connect to the server. Check the URL and that it is reachable.")

    if status == 401:
        return ProbeError("unauthorized", "The server rejected the bearer token (HTTP 401). Check the token.", 401)
    if status == 403:
        return ProbeError("forbidden", "The server forbade this request (HTTP 403). Check the token and permissions.", 403)
    if status == 404:
        return ProbeError("not_found", "No models endpoint at this URL (HTTP 404). Check the base URL.", 404)
    if status == 429:
        return ProbeError("rate_limited", "The server is rate limiting requests (HTTP 429). Retry later.", 429)
    if status is not None and 500 <= status <= 599:
        return ProbeError("server_error", f"The server errored (HTTP {status}). Try again later.", status)
    if status is not None and 400 <= status <= 499:
        return ProbeError("http_error", f"The request failed (HTTP {status}). Check the URL and token.", status)
    if status is not None:
        return ProbeError("http_error", f"Unexpected response (HTTP {status}).", status)
    return ProbeError("http_error", "Unexpected response from the server.")


async def fetch_models(
    base_url: str,
    api_key: str | None,
    extra_headers: dict[str, str],
    timeout: float = 15.0,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict:
    started = time.perf_counter()
    attempts: list[dict] = []
    last_probe_error: ProbeError | None = None
    normalized: str | None = None
    models_url: str | None = None
    models: list[dict] = []

    try:
        normalized = normalize_base_url(base_url)
    except ProbeError as exc:
        return {
            "ok": False,
            "normalized_base_url": None,
            "models_url": None,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "models": [],
            "attempts": attempts,
            "error": exc.to_dict(),
        }

    headers = build_headers(api_key, extra_headers)
    for api_base in candidate_api_bases(normalized):
        try:
            await assert_host_allowed(api_base)
        except ProbeError as exc:
            attempts.append({"url": f"{api_base}/models", "status_code": None, "error_code": exc.code})
            last_probe_error = exc
            continue
        url = f"{api_base}/models"
        try:
            async with httpx.AsyncClient(
                timeout=timeout, follow_redirects=False, transport=transport
            ) as client:
                async with client.stream("GET", url, headers=headers) as response:
                    status = response.status_code
                    if status in (301, 302, 303, 307, 308):
                        location = response.headers.get("location", "")
                        err = ProbeError(
                            "http_error",
                            f"Redirected to {location}; use that URL directly." if location else "The server redirected the request.",
                            status,
                        )
                        attempts.append({"url": url, "status_code": status, "error_code": "http_error"})
                        last_probe_error = err
                        continue
                    if status < 200 or status >= 300:
                        err = map_http_error(httpx.Response(status))
                        attempts.append({"url": url, "status_code": status, "error_code": err.code})
                        last_probe_error = err
                        if status in (401, 403):
                            break
                        continue
                    body = bytearray()
                    too_large = False
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_RESPONSE_BYTES:
                            too_large = True
                            break
                    if too_large:
                        err = ProbeError("too_large", "The server response was too large to parse.")
                        attempts.append({"url": url, "status_code": status, "error_code": "too_large"})
                        last_probe_error = err
                        continue
                    try:
                        payload = json.loads(bytes(body).decode("utf-8", errors="replace"))
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        err = ProbeError("bad_response", "The server did not return JSON for the models list.")
                        attempts.append({"url": url, "status_code": status, "error_code": "bad_response"})
                        last_probe_error = err
                        continue
                    try:
                        parsed = parse_models_payload(payload)
                    except ProbeError as exc:
                        attempts.append({"url": url, "status_code": status, "error_code": exc.code})
                        last_probe_error = exc
                        continue
                    attempts.append({"url": url, "status_code": status, "error_code": None})
                    return {
                        "ok": True,
                        "normalized_base_url": api_base,
                        "models_url": url,
                        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
                        "models": parsed,
                        "attempts": attempts,
                        "error": None,
                    }
        except httpx.HTTPError as exc:
            err = map_http_error(exc)
            attempts.append({"url": url, "status_code": getattr(exc, "response", None) and exc.response.status_code, "error_code": err.code})
            last_probe_error = err
            continue
        except Exception as exc:  # noqa: BLE001 - never echo str(exc): it may contain request details
            logger.warning("[llm-probe] unexpected %s while fetching models", type(exc).__name__)
            err = ProbeError("connect_error", "Could not connect to the server.")
            attempts.append({"url": url, "status_code": None, "error_code": err.code})
            last_probe_error = err
            continue

    error = last_probe_error or ProbeError("http_error", "Could not fetch the models list.")
    return {
        "ok": False,
        "normalized_base_url": None,
        "models_url": models_url,
        "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        "models": [],
        "attempts": attempts,
        "error": error.to_dict(),
    }


def _extract_content(payload: dict) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(str(part.get("text", "")))
        return "".join(parts)
    return str(content)


def _extract_usage(payload: dict) -> dict | None:
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return None
    return {
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "total_tokens": usage.get("total_tokens"),
    }


async def _post_completion(
    base_url: str,
    api_key: str | None,
    extra_headers: dict[str, str],
    extra_body: dict,
    model: str,
    prompt: str | None,
    timeout: float,
    response_format: dict | None,
    content: str,
    transport: httpx.AsyncBaseTransport | None,
    max_tokens: int = 64,
) -> tuple[int | None, dict | None, ProbeError | None]:
    url = f"{base_url.rstrip('/')}/chat/completions"
    try:
        await assert_host_allowed(url)
    except ProbeError as exc:
        return None, None, exc
    # extra_body first so admin-supplied keys can never override the probe's own fields.
    body: dict[str, Any] = dict(extra_body or {})
    body.update(
        {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": max_tokens,
            "temperature": 0,
        }
    )
    if response_format is not None:
        body["response_format"] = response_format
    headers = build_headers(api_key, extra_headers)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, transport=transport) as client:
            async with client.stream("POST", url, headers=headers, json=body) as response:
                status = response.status_code
                if status < 200 or status >= 300:
                    return status, None, map_http_error(status)
                raw = bytearray()
                async for chunk in response.aiter_bytes():
                    raw.extend(chunk)
                    if len(raw) > MAX_RESPONSE_BYTES:
                        return status, None, ProbeError("too_large", "The server response was too large to parse.", status)
    except httpx.HTTPError as exc:
        return None, None, map_http_error(exc)
    except Exception as exc:  # noqa: BLE001 - never echo str(exc)
        logger.warning("[llm-probe] unexpected %s during test completion", type(exc).__name__)
        return None, None, ProbeError("connect_error", "Could not connect to the server.")
    try:
        payload = json.loads(bytes(raw).decode("utf-8", errors="replace"))
    except (json.JSONDecodeError, ValueError):
        return status, None, ProbeError("bad_response", "The server did not return a JSON response.", status)
    if not isinstance(payload, dict):
        return status, None, ProbeError("bad_response", "The server did not return a JSON response.", status)
    return status, payload, None


async def run_test_completion(
    base_url: str,
    api_key: str | None,
    extra_headers: dict,
    extra_body: dict,
    model: str,
    prompt: str | None,
    timeout: float,
    max_tokens: int = 64,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict:
    started = time.perf_counter()
    try:
        normalized = normalize_base_url(base_url)
    except ProbeError as exc:
        return {"ok": False, "model": model, "latency_ms": None, "output": None, "usage": None, "error": exc.to_dict()}
    content = prompt or "Reply with the single word: pong"
    status, payload, error = await _post_completion(
        normalized, api_key, extra_headers or {}, extra_body or {}, model, prompt, timeout, None, content, transport, max_tokens
    )
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    if error is not None:
        # Normalise completion failures to completion_failed while keeping upstream codes where useful
        if error.code not in ("timeout", "connect_error", "tls_error", "dns_error", "blocked_host", "invalid_url"):
            pass
        return {
            "ok": False,
            "model": model,
            "latency_ms": latency_ms,
            "output": None,
            "usage": None,
            "error": error.to_dict(),
        }
    assert payload is not None
    output = _extract_content(payload)[:2000]
    return {
        "ok": True,
        "model": model,
        "latency_ms": latency_ms,
        "output": output,
        "usage": _extract_usage(payload),
        "error": None,
    }


async def detect_structured_output(
    base_url,
    api_key,
    extra_headers,
    extra_body,
    model,
    timeout,
    transport=None,
) -> dict:
    try:
        normalized = normalize_base_url(base_url)
    except ProbeError as exc:
        return {"mode": "prompt_only", "checks": [{"mode": "json_schema", "ok": False, "error": exc.to_dict()}]}
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}
    prompt = 'Return exactly {"ok": true}'
    checks: list[dict] = []

    status, payload, error = await _post_completion(
        normalized, api_key, extra_headers or {}, extra_body or {}, model, None, timeout,
        {"type": "json_schema", "json_schema": {"name": "probe", "schema": schema, "strict": True}},
        prompt, transport,
    )
    schema_ok = False
    schema_error: dict | None = None
    if payload is not None:
        content = _extract_content(payload).strip()
        # Strip a single ```json fence
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\s*\n?(.*?)\n?```$", r"\1", content.strip(), flags=re.S)
        try:
            parsed = json.loads(content) if content else None
            schema_ok = parsed == {"ok": True}
            if not schema_ok:
                schema_error = {"code": "bad_response", "message": "The model did not return the requested JSON.", "status_code": status}
        except (json.JSONDecodeError, ValueError):
            schema_error = {"code": "bad_response", "message": "The model did not return the requested JSON.", "status_code": status}
    else:
        schema_error = (error.to_dict() if error else {"code": "completion_failed", "message": "The completion failed.", "status_code": status})
    checks.append({"mode": "json_schema", "ok": schema_ok, "error": None if schema_ok else schema_error})
    if schema_ok:
        return {"mode": "json_schema", "checks": checks}

    status2, payload2, error2 = await _post_completion(
        normalized, api_key, extra_headers or {}, extra_body or {}, model, None, timeout,
        {"type": "json_object"},
        prompt, transport,
    )
    object_ok = False
    object_error: dict | None = None
    if payload2 is not None:
        content2 = _extract_content(payload2).strip()
        if content2.startswith("```"):
            content2 = re.sub(r"^```(?:json)?\s*\n?(.*?)\n?```$", r"\1", content2.strip(), flags=re.S)
        try:
            parsed2 = json.loads(content2) if content2 else None
            object_ok = isinstance(parsed2, dict) and parsed2.get("ok") is True
            if not object_ok:
                object_error = {"code": "bad_response", "message": "The model did not return the requested JSON.", "status_code": status2}
        except (json.JSONDecodeError, ValueError):
            object_error = {"code": "bad_response", "message": "The model did not return the requested JSON.", "status_code": status2}
    else:
        object_error = (error2.to_dict() if error2 else {"code": "completion_failed", "message": "The completion failed.", "status_code": status2})
    checks.append({"mode": "json_object", "ok": object_ok, "error": None if object_ok else object_error})
    mode = "json_object" if object_ok else "prompt_only"
    return {"mode": mode, "checks": checks}
