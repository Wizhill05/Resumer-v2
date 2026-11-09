from __future__ import annotations

from fastapi import Request

from src.core.internal_token import is_valid_internal_token


def trusted_client_ip(request: Request) -> str | None:
    """Return the client IP only when the request carries a valid internal token.

    The frontend proxy sets ``X-Client-IP`` to the real client address and a
    short-lived internal JWT in ``X-Internal-Token`` (or ``Authorization``).
    Direct backend hits without a valid token get ``None`` so callers can
    apply an untrusted bucket or skip IP-based limits.
    """
    auth = request.headers.get("Authorization")
    internal = request.headers.get("X-Internal-Token")
    internal_auth = f"Bearer {internal}" if internal else None
    if not (is_valid_internal_token(auth) or is_valid_internal_token(internal_auth)):
        return None
    client_ip = request.headers.get("X-Client-IP")
    if not client_ip:
        return None
    cleaned = client_ip.split(",")[0].strip()
    return cleaned or None
