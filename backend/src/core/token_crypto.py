"""Fernet encryption for stored GitHub OAuth tokens."""
from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from src.core.config import settings


class TokenDecryptError(Exception):
    """Raised when a stored GitHub token cannot be decrypted."""


def _fernet() -> Fernet:
    key = (settings.GITHUB_TOKEN_KEY or "").strip()
    if not key:
        raise RuntimeError("GITHUB_TOKEN_KEY is not set. Generate a Fernet key and set it in env.")
    try:
        return Fernet(key.encode())
    except Exception as exc:
        raise RuntimeError("GITHUB_TOKEN_KEY is not a valid Fernet key") from exc


def encrypt_token(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise TokenDecryptError("Stored GitHub token cannot be decrypted") from exc
