"""Tests for src/core/secrets.py."""
import pytest

from src.core.config import settings
from src.core import secrets
from src.core.secrets import (
    SecretDecryptError,
    decrypt_secret,
    encrypt_secret,
    secret_hint,
)


def test_round_trip():
    plaintext = "sk-test-" + "x" * 32
    token = encrypt_secret(plaintext)
    assert token != plaintext
    assert decrypt_secret(token) == plaintext


def test_garbage_raises():
    with pytest.raises(SecretDecryptError):
        decrypt_secret("not-a-fernet-token")


def test_hint():
    assert secret_hint("abcdefgh") == "…efgh"
    assert secret_hint("abcdefg") == "…****"
    assert secret_hint("") == "…****"
    assert secret_hint(None) is None


def test_llm_secret_key_override_is_used(monkeypatch):
    from cryptography.fernet import Fernet

    key = Fernet.generate_key().decode()
    monkeypatch.setattr(settings, "LLM_SECRET_KEY", key)
    secrets._fernet.cache_clear()
    try:
        token = encrypt_secret("override-secret-12345")
        assert decrypt_secret(token) == "override-secret-12345"
    finally:
        secrets._fernet.cache_clear()
