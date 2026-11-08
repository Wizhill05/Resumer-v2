from __future__ import annotations

from jose import JWTError, jwt

from src.core.config import settings


def is_valid_internal_token(authorization: str | None) -> bool:
    """Return True only for a valid HS256 internal token (aud=internal)."""
    if not settings.INTERNAL_API_SECRET:
        return False
    if not authorization or not authorization.startswith("Bearer "):
        return False
    token = authorization[7:]
    try:
        payload = jwt.decode(
            token,
            settings.INTERNAL_API_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": True},
            audience="internal",
        )
    except (JWTError, Exception):
        return False
    return payload.get("aud") == "internal"
