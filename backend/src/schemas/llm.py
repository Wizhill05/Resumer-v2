from __future__ import annotations

import json
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

LlmRoleId = Literal["default", "pro", "utility", "audio"]
StructuredOutputMode = Literal["json_schema", "json_object", "prompt_only"]
EndpointHealthStatus = Literal["ok", "error", "unknown"]
ApiKeyStatus = Literal["ok", "missing", "undecryptable"]
ModelKind = Literal["chat", "embedding", "audio", "image", "moderation", "other"]

LlmErrorCode = Literal[
    "invalid_url", "blocked_host", "dns_error", "connect_error", "timeout", "tls_error",
    "unauthorized", "forbidden", "not_found", "rate_limited", "server_error", "http_error",
    "bad_response", "too_large", "no_models", "missing_api_key", "undecryptable_api_key",
    "completion_failed",
]

MAX_EXTRA_HEADERS = 20
MAX_TARGETS_PER_ROLE = 3

_FORBIDDEN_HEADER_NAMES = {
    "authorization", "host", "content-length", "content-type", "cookie",
    "proxy-authorization", "x-api-key", "api-key",
}
_HEADER_KEY_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")
_EXTRA_BODY_FORBIDDEN = {"model", "messages", "stream"}


class LlmError(BaseModel):
    code: LlmErrorCode
    message: str
    status_code: int | None = None


class LlmModelInfo(BaseModel):
    id: str
    owned_by: str | None = None
    context_length: int | None = None
    kind: ModelKind = "chat"
    capabilities: list[str] = []


class LlmEndpointHealth(BaseModel):
    status: EndpointHealthStatus = "unknown"
    checked_at: str | None = None
    latency_ms: float | None = None
    error: LlmError | None = None
    cooldown_until: str | None = None


class LlmEndpointOut(BaseModel):
    id: str
    name: str
    base_url: str
    has_api_key: bool
    api_key_hint: str | None = None
    api_key_status: ApiKeyStatus = "missing"
    extra_headers: dict[str, str] = {}
    extra_body: dict[str, Any] = {}
    structured_output_mode: StructuredOutputMode = "json_schema"
    timeout_seconds: float = 60.0
    max_retries: int = 1
    default_temperature: float = 0.2
    max_output_tokens: int | None = None
    enabled: bool = True
    default_model: str | None = None
    models: list[LlmModelInfo] = []
    models_fetched_at: str | None = None
    health: LlmEndpointHealth = LlmEndpointHealth()
    used_by_roles: list[LlmRoleId] = []
    created_at: str
    updated_at: str


class LlmRoleTarget(BaseModel):
    endpoint_id: str
    model: str = Field(min_length=1, max_length=256)


class LlmEffectiveTarget(LlmRoleTarget):
    endpoint_name: str
    endpoint_enabled: bool
    inherited: bool = False


class LlmRoleOut(BaseModel):
    role: LlmRoleId
    label: str
    description: str
    used_for: list[str] = []
    required: bool = False
    inherits_from: LlmRoleId | None = None
    targets: list[LlmRoleTarget] = []
    effective_targets: list[LlmEffectiveTarget] = []
    temperature: float | None = None
    max_output_tokens: int | None = None
    issues: list[str] = []
    updated_at: str | None = None


class LlmConfigOut(BaseModel):
    ready: bool
    endpoints: list[LlmEndpointOut] = []
    roles: list[LlmRoleOut] = []
    limits: dict[str, int] = {"max_targets_per_role": MAX_TARGETS_PER_ROLE, "max_extra_headers": MAX_EXTRA_HEADERS}
    server_defaults: dict[str, int] = {"max_output_tokens": 8192}


def _validate_extra_headers(value: dict[str, str] | None) -> dict[str, str]:
    if value is None:
        return {}
    if len(value) > MAX_EXTRA_HEADERS:
        raise ValueError(f"At most {MAX_EXTRA_HEADERS} extra headers are allowed")
    cleaned: dict[str, str] = {}
    for key, val in value.items():
        if not _HEADER_KEY_RE.match(key):
            raise ValueError(f"Invalid header name: {key!r}")
        if key.lower() in _FORBIDDEN_HEADER_NAMES:
            raise ValueError(f"Put the token in the bearer token field (header {key!r} is not allowed)")
        val_str = str(val)
        if len(val_str) > 1024 or "\r" in val_str or "\n" in val_str or not val_str.isascii():
            raise ValueError(f"Invalid header value for {key!r}")
        cleaned[key] = val_str
    return cleaned


def _validate_extra_body(value: dict[str, Any] | None) -> dict[str, Any]:
    if value is None:
        return {}
    try:
        serialized = json.dumps(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("extra_body must be JSON-serialisable") from exc
    if len(serialized.encode("utf-8")) > 8192:
        raise ValueError("extra_body must be at most 8 KB when serialised")
    for forbidden in _EXTRA_BODY_FORBIDDEN:
        if forbidden in value:
            raise ValueError(f"extra_body must not contain the key {forbidden!r}")
    return value


def _validate_api_key(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    if len(cleaned) > 4096:
        raise ValueError("api_key must be at most 4096 characters")
    return cleaned


class LlmEndpointCreate(BaseModel):
    name: str | None = None
    base_url: str = Field(min_length=1, max_length=2048)
    api_key: str | None = None
    extra_headers: dict[str, str] = {}
    extra_body: dict[str, Any] = {}
    structured_output_mode: StructuredOutputMode = "json_schema"
    timeout_seconds: float = Field(default=60.0, ge=5, le=600)
    max_retries: int = Field(default=1, ge=0, le=3)
    default_temperature: float = Field(default=0.2, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, ge=64, le=65536)
    enabled: bool = True
    default_model: str | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _clean_name(cls, value: Any) -> Any:
        if value is None:
            return None
        cleaned = str(value).strip()
        if cleaned == "":
            return None
        if len(cleaned) > 64:
            raise ValueError("name must be 1-64 characters")
        return cleaned

    @field_validator("extra_headers", mode="before")
    @classmethod
    def _check_headers(cls, value: Any) -> Any:
        return _validate_extra_headers(value or {})

    @field_validator("extra_body", mode="before")
    @classmethod
    def _check_body(cls, value: Any) -> Any:
        return _validate_extra_body(value or {})

    @field_validator("api_key", mode="before")
    @classmethod
    def _check_key(cls, value: Any) -> Any:
        return _validate_api_key(value)


class LlmEndpointUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = Field(default=None, min_length=1, max_length=2048)
    extra_headers: dict[str, str] | None = None
    extra_body: dict[str, Any] | None = None
    structured_output_mode: StructuredOutputMode | None = None
    timeout_seconds: float | None = Field(default=None, ge=5, le=600)
    max_retries: int | None = Field(default=None, ge=0, le=3)
    default_temperature: float | None = Field(default=None, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, ge=64, le=65536)
    enabled: bool | None = None
    default_model: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False

    @field_validator("name", mode="before")
    @classmethod
    def _clean_name(cls, value: Any) -> Any:
        if value is None:
            return None
        cleaned = str(value).strip()
        if len(cleaned) > 64:
            raise ValueError("name must be 1-64 characters")
        return cleaned

    @field_validator("extra_headers", mode="before")
    @classmethod
    def _check_headers(cls, value: Any) -> Any:
        if value is None:
            return None
        return _validate_extra_headers(value)

    @field_validator("extra_body", mode="before")
    @classmethod
    def _check_body(cls, value: Any) -> Any:
        if value is None:
            return None
        return _validate_extra_body(value)

    @field_validator("api_key", mode="before")
    @classmethod
    def _check_key(cls, value: Any) -> Any:
        return _validate_api_key(value)

    @model_validator(mode="after")
    def _check_clear(self) -> "LlmEndpointUpdate":
        if self.clear_api_key and self.api_key:
            raise ValueError("Cannot set api_key and clear_api_key in the same request")
        return self


class LlmProbeRequest(BaseModel):
    base_url: str = Field(min_length=1, max_length=2048)
    api_key: str | None = None
    endpoint_id: str | None = None
    extra_headers: dict[str, str] = {}
    probe_model: str | None = None
    timeout_seconds: float | None = Field(default=None, ge=1, le=30)

    @field_validator("extra_headers", mode="before")
    @classmethod
    def _check_headers(cls, value: Any) -> Any:
        return _validate_extra_headers(value or {})

    @field_validator("api_key", mode="before")
    @classmethod
    def _check_key(cls, value: Any) -> Any:
        return _validate_api_key(value)


class LlmProbeAttempt(BaseModel):
    url: str
    status_code: int | None = None
    error_code: LlmErrorCode | None = None


class LlmStructuredOutputResult(BaseModel):
    mode: StructuredOutputMode
    checks: list[dict[str, Any]] = []


class LlmProbeResponse(BaseModel):
    ok: bool
    normalized_base_url: str | None = None
    models_url: str | None = None
    latency_ms: float | None = None
    models: list[LlmModelInfo] = []
    suggested_model: str | None = None
    suggested_name: str
    structured_output: LlmStructuredOutputResult | None = None
    attempts: list[LlmProbeAttempt] = []
    error: LlmError | None = None


class LlmModelsRefreshResponse(BaseModel):
    ok: bool
    models: list[LlmModelInfo] = []
    models_fetched_at: str | None = None
    error: LlmError | None = None


class LlmTestRequest(BaseModel):
    model: str | None = None
    prompt: str | None = None


class LlmTestResponse(BaseModel):
    ok: bool
    model: str | None = None
    latency_ms: float | None = None
    output: str | None = None
    usage: dict[str, int | None] | None = None
    error: LlmError | None = None


class LlmRoleUpdate(BaseModel):
    targets: list[LlmRoleTarget] = []
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, ge=64, le=65536)

    @field_validator("targets")
    @classmethod
    def _check_targets(cls, value: list[LlmRoleTarget]) -> list[LlmRoleTarget]:
        if len(value) > MAX_TARGETS_PER_ROLE:
            raise ValueError(f"At most {MAX_TARGETS_PER_ROLE} targets per role")
        seen: set[tuple[str, str]] = set()
        for target in value:
            key = (target.endpoint_id, target.model)
            if key in seen:
                raise ValueError("Duplicate (endpoint_id, model) target")
            seen.add(key)
        return value


class LlmStatusSummary(BaseModel):
    ready: bool
    endpoints_total: int
    endpoints_enabled: int
    default_primary: dict[str, str] | None = None
    pro_primary: dict[str, str] | None = None
