"""Shared provider labels and messages for auth flows."""

from __future__ import annotations

_LABELS = {
    "google": "Google",
    "github": "GitHub",
    "credentials": "email and password",
}


def provider_label(provider: str | None) -> str:
    # Never echo a raw provider string; unknown values (e.g. legacy internal markers) get a generic label.
    return _LABELS.get(provider or "", "another sign-in method")


def provider_mismatch_message(provider: str | None) -> str:
    if provider == "credentials":
        return "This email is registered with an email and password. Sign in with your email and password."
    if provider not in _LABELS:
        return "This email is registered with a different sign-in method. Sign in with the method you used originally."
    label = provider_label(provider)
    return f"This email is registered with {label}. Sign in with {label}."
