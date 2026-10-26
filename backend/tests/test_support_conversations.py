import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.api.feedback import router
from src.core.auth import get_current_user, get_optional_user
from src.core.database import get_db
from src.models.generation import FeedbackRating, ReportAttachment, SupportMessage, SupportReport
from src.models.user import Base, User
from src.services import support


@pytest.fixture
async def context(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[User.__table__, SupportReport.__table__, SupportMessage.__table__, ReportAttachment.__table__, FeedbackRating.__table__]))
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
