"""Guest completion emails go to the address typed on /try, never the placeholder."""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from src.core import notify
from src.pipeline import job_runner


def _gen(**kw):
    base = dict(id=uuid.uuid4(), is_guest=True, user_id=uuid.uuid4(), render_metadata={}, status="completed",
                job_title="Engineer", company="Acme", error_message=None, guest_input_snapshot={})
    base.update(kw)
    return SimpleNamespace(**base)


async def test_guest_run_uses_typed_email(monkeypatch):
    fetch = AsyncMock(return_value="__guest__@resumer.local")
    monkeypatch.setattr(job_runner, "_fetch_user_email", fetch)
    gen = _gen(render_metadata={"_guest_notify_email": "me@example.com"})
    assert await job_runner._notify_email_for(gen) == "me@example.com"
    fetch.assert_not_awaited()


async def test_guest_run_without_email_sends_nothing(monkeypatch):
    monkeypatch.setattr(job_runner, "_fetch_user_email", AsyncMock(return_value="__guest__@resumer.local"))
    assert await job_runner._notify_email_for(_gen()) is None


async def test_claimed_run_uses_account_email(monkeypatch):
    monkeypatch.setattr(job_runner, "_fetch_user_email", AsyncMock(return_value="owner@example.com"))
    gen = _gen(is_guest=False, render_metadata={"_guest_notify_email": "typed@example.com"})
    assert await job_runner._notify_email_for(gen) == "owner@example.com"


def _capture_send(monkeypatch):
    import sys
    fake = MagicMock()
    monkeypatch.setitem(sys.modules, "resend", fake)
    monkeypatch.setattr(notify.settings, "RESEND_API_KEY", "re_test")
    return fake


def test_placeholder_guest_address_is_never_emailed(monkeypatch):
    fake = _capture_send(monkeypatch)
    notify.send_completion_email("__guest__@resumer.local", _gen())
    fake.Emails.send.assert_not_called()


def test_guest_email_links_to_try_result(monkeypatch):
    fake = _capture_send(monkeypatch)
    gen = _gen()
    notify.send_completion_email("me@example.com", gen, b"%PDF-1.4")
    payload = fake.Emails.send.call_args.args[0]
    assert payload["to"] == "me@example.com"
    assert f"/try/result/{gen.id}" in payload["html"]
    assert "/dashboard/history" not in payload["html"]
    assert payload["attachments"][0]["content_type"] == "application/pdf"
