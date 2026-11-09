import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.api.feedback import router
from src.core.auth import get_current_user, get_optional_user
from src.core.database import get_db
from src.models.generation import FeedbackRating, ReportAttachment, SupportMessage, SupportPushSubscription, SupportRateLimit, SupportReport
from src.models.user import Base, User
from src.services import support


@pytest.mark.parametrize("mime", ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4",
                                  "audio/wav", "audio/x-wav", "audio/mpeg"])
async def test_voice_upload_preserves_recorder_mime_and_bytes(context, monkeypatch, mime):
    from src.services import feedback_ai
    client, db, *_ = context
    storage = Mock()
    storage.upload_bytes.side_effect = lambda content, key, **kw: key
    monkeypatch.setattr("src.api.feedback.StorageService", lambda: storage)
    monkeypatch.setattr("src.api.feedback.notify_submission", AsyncMock())
    enrichment = AsyncMock()
    monkeypatch.setattr(feedback_ai, "process_new_support_report", enrichment)
    response = await client.post("/feedback/support", data={"message": "Audio issue"},
                                 files={"voice": ("recording", b"synthetic audio", mime)})
    assert response.status_code == 200
    report_id = uuid.UUID(response.json()["id"])
    attachment = (await db.execute(select(ReportAttachment).where(ReportAttachment.report_id == report_id))).scalar_one()
    assert attachment.mime_type == mime
    assert attachment.file_size_bytes == len(b"synthetic audio")
    assert storage.upload_bytes.call_args.args[0] == b"synthetic audio"
    assert storage.upload_bytes.call_args.kwargs["content_type"] == mime
    enrichment.assert_awaited_once_with(report_id)


@pytest.mark.parametrize("transcript", ["The download failed.", None])
async def test_voice_enrichment_persists_transcript_or_preserves_recording(context, monkeypatch, transcript):
    from src.services import feedback_ai
    _, db, _, _, _, _, report, _ = context
    attachment = ReportAttachment(report_id=report.id, attachment_type="voice_recording",
        storage_key="synthetic-recording.webm", filename="recording.webm",
        mime_type="audio/webm;codecs=opus", file_size_bytes=15)
    db.add(attachment)
    await db.commit()

    @asynccontextmanager
    async def session():
        yield db

    monkeypatch.setattr(feedback_ai, "AsyncSessionLocal", session)
    monkeypatch.setattr(feedback_ai.settings, "SUPPORT_WEBHOOK_URL", "")
    # A summary outage must not prevent voice processing.
    monkeypatch.setattr(feedback_ai, "invoke_with_fallback", AsyncMock(side_effect=RuntimeError("synthetic outage")))
    storage = Mock()
    storage.download_bytes.return_value = b"synthetic audio"
    monkeypatch.setattr(feedback_ai, "StorageService", lambda: storage)
    transcribe = AsyncMock(return_value=transcript)
    monkeypatch.setattr(feedback_ai, "transcribe_audio_bytes", transcribe)
    await feedback_ai.process_new_support_report(report.id)
    await db.refresh(attachment)
    assert attachment.transcription == transcript
    assert attachment.storage_key == "synthetic-recording.webm"
    transcribe.assert_awaited_once_with(b"synthetic audio", "audio/webm;codecs=opus")


@pytest.fixture
async def context(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[User.__table__, SupportReport.__table__, SupportMessage.__table__, ReportAttachment.__table__, FeedbackRating.__table__, SupportRateLimit.__table__, SupportPushSubscription.__table__]))
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        owner = User(email="owner@example.com", name="Owner")
        stranger = User(email="stranger@example.com")
        admin = User(email="admin@example.com")
        db.add_all([owner, stranger, admin])
        await db.commit()
        report = SupportReport(user_id=owner.id, message="Download fails", title="Download issue", category="bug", status="open", admin_note="Private old note")
        guest = SupportReport(message="Guest issue", status="open")
        db.add_all([report, guest])
        await db.commit()
        app = FastAPI()
        app.include_router(router)
        async def get_session():
            yield db
        app.dependency_overrides[get_db] = get_session
        app.dependency_overrides[get_optional_user] = lambda: owner
        app.dependency_overrides[get_current_user] = lambda: owner
        monkeypatch.setattr(support, "is_admin", lambda user: user is admin)
        monkeypatch.setattr("src.api.feedback.is_admin", lambda user: user is admin)
        monkeypatch.setattr(support, "notify_owner", AsyncMock(return_value="sent"))
        monkeypatch.setattr(support, "notify_admins", AsyncMock(return_value="sent"))
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client, db, app, owner, stranger, admin, report, guest
    await engine.dispose()


async def test_thread_is_private_and_guest_token_is_scoped(context):
    client, db, app, owner, stranger, admin, report, guest = context
    response = await client.get(f"/feedback/support/{report.id}")
    assert response.status_code == 200
    assert "admin_note" not in response.json()
    app.dependency_overrides[get_optional_user] = lambda: stranger
    assert (await client.get(f"/feedback/support/{report.id}")).status_code == 404
    token = support.guest_token(guest.id)
    assert (await client.get(f"/feedback/support/{guest.id}", params={"access_token": token})).status_code == 200
    assert (await client.get(f"/feedback/support/{report.id}", params={"access_token": token})).status_code == 404
    assert (await client.get(f"/feedback/support/{guest.id}", params={"access_token": support.guest_token(uuid.uuid4())})).status_code == 404
    app.dependency_overrides[get_optional_user] = lambda: admin
    assert (await client.get(f"/feedback/support/{report.id}")).json()["viewer_is_admin"] is True


async def test_admin_reply_persists_and_notifies_without_closing(context):
    client, db, app, owner, stranger, admin, report, guest = context
    app.dependency_overrides[get_optional_user] = lambda: admin
    response = await client.post(f"/feedback/support/{report.id}/messages", json={"message": "Please try downloading again."})
    assert response.status_code == 200
    assert response.json()["notification_status"] == "sent"
    assert report.status == "open"
    support.notify_owner.assert_awaited_once()
    app.dependency_overrides[get_optional_user] = lambda: owner
    detail = (await client.get(f"/feedback/support/{report.id}")).json()
    assert detail["messages"][0]["author_role"] == "admin"
    assert detail["messages"][0]["message"] == "Please try downloading again."


async def test_reply_reopens_closed_thread_with_history_and_no_loss_on_email_failure(context):
    client, db, app, owner, stranger, admin, report, guest = context
    await client.patch(f"/feedback/support/{report.id}", json={"status": "resolved"})
    support.notify_admins.return_value = "failed"
    response = await client.post(f"/feedback/support/{report.id}/messages", json={"message": "It still fails"})
    assert response.json()["notification_status"] == "failed"
    assert report.status == "open"
    assert report.resolved_at is None
    messages = (await db.execute(select(SupportMessage).where(SupportMessage.report_id == report.id))).scalars().all()
    assert {m.message for m in messages} == {"Request marked resolved.", "Request marked open.", "It still fails"}
    assert (await client.patch(f"/feedback/support/{report.id}", json={"status": "banana"})).status_code == 422
    assert (await client.post(f"/feedback/support/{report.id}/messages", json={"message": "  "})).status_code == 422


async def test_owner_list_does_not_include_other_reports(context):
    client, db, app, owner, stranger, admin, report, guest = context
    response = await client.get("/feedback/support")
    assert [row["id"] for row in response.json()] == [str(report.id)]


def test_notification_reports_missing_configuration(monkeypatch):
    monkeypatch.setattr(support.settings, "RESEND_API_KEY", "")
    assert support._send_update("person@example.com", uuid.uuid4(), "Hi", "https://example.com", "Reply") == "not_configured"
    assert support._send_update(None, uuid.uuid4(), "Hi", "https://example.com", "Reply") == "no_recipient"


async def test_submission_retains_optional_context_and_guest_access(context, monkeypatch):
    client, db, app, owner, stranger, admin, report, guest = context
    app.dependency_overrides[get_optional_user] = lambda: None
    monkeypatch.setattr("src.api.feedback.notify_submission", AsyncMock())
    monkeypatch.setattr("src.services.feedback_ai.process_new_support_report", AsyncMock())
    response = await client.post("/feedback/support", data={
        "message": "PDF does not open", "title": "PDF export", "category": "template",
        "where_happened": "Editor on iPhone", "steps_to_reproduce": "Tap download", "expected_behavior": "PDF opens",
        "email_override": "guest@example.com",
    })
    assert response.status_code == 200
    submitted = response.json()
    detail = (await client.get(f'/feedback/support/{submitted["id"]}', params={"access_token": submitted["access_token"]})).json()
    assert detail["where_happened"] == "Editor on iPhone"
    assert detail["steps_to_reproduce"] == "Tap download"
    assert detail["expected_behavior"] == "PDF opens"
    assert detail["title"] == "PDF export"
    assert "email_override" not in detail
    assert (await client.post("/feedback/support", data={"message": "test"}, files={"screenshots": ("bad.html", b"<script>bad</script>", "text/html")})).status_code == 415


async def test_admin_status_and_legacy_reply_are_visible_without_overwriting_history(context):
    from src.api.admin import router as admin_router
    from src.core.auth import get_current_admin
    client, db, app, owner, stranger, admin, report, guest = context
    app.include_router(admin_router)
    app.dependency_overrides[get_current_admin] = lambda: admin
    response = await client.patch(f"/admin/feedback/reports/{report.id}", json={"status": "resolved", "admin_note": "Fixed the download"})
    assert response.status_code == 200
    assert response.json()["notification_status"] == "sent"
    assert report.resolved_at is not None
    response = await client.post(f"/admin/feedback/reports/{report.id}/messages", json={"message": "Another update"})
    assert response.status_code == 200
    detail = (await client.get(f"/feedback/support/{report.id}")).json()
    assert {row["message"] for row in detail["messages"]} == {"Request marked resolved.", "Fixed the download", "Another update"}
    assert report.admin_note == "Private old note"
    await client.patch(f"/admin/feedback/reports/{report.id}", json={"status": "in_progress"})
    assert report.resolved_at is None
    assert (await client.patch(f"/admin/feedback/reports/{report.id}", json={"status": "unknown"})).status_code == 422


def test_notification_escapes_message_and_reports_provider_failure(monkeypatch):
    import resend
    monkeypatch.setattr(support.settings, "RESEND_API_KEY", "test")
    sent = []
    monkeypatch.setattr(resend.Emails, "send", lambda payload: sent.append(payload) or {"id": "delivery-1"})
    assert support._send_update("person@example.com", uuid.uuid4(), '<script>alert("x")</script>', "https://example.com/thread", "Reply") == "sent"
    assert "<script>" not in sent[0]["html"]
    assert "&lt;script&gt;" in sent[0]["html"]
    def fail(payload):
        raise RuntimeError("provider unavailable")
    monkeypatch.setattr(resend.Emails, "send", fail)
    assert support._send_update("person@example.com", uuid.uuid4(), "hello", "https://example.com/thread", "Reply") == "failed"


async def test_admin_inbox_finds_closed_and_legacy_resolved_issues_and_searches_titles(context):
    from src.api.admin import router as admin_router
    from src.core.auth import get_current_admin
    client, db, app, owner, stranger, admin, report, guest = context
    app.include_router(admin_router)
    app.dependency_overrides[get_current_admin] = lambda: admin
    report.status = "closed"
    guest.status = "resolved"
    progress = SupportReport(user_id=owner.id, message="Working on it", status="in_progress")
    db.add(progress)
    await db.commit()
    response = await client.get("/admin/feedback/reports", params={"status_filter": "resolved"})
    assert {row["id"] for row in response.json()} == {str(report.id), str(guest.id)}
    response = await client.get("/admin/feedback/reports", params={"search": "Download issue"})
    assert [row["id"] for row in response.json()] == [str(report.id)]
    analytics = (await client.get("/admin/feedback/analytics")).json()
    assert analytics["open_count"] == 1
    assert analytics["resolved_count"] == 2


async def test_admin_can_close_reopen_and_recategorize_without_changing_original_report(context):
    from src.api.admin import router as admin_router
    from src.core.auth import get_current_admin
    client, db, app, owner, stranger, admin, report, guest = context
    app.include_router(admin_router)
    app.dependency_overrides[get_current_admin] = lambda: admin
    endpoint = f"/admin/feedback/reports/{report.id}"
    response = await client.patch(endpoint, json={"status": "closed"})
    assert response.status_code == 200
    assert report.status == "closed"
    assert report.resolved_at is not None
    response = await client.patch(endpoint, json={"category": "feedback", "title": "  Add another export format  "})
    assert response.status_code == 200
    detail = (await client.get(f"/feedback/support/{report.id}")).json()
    assert detail["status"] == "closed"
    assert detail["category"] == "feedback"
    assert detail["title"] == "Add another export format"
    assert detail["message"] == "Download fails"
    assert detail["messages"][-1]["author_role"] == "system"
    assert any("Category changed from Bug report to Feature request" in row["message"] for row in detail["messages"])
    assert (await client.patch(endpoint, json={"status": "open"})).status_code == 200
    assert report.status == "open"
    assert report.resolved_at is None
    assert (await client.patch(endpoint, json={"category": "made-up"})).status_code == 422
    assert (await client.patch(endpoint, json={"title": "  "})).status_code == 422
    assert (await client.patch(endpoint, json={})).status_code == 422


async def test_reporter_cannot_use_admin_metadata_editor(context, monkeypatch):
    from src.api.admin import router as admin_router
    from src.core.config import settings
    client, db, app, owner, stranger, admin, report, guest = context
    app.include_router(admin_router)
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "admin@example.com")
    response = await client.patch(f"/admin/feedback/reports/{report.id}", json={"category": "feedback"})
    assert response.status_code == 403
    assert report.category == "bug"


async def test_no_confirmation_email_to_guests(context, monkeypatch):
    client, db, app, owner, stranger, admin, report, guest = context
    # guest report has user_id None; notify_submission must not call notify_owner for guests
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def session():
        yield db

    monkeypatch.setattr("src.core.database.AsyncSessionLocal", session)
    monkeypatch.setattr(support, "notify_admins", AsyncMock(return_value="sent"))
    notify_owner_mock = AsyncMock(return_value="sent")
    monkeypatch.setattr(support, "notify_owner", notify_owner_mock)
    await support.notify_submission(guest.id)
    support.notify_admins.assert_awaited_once()
    notify_owner_mock.assert_not_awaited()
    # Signed-in report should notify owner
    notify_owner_mock.reset_mock()
    await support.notify_submission(report.id)
    notify_owner_mock.assert_awaited_once()


async def test_guest_cookie_set_and_list_via_cookie(context, monkeypatch):
    client, db, app, owner, stranger, admin, report, guest = context
    app.dependency_overrides[get_optional_user] = lambda: None
    monkeypatch.setattr("src.api.feedback.notify_submission", AsyncMock())
    monkeypatch.setattr("src.services.feedback_ai.process_new_support_report", AsyncMock())
    response = await client.post("/feedback/support", data={"message": "cookie test"})
    assert response.status_code == 200
    assert "resumer_support_key" in response.headers.get("set-cookie", "")
    submitted = response.json()
    raw_key = response.headers["set-cookie"].split("resumer_support_key=")[1].split(";")[0]
    # List via cookie should include report with access_token
    listed = await client.get("/feedback/support", cookies={"resumer_support_key": raw_key})
    assert listed.status_code == 200
    ids = [row["id"] for row in listed.json()]
    assert str(submitted["id"]) in ids
    row = [r for r in listed.json() if r["id"] == str(submitted["id"])][0]
    assert row.get("access_token")
    # Cookie grants access to detail without token
    detail = await client.get(f"/feedback/support/{submitted['id']}", cookies={"resumer_support_key": raw_key})
    assert detail.status_code == 200


async def test_guest_rate_limit_429(context, monkeypatch):
    client, db, app, owner, stranger, admin, report, guest = context
    app.dependency_overrides[get_optional_user] = lambda: None
    monkeypatch.setattr("src.api.feedback.notify_submission", AsyncMock())
    monkeypatch.setattr("src.services.feedback_ai.process_new_support_report", AsyncMock())
    raw_guest_key = "rate-limit-test-key"
    # Guest cookie limit 5/hour: submit 6
    last_status = None
    for i in range(6):
        resp = await client.post("/feedback/support", data={"message": f"msg {i}"}, cookies={"resumer_support_key": raw_guest_key})
        last_status = resp.status_code
        if resp.status_code == 429:
            break
    assert last_status == 429


async def test_user_rate_limit_429(context, monkeypatch):
    client, db, app, owner, stranger, admin, report, guest = context
    monkeypatch.setattr("src.api.feedback.notify_submission", AsyncMock())
    monkeypatch.setattr("src.services.feedback_ai.process_new_support_report", AsyncMock())
    # Signed-in override is owner from context fixture (10/hour). Loop until 429.
    last_status = None
    for i in range(12):
        resp = await client.post("/feedback/support", data={"message": f"user msg {i}"})
        last_status = resp.status_code
        if resp.status_code == 429:
            break
    assert last_status == 429


async def test_ip_header_ignored_without_internal_token(context, monkeypatch):
    client, db, app, owner, stranger, admin, report, guest = context
    app.dependency_overrides[get_optional_user] = lambda: None
    monkeypatch.setattr("src.api.feedback.notify_submission", AsyncMock())
    monkeypatch.setattr("src.services.feedback_ai.process_new_support_report", AsyncMock())
    # Spoof X-Client-IP without valid internal token should not create IP bucket nor error
    resp = await client.post("/feedback/support", data={"message": "spoof test"}, headers={"X-Client-IP": "9.9.9.9"})
    assert resp.status_code == 200
    rows = (await db.execute(select(SupportRateLimit).where(SupportRateLimit.key.like("ip:%")))).scalars().all()
    assert all("9.9.9.9" not in r.key for r in rows)


async def test_turnstile_skipped_when_unset_and_rejected_when_set(context, monkeypatch):
    client, db, app, owner, stranger, admin, report, guest = context
    app.dependency_overrides[get_optional_user] = lambda: None
    monkeypatch.setattr("src.api.feedback.notify_submission", AsyncMock())
    monkeypatch.setattr("src.services.feedback_ai.process_new_support_report", AsyncMock())
    monkeypatch.setattr(support.settings, "TURNSTILE_SECRET_KEY", "")
    resp = await client.post("/feedback/support", data={"message": "no turnstile"})
    assert resp.status_code == 200
    monkeypatch.setattr(support.settings, "TURNSTILE_SECRET_KEY", "test-secret")

    def fake_verify(token, remoteip):
        return False

    monkeypatch.setattr("src.services.support._turnstile_verify_sync", fake_verify)
    resp2 = await client.post("/feedback/support", data={"message": "bad token", "turnstile_token": "bad"})
    assert resp2.status_code == 422


async def test_push_subscribe_and_admin_reply_triggers_push(context, monkeypatch):
    client, db, app, owner, stranger, admin, report, guest = context
    monkeypatch.setattr(support.settings, "VAPID_PUBLIC_KEY", "testpub")
    monkeypatch.setattr(support.settings, "VAPID_PRIVATE_KEY", "testpriv")
    monkeypatch.setattr(support.settings, "VAPID_SUBJECT", "mailto:test@example.com")
    resp = await client.post(f"/feedback/support/{report.id}/push", json={"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": {"p256dh": "p", "auth": "a"}})
    assert resp.status_code == 200
    # public key endpoint
    pub = await client.get("/feedback/support/push/public-key")
    assert pub.status_code == 200
    # Admin reply triggers push; mock webpush.
    import sys
    fake_store = {"called": []}
    class FakePushModule:
        @staticmethod
        def webpush(**kwargs):
            fake_store["called"].append(kwargs)

    monkeypatch.setitem(sys.modules, "pywebpush", FakePushModule)
    # Need notify_push to use separate AsyncSessionLocal - patch it to reuse db
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def session():
        yield db

    monkeypatch.setattr("src.core.database.AsyncSessionLocal", session)
    # But notify_push does `from src.core.database import AsyncSessionLocal` inside function, so patching attribute works.
    # However support.notify_push imports inside; patch the module attribute.
    app.dependency_overrides[get_optional_user] = lambda: admin
    reply = await client.post(f"/feedback/support/{report.id}/messages", json={"message": "push trigger"})
    assert reply.status_code == 200
    assert len(fake_store["called"]) == 1


async def test_push_410_cleanup(context, monkeypatch):
    client, db, app, owner, stranger, admin, report, guest = context
    monkeypatch.setattr(support.settings, "VAPID_PUBLIC_KEY", "testpub")
    monkeypatch.setattr(support.settings, "VAPID_PRIVATE_KEY", "testpriv")
    monkeypatch.setattr(support.settings, "VAPID_SUBJECT", "mailto:test@example.com")
    sub = SupportPushSubscription(report_id=report.id, endpoint="https://fcm.googleapis.com/fcm/send/gone", p256dh="p", auth="a")
    db.add(sub)
    await db.commit()
    import sys

    class FakePush410Module:
        @staticmethod
        def webpush(**kwargs):
            raise Exception("410 gone")

    monkeypatch.setitem(sys.modules, "pywebpush", FakePush410Module)
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def session():
        yield db

    monkeypatch.setattr("src.core.database.AsyncSessionLocal", session)
    await support.notify_push(report.id, "hello", report=report)
    remaining = (await db.execute(select(SupportPushSubscription).where(SupportPushSubscription.report_id == report.id))).scalars().all()
    assert len(remaining) == 0


@pytest.mark.parametrize("endpoint", [
    "http://169.254.169.254/latest/meta-data/",
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://evil.example.com/push/abc",
    "https://fcm.googleapis.com:8443/fcm/send/abc",
    "https://user:pass@fcm.googleapis.com/fcm/send/abc",
])
async def test_push_subscribe_rejects_non_allowlisted_endpoint(context, endpoint):
    client, db, app, owner, stranger, admin, report, guest = context
    resp = await client.post(f"/feedback/support/{report.id}/push", json={"endpoint": endpoint, "keys": {"p256dh": "p", "auth": "a"}})
    assert resp.status_code == 422
    rows = (await db.execute(select(SupportPushSubscription).where(SupportPushSubscription.report_id == report.id))).scalars().all()
    assert rows == []


async def test_push_subscribe_accepts_allowlisted_endpoint(context):
    client, db, app, owner, stranger, admin, report, guest = context
    resp = await client.post(f"/feedback/support/{report.id}/push", json={"endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": {"p256dh": "p", "auth": "a"}})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


async def test_push_sixth_subscription_evicts_oldest(context):
    client, db, app, owner, stranger, admin, report, guest = context
    for i in range(1, 7):
        resp = await client.post(f"/feedback/support/{report.id}/push", json={"endpoint": f"https://fcm.googleapis.com/fcm/send/{i}", "keys": {"p256dh": "p", "auth": "a"}})
        assert resp.status_code == 200
    rows = (await db.execute(select(SupportPushSubscription).where(SupportPushSubscription.report_id == report.id).order_by(SupportPushSubscription.endpoint))).scalars().all()
    endpoints = {r.endpoint for r in rows}
    assert len(rows) == 5
    assert "https://fcm.googleapis.com/fcm/send/1" not in endpoints
    assert "https://fcm.googleapis.com/fcm/send/6" in endpoints


async def test_cookieless_guest_limited_via_ip_bucket(context, monkeypatch):
    from datetime import datetime, timezone

    from jose import jwt as jose_jwt

    from src.core.config import settings

    client, db, app, owner, stranger, admin, report, guest = context
    app.dependency_overrides[get_optional_user] = lambda: None
    monkeypatch.setattr("src.api.feedback.notify_submission", AsyncMock())
    monkeypatch.setattr("src.services.feedback_ai.process_new_support_report", AsyncMock())
    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "test-internal-secret")
    monkeypatch.setattr(settings, "SUPPORT_TICKET_HOURLY_GUEST_IP", 3)
    token = jose_jwt.encode({"aud": "internal", "exp": datetime.now(timezone.utc).timestamp() + 60}, "test-internal-secret", algorithm="HS256")
    headers = {"Authorization": f"Bearer {token}", "X-Client-IP": "203.0.113.7"}
    last = None
    for i in range(6):
        resp = await client.post("/feedback/support", data={"message": f"ip msg {i}"}, headers=headers)
        client.cookies.clear()
        last = resp.status_code
        if resp.status_code == 429:
            break
    assert last == 429
    rows = (await db.execute(select(SupportRateLimit).where(SupportRateLimit.key == "ip:203.0.113.7:tickets"))).scalars().all()
    assert len(rows) == 1


async def test_cookieless_guest_limited_via_untrusted_bucket(context, monkeypatch):
    from src.core.config import settings

    client, db, app, owner, stranger, admin, report, guest = context
    app.dependency_overrides[get_optional_user] = lambda: None
    monkeypatch.setattr("src.api.feedback.notify_submission", AsyncMock())
    monkeypatch.setattr("src.services.feedback_ai.process_new_support_report", AsyncMock())
    monkeypatch.setattr(settings, "SUPPORT_TICKET_HOURLY_GUEST_UNTRUSTED", 3)
    last = None
    for i in range(6):
        resp = await client.post("/feedback/support", data={"message": f"untrusted msg {i}"})
        client.cookies.clear()
        last = resp.status_code
        if resp.status_code == 429:
            break
    assert last == 429
    rows = (await db.execute(select(SupportRateLimit).where(SupportRateLimit.key == "guest-untrusted:tickets"))).scalars().all()
    assert len(rows) == 1


async def test_guest_reply_per_report_limit(context, monkeypatch):
    from src.core.config import settings

    client, db, app, owner, stranger, admin, report, guest = context
    app.dependency_overrides[get_optional_user] = lambda: None
    monkeypatch.setattr(settings, "SUPPORT_REPLY_HOURLY_GUEST_REPORT", 2)
    monkeypatch.setattr(settings, "SUPPORT_REPLY_HOURLY_GUEST_UNTRUSTED", 100)
    monkeypatch.setattr(settings, "SUPPORT_REPLY_HOURLY_GUEST_COOKIE", 100)
    monkeypatch.setattr(settings, "SUPPORT_REPLY_HOURLY_GUEST_IP", 100)
    token = support.guest_token(guest.id)
    statuses = []
    for i in range(4):
        resp = await client.post(f"/feedback/support/{guest.id}/messages", params={"access_token": token}, json={"message": f"reply {i}"})
        client.cookies.clear()
        statuses.append(resp.status_code)
    assert statuses == [200, 200, 429, 429]


async def test_patch_support_rate_limit_429(context, monkeypatch):
    from src.core.config import settings

    client, db, app, owner, stranger, admin, report, guest = context
    monkeypatch.setattr(settings, "SUPPORT_REPLY_HOURLY_USER", 2)
    last = None
    statuses = ["resolved", "closed", "open", "resolved"]
    for s in statuses:
        resp = await client.patch(f"/feedback/support/{report.id}", json={"status": s})
        last = resp.status_code
        if resp.status_code == 429:
            break
    assert last == 429

