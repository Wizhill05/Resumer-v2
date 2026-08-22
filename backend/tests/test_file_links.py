import time
import uuid
import pytest

from src.core.config import settings
from src.core.file_links import (
    build_resume_file_link,
    format_resume_filename,
    generate_file_token,
    verify_file_token,
)


def test_token_generation_and_verification():
    gen_id = str(uuid.uuid4())
    token = generate_file_token(gen_id, kind="resume", expires_in_hours=24)

    assert "." in token
    exp_str, sig = token.split(".", 1)
    assert len(sig) == 32
    assert int(exp_str) > time.time()

    assert verify_file_token(token, gen_id, kind="resume") is True
    # Different kind should fail
    assert verify_file_token(token, gen_id, kind="thumbnail") is False


def test_token_tampering_rejected():
    gen_id = str(uuid.uuid4())
    other_gen_id = str(uuid.uuid4())
    token = generate_file_token(gen_id, kind="resume")

    # Mismatched generation ID
    assert verify_file_token(token, other_gen_id, kind="resume") is False

    # Tampered signature
    exp_str, sig = token.split(".", 1)
    tampered_sig = ("0" if sig[0] != "0" else "1") + sig[1:]
    assert verify_file_token(f"{exp_str}.{tampered_sig}", gen_id, kind="resume") is False

    # Malformed token
    assert verify_file_token("not-a-token", gen_id) is False
    assert verify_file_token("", gen_id) is False
    assert verify_file_token(None, gen_id) is False


def test_token_expiration_rejected():
    gen_id = str(uuid.uuid4())
    # Generate token that expired 1 hour ago
    expired_token = generate_file_token(gen_id, kind="resume", expires_in_hours=-1)

    assert verify_file_token(expired_token, gen_id, kind="resume") is False


def test_format_resume_filename():
    assert format_resume_filename("Software Engineer", "Google") == "Resume_Google_Software_Engineer.pdf"
    assert format_resume_filename(None, "Meta") == "Resume_Meta.pdf"
    assert format_resume_filename("Backend Dev", None) == "Resume_Backend_Dev.pdf"
    assert format_resume_filename("Target Role", "Unknown Company") == "Resume_Tailored.pdf"
    assert format_resume_filename("", "") == "Resume_Tailored.pdf"
    assert format_resume_filename("Senior Architect / Lead!", "Acme & Co.") == "Resume_Acme_Co_Senior_Architect_Lead.pdf"


def test_build_resume_file_link(monkeypatch):
    gen_id = "41fae691-8c60-45fe-8170-ca1e1b78addd"

    # With explicit base URL
    url = build_resume_file_link(gen_id, base_url="https://custom-api.resumer.io")
    assert url.startswith(f"https://custom-api.resumer.io/files/gen/{gen_id}/resume.pdf?t=")
    assert "&dl=1" not in url

    # With force_download
    dl_url = build_resume_file_link(gen_id, base_url="https://custom-api.resumer.io", force_download=True)
    assert "&dl=1" in dl_url

    # Fallback to BACKEND_URL setting or default
    monkeypatch.setattr(settings, "BACKEND_URL", "https://api.test.com")
    fallback_url = build_resume_file_link(gen_id)
    assert fallback_url.startswith(f"https://api.test.com/files/gen/{gen_id}/resume.pdf?t=")
