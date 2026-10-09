import hashlib
import hmac
import secrets


def hash_password(password: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with a unique random salt."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100_000,
    )
    return f"{salt}:{key.hex()}"


def verify_password(password: str, hashed_password: str | None) -> bool:
    """Verify candidate password against stored salt:hash string."""
    if not hashed_password or ":" not in hashed_password:
        return False
    try:
        salt, key_hex = hashed_password.split(":", 1)
        key = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            100_000,
        )
        return hmac.compare_digest(key.hex(), key_hex)
    except Exception:
        return False
