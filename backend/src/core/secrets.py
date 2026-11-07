"""Fernet-based encryption for stored LLM endpoint bearer tokens."""
from __future__ import annotations

import base64
import functools
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from src.core.config import settings

logger = logging.getLogger(__name__)


class SecretDecryptError(Exception):
    """Raised when a stored token cannot be decrypted (e.g. secret rotated)."""


@functools.lru_cache(maxsize=4)
def _fernet() -> Fernet:
    key = (settings.LLM_SECRET_KEY or "").strip()
    if key:
        try:
            return Fernet(key.encode())
        except Exception as exc:
            raise RuntimeError("LLM_SECRET_KEY is not a valid Fernet key") from exc
    digest = hashlib.sha256(
        b"resumer-llm-secret-v1:" + (settings.JWT_SECRET or "").encode()
    ).digest()
    derived = base64.urlsafe_b64encode(digest)
    return Fernet(derived)


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise SecretDecryptError("Stored secret cannot be decrypted") from exc


def secret_hint(plaintext: str) -> str | None:
    if plaintext is None:
        return None
    if len(plaintext) < 8:
        return "…****"
    return "…" + plaintext[-4:]
