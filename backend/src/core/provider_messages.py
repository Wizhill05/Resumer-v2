"""Shared provider labels and messages for auth flows."""

from __future__ import annotations


def provider_label(provider: str | None) -> str:
    return {
        "google": "Google",
        "github": "GitHub",
        "credentials": "email and password",
    }.get(provider or "", provider or "social login")


def provider_mismatch_message(provider: str | None) -> str:
    if provider == "credentials":
        return "This email is registered with an email and password. Sign in with your email and password."
    label = provider_label(provider)
    return f"This email is registered with {label}. Sign in with {label}."
