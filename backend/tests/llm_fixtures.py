"""Shared helpers for LLM config tests."""
from __future__ import annotations

from src.services.llm_config import EndpointRuntime, ResolvedTarget


def make_endpoint_runtime(
    name: str = "ep1",
    model: str = "m1",
    endpoint_id: str = "ep-id",
    mode: str = "json_schema",
    max_retries: int = 1,
    base_url: str = "https://api.example.com/v1",
    api_key: str | None = "sk-test",
    timeout_seconds: float = 60.0,
) -> EndpointRuntime:
    return EndpointRuntime(
        id=endpoint_id,
        name=name,
        base_url=base_url,
        api_key=api_key,
        api_key_status="ok" if api_key else "missing",
        extra_headers={},
        extra_body={},
        structured_output_mode=mode,
        timeout_seconds=timeout_seconds,
        max_retries=max_retries,
        default_temperature=0.2,
        max_output_tokens=None,
        enabled=True,
    )


def make_target(
    name: str = "ep1",
    model: str = "m1",
    mode: str = "json_schema",
    max_retries: int = 1,
    endpoint_id: str = "ep-id",
    base_url: str = "https://api.example.com/v1",
    api_key: str | None = "sk-test",
    timeout_seconds: float = 60.0,
    inherited: bool = False,
) -> ResolvedTarget:
    endpoint = make_endpoint_runtime(
        name=name,
        model=model,
        endpoint_id=endpoint_id,
        mode=mode,
        max_retries=max_retries,
        base_url=base_url,
        api_key=api_key,
        timeout_seconds=timeout_seconds,
    )
    return ResolvedTarget(
        endpoint=endpoint,
        model=model,
        temperature=0.2,
        max_output_tokens=8192,
        inherited=inherited,
    )
