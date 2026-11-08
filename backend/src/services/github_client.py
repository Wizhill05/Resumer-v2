"""Async GitHub API client (GET-only) with typed errors and a small cache.

Only GET is supported. Private-repo tokens carry the full ``repo`` scope,
so this module deliberately exposes no write method.
"""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

API_BASE = "https://api.github.com"
TIMEOUT = 8.0
CACHE_TTL_SECONDS = 10 * 60
CACHE_MAX_ENTRIES = 500


class GithubError(Exception):
    """Other 4xx/5xx responses from the GitHub API."""

    def __init__(
        self,
        message: str = "GitHub API error",
        *,
        status_code: int | None = None,
        body_message: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.body_message = body_message


class GithubAuthError(GithubError):
    """401: the token was rejected."""


class GithubNotFound(GithubError):
    """404: the resource was not found."""


class GithubRateLimited(GithubError):
    """403/429 with the shared rate limit exhausted."""

    def __init__(self, reset_at: datetime, message: str = "GitHub rate limit exceeded") -> None:
        super().__init__(message, status_code=429)
        self.reset_at = reset_at


# path -> (expires_at, payload); only unauthenticated responses are stored
_cache: OrderedDict[str, tuple[float, Any]] = OrderedDict()


def clear_cache() -> None:
    """Clear the unauthenticated response cache (used by tests)."""
    _cache.clear()


def _cache_get(path: str) -> tuple[bool, Any]:
    entry = _cache.get(path)
    if entry is None:
        return False, None
    expires_at, payload = entry
    if expires_at < time.time():
        del _cache[path]
        return False, None
    _cache.move_to_end(path)
    return True, payload


def _cache_put(path: str, payload: Any) -> None:
    _cache[path] = (time.time() + CACHE_TTL_SECONDS, payload)
    _cache.move_to_end(path)
    while len(_cache) > CACHE_MAX_ENTRIES:
        _cache.popitem(last=False)


def _parse_reset_at(headers: httpx.Headers) -> datetime:
    raw = headers.get("x-ratelimit-reset") or headers.get("X-RateLimit-Reset")
    if raw:
        try:
            return datetime.fromtimestamp(int(raw), tz=timezone.utc)
        except (ValueError, OverflowError, OSError):
            pass
    return datetime.now(timezone.utc) + timedelta(minutes=60)


def _body_message(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except Exception:
        return None
    if isinstance(body, dict):
        message = body.get("message")
        if isinstance(message, str) and message:
            return message
    return None


async def github_get(path: str, token: str | None = None) -> Any:
    """GET ``path`` (for example ``/user/repos``) from the GitHub API."""
    if not token:
        hit, cached = _cache_get(path)
        if hit:
            return cached

    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Resumer-v2/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(
        base_url=API_BASE, timeout=TIMEOUT, follow_redirects=False
    ) as client:
        response = await client.get(path, headers=headers)

    remaining = response.headers.get("x-ratelimit-remaining")
    logger.debug(
        "GitHub API call path=%s authenticated=%s remaining=%s",
        path,
        bool(token),
        remaining,
    )

    status = response.status_code
    body_message = _body_message(response)
    remaining_zero = (remaining or "").strip() == "0"
    mentions_rate_limit = bool(
        body_message and "rate limit" in body_message.lower()
    )

    if status == 401:
        raise GithubAuthError("GitHub rejected the access token", status_code=401, body_message=body_message)
    if status == 404:
        raise GithubNotFound("GitHub resource not found", status_code=404, body_message=body_message)
    if (status in (403, 429) and remaining_zero) or (status in (403, 429) and mentions_rate_limit):
        raise GithubRateLimited(
            reset_at=_parse_reset_at(response.headers),
            message=body_message or "GitHub rate limit exceeded",
        )
    if 300 <= status < 400:
        raise GithubError(
            f"GitHub API redirect ({status})",
            status_code=status,
            body_message=body_message,
        )
    if status >= 400:
        raise GithubError(
            body_message or "GitHub API error",
            status_code=status,
            body_message=body_message,
        )

    try:
        payload = response.json()
    except Exception as exc:
        raise GithubError("GitHub API returned an invalid response", status_code=status) from exc

    if not token:
        _cache_put(path, payload)
    return payload
