import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import ARRAY

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))
sqlite3.register_adapter(list, json.dumps)
sqlite3.register_adapter(dict, json.dumps)


@compiles(ARRAY, "sqlite")
def _array_sqlite(type_, compiler, **kw):
    return "JSON"


@compiles(JSONB, "sqlite")
def _jsonb_sqlite(type_, compiler, **kw):
    return "JSON"


from src.core.config import settings
from src.core.database import get_db
from src.core.oauth import create_oauth_access_token
from src.core.security import hash_password
from src.main import app
from src.models.generation import Generation, ReportAttachment, SupportReport, UserCreditOverride, UserRateLimit
from src.models.identity import EmailVerification, GithubLinkState, GithubToken, UserIdentity
from src.models.oauth import OAuthAuthorizationCode, OAuthRefreshToken
from src.models.user import AccountCleanupTask, Base, User
from src.services import account_deletion

TEST_INTERNAL = "test-internal-secret"
TABLES = [
    User.__table__,
    UserIdentity.__table__,
    GithubToken.__table__,
    GithubLinkState.__table__,
    EmailVerification.__table__,
    OAuthAuthorizationCode.__table__,
    OAuthRefreshToken.__table__,
    Generation.__table__,
    SupportReport.__table__,
    ReportAttachment.__table__,
    AccountCleanupTask.__table__,
    UserRateLimit.__table__,
    UserCreditOverride.__table__,
]


class FakeStorage:
    deleted: list[str] = []
    fail = False

    def __init__(self):
        self.enabled = True

    def delete_files(self, keys):
        if FakeStorage.fail:
            return list(keys)
        FakeStorage.deleted.extend(keys)
        return []


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", TEST_INTERNAL)
    monkeypatch.setattr(settings, "RESEND_API_KEY", "")
    monkeypatch.setattr(account_deletion, "StorageService", FakeStorage)
    FakeStorage.deleted = []
    FakeStorage.fail = False


@pytest.fixture
async def async_db(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=TABLES))
    session_maker = async_sessionmaker(engine, expire_on_commit=False)
    import src.mcp.server

    monkeypatch.setattr(src.mcp.server, "AsyncSessionLocal", session_maker)
    async with session_maker() as session:
        yield session
    await engine.dispose()


@pytest.fixture
async def client(async_db: AsyncSession):
    async def override_get_db():
        yield async_db

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as ac:
        yield ac
    app.dependency_overrides.clear()


def bearer(user: User) -> dict:
    token = jose_jwt.encode({"sub": str(user.id), "email": user.email}, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return {"Authorization": f"Bearer {token}"}


def internal_headers() -> dict:
    token = jose_jwt.encode(
        {"aud": "internal", "exp": datetime.now(timezone.utc).timestamp() + 60}, TEST_INTERNAL, algorithm="HS256"
    )
    return {"Authorization": f"Bearer {token}"}


async def make_user(db, email="dana@example.com", provider="credentials", password="Password123!", **extra):
    user = User(
        email=email,
        name="Dana",
        provider=provider,
        hashed_password=hash_password(password) if provider == "credentials" else None,
        email_verified_at=datetime.now(timezone.utc),
        signup_completed_at=datetime.now(timezone.utc),
        **extra,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def user_exists(db, user_id) -> bool:
    return (await db.execute(select(User.id).where(User.id == user_id))).scalar_one_or_none() is not None


async def deletion_columns(db, user_id):
    row = (
        await db.execute(
            select(User.deletion_requested_at, User.deletion_scheduled_for, User.deletion_restored_at).where(
                User.id == user_id
            )
        )
    ).one()
    return row


def past(days=0, **kw):
    return datetime.now(timezone.utc) - timedelta(days=days, **kw)


def future(days=0, **kw):
    return datetime.now(timezone.utc) + timedelta(days=days, **kw)


# ── Requesting deletion ───────────────────────────────────────────────────────


async def test_request_requires_typed_email(client, async_db):
    user = await make_user(async_db)
    res = await client.post("/account/deletion", json={"confirm_email": "wrong@example.com"}, headers=bearer(user))
    assert res.status_code == 400
    requested, scheduled, _ = await deletion_columns(async_db, user.id)
    assert requested is None and scheduled is None


async def test_request_schedules_seven_days_and_revokes_connectors(client, async_db):
    user = await make_user(async_db)
    async_db.add(
        OAuthRefreshToken(
            token_hash="h", client_id="c", user_id=user.id, scope="s", expires_at=future(30)
        )
    )
    async_db.add(
        OAuthAuthorizationCode(
            code_hash="ch", client_id="c", user_id=user.id, redirect_uri="https://x", scope="s",
            code_challenge="cc", expires_at=future(minutes=5),
        )
    )
    await async_db.commit()

    res = await client.post("/account/deletion", json={"confirm_email": " DANA@example.com "}, headers=bearer(user))
    assert res.status_code == 200
    scheduled_for = datetime.fromisoformat(res.json()["deletion_scheduled_for"])
    assert timedelta(days=6, hours=23) < scheduled_for - datetime.now(timezone.utc) <= timedelta(days=7)

    requested, scheduled, _ = await deletion_columns(async_db, user.id)
    assert requested is not None and scheduled is not None
    assert (await async_db.execute(select(OAuthRefreshToken.id))).first() is None
    assert (await async_db.execute(select(OAuthAuthorizationCode.id))).first() is None
    # Nothing is deleted yet.
    assert await user_exists(async_db, user.id)


async def test_repeat_request_keeps_original_deadline(async_db):
    user = await make_user(async_db)
    first = await account_deletion.schedule_deletion(async_db, user, now=past(2))
    second = await account_deletion.schedule_deletion(async_db, user)
    assert first == second


async def test_pending_account_is_locked_out(client, async_db):
    user = await make_user(async_db, deletion_requested_at=past(1), deletion_scheduled_for=future(6))
    res = await client.get("/account/deletion", headers=bearer(user))
    assert res.status_code == 401
    assert res.headers["x-account-status"] == "pending_deletion"
    assert "scheduled for deletion" in res.json()["detail"]


# ── Restoring by signing in ───────────────────────────────────────────────────


async def test_password_sign_in_restores_and_notice_can_be_dismissed(client, async_db):
    user = await make_user(async_db, deletion_requested_at=past(3), deletion_scheduled_for=future(4))

    wrong = await client.post("/auth/email/login", json={"email": user.email, "password": "nope-nope"})
    assert wrong.status_code == 401
    _, scheduled, _ = await deletion_columns(async_db, user.id)
    assert scheduled is not None  # a bad password restores nothing

    res = await client.post("/auth/email/login", json={"email": user.email, "password": "Password123!"})
    assert res.status_code == 200
    assert res.json()["restored"] is True
    requested, scheduled, restored_at = await deletion_columns(async_db, user.id)
    assert requested is None and scheduled is None and restored_at is not None

    # Second login (the Auth.js authorize call after the precheck) is a normal sign-in.
    again = await client.post("/auth/email/login", json={"email": user.email, "password": "Password123!"})
    assert again.json()["restored"] is False

    status_res = await client.get("/account/deletion", headers=bearer(user))
    assert status_res.status_code == 200
    assert status_res.json()["restored_at"] is not None

    dismissed = await client.delete("/account/deletion/restored-notice", headers=bearer(user))
    assert dismissed.status_code == 200
    assert (await client.get("/account/deletion", headers=bearer(user))).json()["restored_at"] is None


async def test_oauth_sign_in_restores_pending_account(client, async_db):
    user = await make_user(
        async_db, email="gina@example.com", provider="google",
        deletion_requested_at=past(1), deletion_scheduled_for=future(6),
    )
    async_db.add(UserIdentity(user_id=user.id, provider="google", provider_account_id="g-1", kind="login"))
    await async_db.commit()

    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "g-1", "email": "gina@example.com", "email_verified": True},
        headers=internal_headers(),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["uid"] == str(user.id) and body["restored"] is True and body["is_new"] is False
    _, scheduled, restored_at = await deletion_columns(async_db, user.id)
    assert scheduled is None and restored_at is not None


async def test_oauth_provider_mismatch_does_not_restore(client, async_db):
    user = await make_user(async_db, deletion_requested_at=past(1), deletion_scheduled_for=future(6))
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "g-9", "email": user.email, "email_verified": True},
        headers=internal_headers(),
    )
    assert res.status_code == 409
    _, scheduled, _ = await deletion_columns(async_db, user.id)
    assert scheduled is not None


# ── After the grace period ────────────────────────────────────────────────────


async def test_password_sign_in_after_deadline_purges_and_reports_no_account(client, async_db):
    user = await make_user(async_db, deletion_requested_at=past(8), deletion_scheduled_for=past(1))
    res = await client.post("/auth/email/login", json={"email": user.email, "password": "Password123!"})
    assert res.status_code == 401
    assert "No account found" in res.json()["detail"]
    assert not await user_exists(async_db, user.id)


async def test_oauth_sign_in_after_deadline_starts_fresh_account(client, async_db):
    # Matched by email. (Postgres would also cascade away its identity rows; this SQLite
    # setup doesn't enforce foreign keys, so the test doesn't create any.)
    old = await make_user(
        async_db, email="hal@example.com", provider="google",
        deletion_requested_at=past(8), deletion_scheduled_for=past(minutes=5),
    )
    old_id = old.id

    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "g-2", "email": "hal@example.com", "email_verified": True},
        headers=internal_headers(),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["is_new"] is True and body["uid"] != str(old_id)
    assert not await user_exists(async_db, old_id)


async def test_register_with_pending_email_is_rejected_but_due_email_is_freed(client, async_db, monkeypatch):
    sent = []
    monkeypatch.setattr("src.api.auth.send_verification_code_email", lambda *a: sent.append(a))
    pending = await make_user(async_db, email="ivy@example.com", deletion_scheduled_for=future(2))
    due = await make_user(async_db, email="jon@example.com", deletion_scheduled_for=past(minutes=1))

    body = {"password": "Password123!", "name": "X"}
    res = await client.post("/auth/email/register/start", json={**body, "email": "ivy@example.com"}, headers=internal_headers())
    assert res.status_code == 409
    assert "Sign in to restore" in res.json()["detail"]
    assert await user_exists(async_db, pending.id)

    res = await client.post("/auth/email/register/start", json={**body, "email": "jon@example.com"}, headers=internal_headers())
    assert res.status_code == 200, res.text
    assert not await user_exists(async_db, due.id)
    assert len(sent) == 1


async def test_purge_job_deletes_due_accounts_and_their_files(async_db):
    due = await make_user(async_db, email="due@example.com", deletion_scheduled_for=past(minutes=1))
    pending = await make_user(async_db, email="pending@example.com", deletion_scheduled_for=future(1))
    active = await make_user(async_db, email="active@example.com")
    gen = Generation(user_id=due.id, template_id="t", job_description="jd", status="completed", pdf_storage_key="custom/key.pdf")
    other_gen = Generation(user_id=active.id, template_id="t", job_description="jd", status="completed")
    report = SupportReport(user_id=due.id, message="help")
    async_db.add_all([gen, other_gen, report])
    await async_db.commit()
    async_db.add(ReportAttachment(report_id=report.id, attachment_type="screenshot", storage_key="feedback/screenshots/x.png"))
    await async_db.commit()

    ids = (due.id, pending.id, active.id, gen.id)
    counts = await account_deletion.purge_due_accounts(async_db)
    assert counts == {"purged": 1, "skipped": 0}
    due_id, pending_id, active_id, gen_id = ids
    assert not await user_exists(async_db, due_id)
    assert await user_exists(async_db, pending_id)
    assert await user_exists(async_db, active_id)
    assert set(FakeStorage.deleted) == {
        "custom/key.pdf",
        f"runs/{gen_id}/resume.pdf",
        f"runs/{gen_id}/resume.md",
        f"runs/{gen_id}/thumb.webp",
        "feedback/screenshots/x.png",
    }


async def test_purge_keeps_account_when_storage_cleanup_fails(async_db):
    due = await make_user(async_db, deletion_scheduled_for=past(minutes=1))
    due_id = due.id
    async_db.add(Generation(user_id=due_id, template_id="t", job_description="jd", status="completed"))
    await async_db.commit()
    FakeStorage.fail = True

    counts = await account_deletion.purge_due_accounts(async_db)
    assert counts == {"purged": 0, "skipped": 1}
    assert await user_exists(async_db, due_id)  # retried on the next run, files never orphaned


async def test_restore_refuses_once_deadline_has_passed(async_db):
    user = await make_user(async_db, deletion_scheduled_for=past(seconds=1))
    with pytest.raises(account_deletion.AccountDeletedError):
        await account_deletion.restore_if_pending(async_db, user)


async def test_purge_user_ignores_accounts_that_are_not_due(async_db):
    user = await make_user(async_db, deletion_scheduled_for=future(1))
    assert await account_deletion.purge_user(async_db, user.id) is False
    assert await user_exists(async_db, user.id)


# ── Other entry points ────────────────────────────────────────────────────────


async def _mcp_initialize(client, token):
    from src.mcp.server import mcp_server

    mcp_server.session_manager._has_started = False
    async with mcp_server.session_manager.run():
        return await client.post(
            "/mcp",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
            },
            json={
                "jsonrpc": "2.0",
                "method": "initialize",
                "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}},
                "id": 1,
            },
        )


async def test_mcp_rejects_pending_account(client, async_db):
    user = await make_user(async_db, deletion_scheduled_for=future(3))
    token, _ = create_oauth_access_token(user_id=user.id, email=user.email, scope="profile:read", client_id="c")
    res = await _mcp_initialize(client, token)
    assert res.status_code == 401
    assert "scheduled for deletion" in res.json()["message"]


async def test_mcp_token_for_deleted_account_does_not_recreate_it(client, async_db):
    token, _ = create_oauth_access_token(
        user_id=uuid.uuid4(), email="gone@example.com", scope="profile:read", client_id="c"
    )
    res = await _mcp_initialize(client, token)
    assert res.status_code == 401
    assert (await async_db.execute(select(User.id).where(User.email == "gone@example.com"))).first() is None


# ── External cleanup after the purge (PostHog, GitHub) ────────────────────────

import httpx
from cryptography.fernet import Fernet

from src.core.token_crypto import encrypt_token


@pytest.fixture
def http_calls(monkeypatch):
    """Route every httpx.AsyncClient through a mock transport; tests set the responses."""
    calls: list[httpx.Request] = []
    responses: dict[str, httpx.Response] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        for prefix, response in responses.items():
            if str(request.url).startswith(prefix):
                return response
        return httpx.Response(500)

    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    return calls, responses


@pytest.fixture
def cleanup_creds(monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_TOKEN_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "POSTHOG_PERSONAL_API_KEY", "phx_test")
    monkeypatch.setattr(settings, "POSTHOG_DELETION_API_KEY", "")
    monkeypatch.setattr(settings, "POSTHOG_PROJECT_ID", "123")
    monkeypatch.setattr(settings, "POSTHOG_API_HOST", "https://ph.test")
    monkeypatch.setattr(settings, "GITHUB_LOGIN_CLIENT_ID", "login-id")
    monkeypatch.setattr(settings, "GITHUB_LOGIN_CLIENT_SECRET", "login-secret")
    monkeypatch.setattr(settings, "GITHUB_CONNECT_CLIENT_ID", "connect-id")
    monkeypatch.setattr(settings, "GITHUB_CONNECT_CLIENT_SECRET", "connect-secret")


async def _purge_github_user(async_db):
    user = await make_user(async_db, email="Kim@Example.com", provider="github", deletion_scheduled_for=past(minutes=1))
    user_id = user.id
    identity = UserIdentity(user_id=user_id, provider="github", provider_account_id="gh-1", kind="login")
    async_db.add(identity)
    await async_db.commit()
    # One insert per row: SQLite can't match batch-insert sentinels on this model's UUID column.
    for app in ("login", "connect"):
        async_db.add(GithubToken(identity_id=identity.id, oauth_app=app, access_token_encrypted=encrypt_token(f"gho_{app}")))
        await async_db.commit()
    assert await account_deletion.purge_user(async_db, user_id)
    return user_id


async def pending_tasks(db):
    return (await db.execute(select(AccountCleanupTask.kind, AccountCleanupTask.status, AccountCleanupTask.attempts, AccountCleanupTask.payload))).all()


async def test_purge_queues_posthog_and_both_github_grants(async_db, cleanup_creds):
    user_id = await _purge_github_user(async_db)
    tasks = await pending_tasks(async_db)
    kinds = sorted((t.kind, t.payload.get("app")) for t in tasks)
    assert kinds == [("github_grant", "connect"), ("github_grant", "login"), ("posthog_person", None)]
    posthog = next(t for t in tasks if t.kind == "posthog_person")
    assert posthog.payload["distinct_ids"] == ["kim@example.com", f"api-user:{user_id}"]
    # Tokens stay encrypted at rest in the queue.
    assert all("gho_" not in json.dumps(t.payload) for t in tasks)


async def test_cleanup_runs_against_posthog_and_github(async_db, cleanup_creds, http_calls):
    calls, responses = http_calls
    responses["https://ph.test/api/projects/123/persons/bulk_delete/"] = httpx.Response(
        202, json={"persons_found": 1, "persons_deleted": 0, "persons_queued_for_deletion": 1, "deletion_errors": []}
    )
    responses["https://api.github.com/applications/login-id/grant"] = httpx.Response(204)
    responses["https://api.github.com/applications/connect-id/grant"] = httpx.Response(404)  # already gone counts as done
    await _purge_github_user(async_db)

    counts = await account_deletion.run_cleanup_tasks(async_db)
    assert counts == {"done": 3, "retry": 0, "waiting": 0, "failed": 0}
    assert await pending_tasks(async_db) == []

    posthog_call = next(c for c in calls if "posthog" in str(c.url) or "ph.test" in str(c.url))
    assert posthog_call.headers["authorization"] == "Bearer phx_test"
    body = json.loads(posthog_call.content)
    assert body["delete_events"] is True and body["delete_recordings"] is True
    login_call = next(c for c in calls if "login-id" in str(c.url))
    assert json.loads(login_call.content) == {"access_token": "gho_login"}


async def test_cleanup_without_credentials_waits_without_spending_attempts(async_db, cleanup_creds, monkeypatch, http_calls):
    await _purge_github_user(async_db)
    monkeypatch.setattr(settings, "POSTHOG_PERSONAL_API_KEY", "")
    monkeypatch.setattr(settings, "GITHUB_LOGIN_CLIENT_ID", "")
    monkeypatch.setattr(settings, "GITHUB_CONNECT_CLIENT_ID", "")

    counts = await account_deletion.run_cleanup_tasks(async_db)
    assert counts["waiting"] == 3 and counts["done"] == 0
    assert all(t.attempts == 0 and t.status == "pending" for t in await pending_tasks(async_db))
    assert http_calls[0] == []


async def test_cleanup_failures_retry_then_park_as_failed(async_db, cleanup_creds, http_calls, monkeypatch):
    _, responses = http_calls
    responses["https://ph.test/"] = httpx.Response(403)  # key lacks person:write
    responses["https://api.github.com/"] = httpx.Response(204)
    await _purge_github_user(async_db)

    counts = await account_deletion.run_cleanup_tasks(async_db)
    assert counts == {"done": 2, "retry": 1, "waiting": 0, "failed": 0}
    (task,) = await pending_tasks(async_db)
    assert task.kind == "posthog_person" and task.attempts == 1

    monkeypatch.setattr(account_deletion, "MAX_CLEANUP_ATTEMPTS", 2)
    counts = await account_deletion.run_cleanup_tasks(async_db)
    assert counts["failed"] == 1
    (task,) = await pending_tasks(async_db)
    assert task.status == "failed"
    # Parked tasks are not retried automatically.
    assert (await account_deletion.run_cleanup_tasks(async_db))["failed"] == 0


# ── Admin view ────────────────────────────────────────────────────────────────


async def test_admin_lists_pending_deletions_soonest_first(client, async_db, monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "boss@example.com")
    admin = await make_user(async_db, email="boss@example.com")
    later = await make_user(async_db, email="later@example.com", deletion_requested_at=past(1), deletion_scheduled_for=future(6))
    soon = await make_user(async_db, email="soon@example.com", deletion_requested_at=past(6), deletion_scheduled_for=future(hours=20))
    async_db.add(AccountCleanupTask(kind="posthog_person", payload={"distinct_ids": ["x"]}, last_error="PostHog deletion key or project id not set"))
    await async_db.commit()

    res = await client.get("/admin/users/pending-deletion", headers=bearer(admin))
    assert res.status_code == 200, res.text
    body = res.json()
    assert [a["email"] for a in body["accounts"]] == ["soon@example.com", "later@example.com"]
    assert body["cleanup"] == [{"kind": "posthog_person", "status": "pending", "count": 1, "last_error": "PostHog deletion key or project id not set"}]

    listed = {u["email"]: u for u in (await client.get("/admin/users", headers=bearer(admin))).json()}
    assert listed["soon@example.com"]["deletion_scheduled_for"] is not None
    assert listed["boss@example.com"]["deletion_scheduled_for"] is None


async def test_admin_endpoint_requires_admin(client, async_db, monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "boss@example.com")
    user = await make_user(async_db)
    assert (await client.get("/admin/users/pending-deletion", headers=bearer(user))).status_code == 403
