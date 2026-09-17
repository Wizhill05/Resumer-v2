"""file_links.py — Cryptographic capability token signer and link generator for resume artifacts.

Provides tamper-proof, time-bounded public capability links for resume downloads.
Uses HMAC-SHA256 keyed on settings.JWT_SECRET to verify generation ownership
and expiry without requiring bearer auth headers in external clients (e.g. ChatGPT).
"""

from __future__ import annotations

import hashlib
import hmac
import re
import time
import uuid
from typing import Any

from src.core.config import settings


def generate_file_token(
    gen_id: str | uuid.UUID,
    kind: str = "resume",
    expires_in_hours: int | None = None,
) -> str:
    """Generate a tamper-proof capability token formatted as '{expiry_timestamp}.{hmac_hex_32}'."""
    ttl = expires_in_hours if expires_in_hours is not None else getattr(settings, "FILE_LINK_TTL_HOURS", 168)
    exp = int(time.time()) + int(ttl * 3600)
    gen_id_str = str(gen_id).strip()
    payload = f"{gen_id_str}:{kind}:{exp}".encode("utf-8")
    secret = (settings.JWT_SECRET or "changeme").encode("utf-8")
    sig = hmac.new(secret, payload, hashlib.sha256).hexdigest()[:32]
    return f"{exp}.{sig}"


def verify_file_token(
    token: str | None,
    gen_id: str | uuid.UUID,
    kind: str = "resume",
) -> bool:
    """Verify expiration timestamp and HMAC integrity for a given generation ID and artifact kind."""
    if not token or "." not in token:
        return False

    try:
        exp_str, sig = token.split(".", 1)
        exp = int(exp_str)
        if time.time() > exp:
            return False

        gen_id_str = str(gen_id).strip()
        payload = f"{gen_id_str}:{kind}:{exp}".encode("utf-8")
        secret = (settings.JWT_SECRET or "changeme").encode("utf-8")
        expected_sig = hmac.new(secret, payload, hashlib.sha256).hexdigest()[:32]
        return hmac.compare_digest(sig, expected_sig)
    except Exception:
        return False


def _sanitize_filename_part(value: str | None, fallback: str) -> str:
    """Sanitize a single filename part for HTTP Content-Disposition usage."""
    if not value or not value.strip():
        return fallback
    cleaned = re.sub(r'[^a-zA-Z0-9_\-]', '_', value.strip())
    cleaned = re.sub(r'_+', '_', cleaned).strip('_')
    return cleaned or fallback


def resolve_resume_username(*candidates: str | None) -> str | None:
    """Return the first non-empty username candidate, if any."""
    for candidate in candidates:
        if candidate and candidate.strip():
            return candidate.strip()
    return None


def format_resume_filename(
    username: str | None = None,
    job_title: str | None = None,
    company: str | None = None,
) -> str:
    """Format download filename as Username_JobTitle.pdf.

    `company` is accepted for backward compatibility but intentionally
    ignored — the filename is always Username_JobTitle.pdf.
    """
    clean_user = _sanitize_filename_part(username, "User")
    clean_title = _sanitize_filename_part(job_title, "Resume")
    return f"{clean_user}_{clean_title}.pdf"


def build_resume_file_link(
    gen_id: str | uuid.UUID,
    base_url: str | None = None,
    expires_in_hours: int | None = None,
    force_download: bool = False,
) -> str:
    """Construct full public download URL for a completed resume generation."""
    gen_id_str = str(gen_id).strip()
    token = generate_file_token(gen_id_str, kind="resume", expires_in_hours=expires_in_hours)

    base = (base_url or getattr(settings, "BACKEND_URL", "") or "").strip().rstrip("/")
    if not base:
        base = "https://resumer-backend.aryansingh.space"

    url = f"{base}/files/gen/{gen_id_str}/resume.pdf?t={token}"
    if force_download:
        url += "&dl=1"
    return url
