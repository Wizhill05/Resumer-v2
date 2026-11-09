import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))

from src.api import auth as auth_module
from src.api.auth import _hash_code
from src.core import notify
from src.core.config import settings
from src.core.database import get_db
from src.core.notify import send_verification_code_email
from src.core.security import hash_password
from src.main import app
from src.models.identity import EmailVerification
from src.models.user import Base, User

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
TEST_INTERNAL = "test-internal-secret"


def internal_headers() -> dict:
    token = jose_jwt.encode(
        {"aud": "internal", "exp": datetime.now(timezone.utc).timestamp() + 60},
        TEST_INTERNAL,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _internal_secret(monkeypatch):
    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", TEST_INTERNAL)


@pytest.fixture(autouse=True)
def _clear_rate_limiter():
    auth_module._send_times.clear()
    yield
    auth_module._send_times.clear()


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [User.__table__, EmailVerification.__table__]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, tables=tables))

    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.drop_all(sync_conn, tables=tables))
    await engine.dispose()


@pytest.fixture
async def client(async_db: AsyncSession):
    """Client that behaves like the Next.js server: sends a valid internal token."""
    async def override_get_db():
        yield async_db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver", headers=internal_headers()) as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
async def anon_client(async_db: AsyncSession):
    """Client that calls the backend directly, without an internal token."""
    async def override_get_db():
        yield async_db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def sent_codes(monkeypatch):
    """Monkeypatch the sender to capture codes instead of sending real email."""
    captured: list[dict] = []

    def _fake_send(to_email: str, name: str, code: str) -> None:
        captured.append({"to_email": to_email, "name": name, "code": code})

    monkeypatch.setattr(auth_module, "send_verification_code_email", _fake_send)
    return captured


def _latest_code(sent_codes) -> str:
    assert sent_codes, "expected a code to have been sent"
    return sent_codes[-1]["code"]


async def _start(client: AsyncClient, email="new@example.com", password="Password123!", name="New User"):
    return await client.post(
        "/auth/email/register/start",
        json={"email": email, "password": password, "name": name},
    )


async def test_happy_path_start_verify_creates_verified_user(
    client: AsyncClient, async_db: AsyncSession, sent_codes
):
    res = await _start(client)
    assert res.status_code == 200
    assert res.json() == {
        "ok": True,
        "email": "new@example.com",
        "expires_in": 900,
        "resend_after": 60,
    }
    assert len(sent_codes) == 1
    assert sent_codes[0]["to_email"] == "new@example.com"
    code = _latest_code(sent_codes)

    # No user exists until the code is verified.
    result = await async_db.execute(select(User).where(User.email == "new@example.com"))
    assert result.scalar_one_or_none() is None

    verify = await client.post(
        "/auth/email/register/verify",
        json={"email": "new@example.com", "code": code, "password": "Password123!"},
    )
    assert verify.status_code == 200
    data = verify.json()
    assert data["email"] == "new@example.com"
    assert data["name"] == "New User"
    assert data["provider"] == "credentials"
    assert data["needs_welcome"] is True
    assert data["id"]

    user = (await async_db.execute(select(User).where(User.email == "new@example.com"))).scalar_one()
    assert user.provider == "credentials"
    assert user.email_verified_at is not None
    assert user.signup_completed_at is None

    # Pending row is deleted.
    pending = (
        await async_db.execute(select(EmailVerification).where(EmailVerification.email == "new@example.com"))
    ).scalar_one_or_none()
    assert pending is None

    # The created credentials can sign in.
    login = await client.post(
        "/auth/email/login",
        json={"email": "new@example.com", "password": "Password123!"},
    )
    assert login.status_code == 200


@pytest.mark.parametrize(
    "provider,expected_detail",
    [
        ("google", "This email is registered with Google. Sign in with Google."),
        ("github", "This email is registered with GitHub. Sign in with GitHub."),
        ("credentials", "An account with this email already exists. Sign in instead."),
    ],
)
async def test_start_conflict_messages(
    client: AsyncClient, async_db: AsyncSession, sent_codes, provider, expected_detail
):
    async_db.add(
        User(email="taken@example.com", name="Taken", provider=provider, hashed_password=hash_password("Password123!"))
    )
    await async_db.commit()

    res = await _start(client, email="taken@example.com")
    assert res.status_code == 409
    assert res.json()["detail"] == expected_detail
    assert sent_codes == []


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "new@example.com", "password": "Short1!", "name": "New User"},
        {"email": "new@example.com", "password": "Password123!", "name": ""},
        {"email": "new@example.com", "password": "Password123!", "name": "   "},
        {"email": "new@example.com", "password": "Password123!", "name": "x" * 101},
        {"email": "new@example.com", "password": "x" * 129, "name": "New User"},
    ],
)
async def test_start_validates_password_and_name(client, sent_codes, payload):
    res = await client.post("/auth/email/register/start", json=payload)
    assert res.status_code in (400, 422)
    assert sent_codes == []


async def test_wrong_code_increments_attempts(client: AsyncClient, async_db: AsyncSession, sent_codes):
    await _start(client)
    wrong = "000000"
    if _latest_code(sent_codes) == wrong:
        wrong = "999999"

    res = await client.post(
        "/auth/email/register/verify",
        json={"email": "new@example.com", "code": wrong, "password": "Password123!"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "That code is wrong or expired."

    pending = (
        await async_db.execute(select(EmailVerification).where(EmailVerification.email == "new@example.com"))
    ).scalar_one()
    assert pending.attempts == 1

    # The correct code still works after one wrong attempt.
    ok = await client.post(
        "/auth/email/register/verify",
        json={"email": "new@example.com", "code": _latest_code(sent_codes), "password": "Password123!"},
    )
    assert ok.status_code == 200


async def test_five_wrong_attempts_then_429(client: AsyncClient, async_db: AsyncSession, sent_codes):
    await _start(client)
    wrong = "000000"
    if _latest_code(sent_codes) == wrong:
        wrong = "999999"

    for _ in range(5):
        res = await client.post(
            "/auth/email/register/verify",
            json={"email": "new@example.com", "code": wrong, "password": "Password123!"},
        )
        assert res.status_code == 400

    # Even the right code is now refused.
    res = await client.post(
        "/auth/email/register/verify",
        json={"email": "new@example.com", "code": _latest_code(sent_codes), "password": "Password123!"},
    )
    assert res.status_code == 429
    assert res.json()["detail"] == "Too many attempts. Request a new code."

    pending = (
        await async_db.execute(select(EmailVerification).where(EmailVerification.email == "new@example.com"))
    ).scalar_one()
    assert pending.attempts == 5


async def test_expired_code_is_rejected(client: AsyncClient, async_db: AsyncSession, sent_codes):
    await _start(client)
    pending = (
        await async_db.execute(select(EmailVerification).where(EmailVerification.email == "new@example.com"))
    ).scalar_one()
    pending.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await async_db.commit()

    res = await client.post(
        "/auth/email/register/verify",
        json={"email": "new@example.com", "code": _latest_code(sent_codes), "password": "Password123!"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "That code is wrong or expired."


async def test_verify_without_pending_is_400(client: AsyncClient):
    res = await client.post(
        "/auth/email/register/verify",
        json={"email": "ghost@example.com", "code": "123456", "password": "Password123!"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "That code is wrong or expired."


async def test_resend_replaces_code(client: AsyncClient, sent_codes):
    await _start(client)
    first = _latest_code(sent_codes)

    # The limiter blocks an immediate resend; clear it to exercise replacement.
    auth_module._send_times.clear()
    res = await client.post("/auth/email/register/resend", json={"email": "new@example.com"})
    assert res.status_code == 200
    assert res.json() == {"ok": True, "resend_after": 60}
    second = _latest_code(sent_codes)
    assert second != first

    old = await client.post(
        "/auth/email/register/verify",
        json={"email": "new@example.com", "code": first, "password": "Password123!"},
    )
    assert old.status_code == 400

    new = await client.post(
        "/auth/email/register/verify",
        json={"email": "new@example.com", "code": second, "password": "Password123!"},
    )
    assert new.status_code == 200


async def test_resend_without_pending_is_404(client: AsyncClient):
    res = await client.post("/auth/email/register/resend", json={"email": "ghost@example.com"})
    assert res.status_code == 404


async def test_rate_limit_blocks_second_send(client: AsyncClient, sent_codes):
    assert (await _start(client)).status_code == 200

    # Second start within 60s is rate-limited, as is an immediate resend.
    second = await _start(client)
    assert second.status_code == 429
    assert "detail" in second.json()

    resend = await client.post("/auth/email/register/resend", json={"email": "new@example.com"})
    assert resend.status_code == 429


async def test_user_appearing_between_start_and_verify_is_409(
    client: AsyncClient, async_db: AsyncSession, sent_codes
):
    await _start(client)
    code = _latest_code(sent_codes)

    async_db.add(
        User(email="new@example.com", name="Racer", provider="google", hashed_password=None)
    )
    await async_db.commit()

    res = await client.post(
        "/auth/email/register/verify",
        json={"email": "new@example.com", "code": code, "password": "Password123!"},
    )
    assert res.status_code == 409
    assert res.json()["detail"] == "This email is registered with Google. Sign in with Google."


async def test_code_is_not_stored_in_plaintext(client: AsyncClient, async_db: AsyncSession, sent_codes):
    await _start(client)
    code = _latest_code(sent_codes)

    pending = (
        await async_db.execute(select(EmailVerification).where(EmailVerification.email == "new@example.com"))
    ).scalar_one()
    assert pending.code_hash != code
    assert code not in pending.code_hash
    assert pending.code_hash == _hash_code("new@example.com", code)


def test_dev_logging_without_resend_key(monkeypatch, capsys):
    monkeypatch.setattr(notify.settings, "RESEND_API_KEY", "")
    monkeypatch.setattr(notify.settings, "ENVIRONMENT", "development")
    send_verification_code_email("dev@example.com", "Dev", "123456")
    out = capsys.readouterr().out
    assert "[dev] verification code for dev@example.com: 123456" in out


def test_production_raises_without_resend_key(monkeypatch):
    monkeypatch.setattr(notify.settings, "RESEND_API_KEY", "")
    monkeypatch.setattr(notify.settings, "ENVIRONMENT", "production")
    with pytest.raises(RuntimeError):
        send_verification_code_email("prod@example.com", "Prod", "123456")


async def test_send_failure_returns_503_and_keeps_pending(client: AsyncClient, monkeypatch):
    def _boom(to_email: str, name: str, code: str) -> None:
        raise RuntimeError("resend is down")

    monkeypatch.setattr(auth_module, "send_verification_code_email", _boom)
    res = await _start(client)
    assert res.status_code == 503
    assert res.json()["detail"] == "Email sending is unavailable right now."


async def test_attacker_restart_with_victim_password_is_rejected(
    client: AsyncClient, async_db: AsyncSession, sent_codes
):
    assert (
        await _start(client, password="VictimPass123!", name="Victim")
    ).status_code == 200

    # Attacker restarts the same email with their own password.
    auth_module._send_times.clear()
    assert (
        await _start(client, password="AttackerPass123!", name="Attacker")
    ).status_code == 200
    newest_code = _latest_code(sent_codes)

    # Victim types the newest code with her own password: same generic 400,
    # and no account is created.
    res = await client.post(
        "/auth/email/register/verify",
        json={"email": "new@example.com", "code": newest_code, "password": "VictimPass123!"},
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "That code is wrong or expired."

    pending = (
        await async_db.execute(select(EmailVerification).where(EmailVerification.email == "new@example.com"))
    ).scalar_one()
    assert pending.attempts == 1

    user = (await async_db.execute(select(User).where(User.email == "new@example.com"))).scalar_one_or_none()
    assert user is None


async def test_correct_code_and_password_creates_user_with_that_password(
    client: AsyncClient, async_db: AsyncSession, sent_codes
):
    assert (await _start(client, password="ChosenPass123!")).status_code == 200
    code = _latest_code(sent_codes)

    res = await client.post(
        "/auth/email/register/verify",
        json={"email": "new@example.com", "code": code, "password": "ChosenPass123!"},
    )
    assert res.status_code == 200

    user = (await async_db.execute(select(User).where(User.email == "new@example.com"))).scalar_one()
    assert user.provider == "credentials"

    login = await client.post(
        "/auth/email/login",
        json={"email": "new@example.com", "password": "ChosenPass123!"},
    )
    assert login.status_code == 200

    bad_login = await client.post(
        "/auth/email/login",
        json={"email": "new@example.com", "password": "WrongPass123!"},
    )
    assert bad_login.status_code == 401


async def test_different_emails_same_host_not_blocked(client: AsyncClient, sent_codes):
    for i in range(3):
        res = await _start(client, email=f"user{i}@example.com")
        assert res.status_code == 200


async def test_invalid_internal_token_is_rejected(anon_client: AsyncClient, sent_codes):
    headers = {"X-Client-IP": "203.0.113.1", "Authorization": "Bearer invalid-token"}
    res = await anon_client.post(
        "/auth/email/register/start",
        json={"email": "user@example.com", "password": "Password123!", "name": "User"},
        headers=headers,
    )
    assert res.status_code == 401
    assert sent_codes == []


async def test_per_ip_limit_with_valid_internal_token(client: AsyncClient, sent_codes, monkeypatch):
    headers = {**internal_headers(), "X-Client-IP": "203.0.113.1"}

    for i in range(10):
        res = await client.post(
            "/auth/email/register/start",
            json={"email": f"user{i}@example.com", "password": "Password123!", "name": "User"},
            headers=headers,
        )
        assert res.status_code == 200

    res11 = await client.post(
        "/auth/email/register/start",
        json={"email": "user10@example.com", "password": "Password123!", "name": "User"},
        headers=headers,
    )
    assert res11.status_code == 429


# --- internal token required on the public registration endpoints ---

@pytest.mark.parametrize(
    "path,body",
    [
        ("/auth/email/register/start", {"email": "direct@example.com", "password": "Password123!", "name": "Direct"}),
        ("/auth/email/register/resend", {"email": "direct@example.com"}),
        ("/auth/email/register/verify", {"email": "direct@example.com", "code": "123456", "password": "Password123!"}),
    ],
)
async def test_register_endpoints_require_internal_token(
    anon_client: AsyncClient, async_db: AsyncSession, sent_codes, path, body
):
    res = await anon_client.post(path, json=body)
    assert res.status_code == 401
    assert sent_codes == []
    pending = (await async_db.execute(select(EmailVerification))).scalars().all()
    assert pending == []
    users = (await async_db.execute(select(User))).scalars().all()
    assert users == []


async def test_register_endpoints_reject_user_jwt_as_internal_token(anon_client: AsyncClient, sent_codes):
    token = jose_jwt.encode({"sub": "abc", "email": "a@b.com"}, settings.JWT_SECRET, algorithm="HS256")
    res = await anon_client.post(
        "/auth/email/register/start",
        json={"email": "direct@example.com", "password": "Password123!", "name": "Direct"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 401
    assert sent_codes == []


# --- case-insensitive email lookups (legacy mixed-case rows) ---

async def test_login_matches_mixed_case_stored_email(client: AsyncClient, async_db: AsyncSession):
    async_db.add(
        User(
            email="Mixed.Case@Example.com",
            name="Mixed",
            hashed_password=hash_password("Password123!"),
            provider="credentials",
        )
    )
    await async_db.commit()
    res = await client.post(
        "/auth/email/login",
        json={"email": "mixed.case@example.com", "password": "Password123!"},
    )
    assert res.status_code == 200
    assert res.json()["email"] == "Mixed.Case@Example.com"


async def test_register_start_conflicts_with_mixed_case_stored_email(client: AsyncClient, async_db: AsyncSession, sent_codes):
    async_db.add(
        User(
            email="Legacy.User@Example.com",
            name="Legacy",
            hashed_password=hash_password("Password123!"),
            provider="credentials",
        )
    )
    await async_db.commit()
    res = await _start(client, email="legacy.user@example.com")
    assert res.status_code == 409
    assert sent_codes == []
