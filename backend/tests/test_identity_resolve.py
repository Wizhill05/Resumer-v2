import sqlite3
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))

from src.core.config import settings
from src.core.database import get_db
from src.core.security import hash_password
from src.main import app
from src.models.identity import GithubToken, UserIdentity
from src.models.user import Base, User
from src.services.github_tokens import get_sync_token

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

TEST_INTERNAL = "test-internal-secret"
TEST_FERNET = Fernet.generate_key().decode()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", TEST_INTERNAL)
    monkeypatch.setattr(settings, "GITHUB_TOKEN_KEY", TEST_FERNET)


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [User.__table__, UserIdentity.__table__, GithubToken.__table__]
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
    async def override_get_db():
        yield async_db

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac
    app.dependency_overrides.clear()


def internal_headers() -> dict:
    token = jose_jwt.encode({"aud": "internal", "exp": datetime.now(timezone.utc).timestamp() + 60}, TEST_INTERNAL, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


async def _create_user(async_db, email, provider="google", signup_completed_at=None):
    user = User(
        email=email,
        name="Test",
        provider=provider,
        email_verified_at=datetime.now(timezone.utc),
        signup_completed_at=signup_completed_at or datetime.now(timezone.utc),
    )
    async_db.add(user)
    await async_db.commit()
    await async_db.refresh(user)
    return user


async def _create_identity(async_db, user_id, provider="google", account_id="acc-1", kind="login"):
    ident = UserIdentity(user_id=user_id, provider=provider, provider_account_id=account_id, kind=kind)
    async_db.add(ident)
    await async_db.commit()
    await async_db.refresh(ident)
    return ident


# --- resolve branches ---

async def test_resolve_existing_login_identity(client, async_db):
    user = await _create_user(async_db, "alice@example.com")
    await _create_identity(async_db, user.id, "google", "google-1")
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "google-1", "email": "alice@example.com", "email_verified": True},
        headers=internal_headers(),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True and data["is_new"] is False


async def test_resolve_linked_not_login(client, async_db):
    user = await _create_user(async_db, "bob@example.com", provider="google")
    await _create_identity(async_db, user.id, "github", "gh-9", kind="link")
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "github", "provider_account_id": "gh-9", "email": "bob@example.com", "access_token": "tok"},
        headers=internal_headers(),
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["error"] == "linked_not_login"
    assert "Google" in detail["message"]


async def test_resolve_legacy_claim(client, async_db):
    user = await _create_user(async_db, "carol@example.com", provider="google")
    ident = UserIdentity(user_id=user.id, provider="google", provider_account_id=None, kind="login")
    async_db.add(ident)
    await async_db.commit()
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "google-2", "email": "carol@example.com", "email_verified": True},
        headers=internal_headers(),
    )
    assert res.status_code == 200
    await async_db.refresh(ident)
    assert ident.provider_account_id == "google-2"


async def test_resolve_unlocked_legacy_locks(client, async_db):
    user = await _create_user(async_db, "dave@example.com", provider=None)
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "google-3", "email": "dave@example.com", "email_verified": True},
        headers=internal_headers(),
    )
    assert res.status_code == 200
    await async_db.refresh(user)
    assert user.provider == "google"


async def test_resolve_provider_mismatch(client, async_db):
    await _create_user(async_db, "erin@example.com", provider="google")
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "github", "provider_account_id": "gh-new", "email": "erin@example.com", "access_token": "tok"},
        headers=internal_headers(),
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["error"] == "provider_mismatch"
    assert detail["provider"] == "google"
    assert detail["message"] == "This email is registered with Google. Sign in with Google."


async def test_resolve_new_google_user_needs_welcome(client, async_db):
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "google-new", "email": "new@example.com", "email_verified": True, "name": "New"},
        headers=internal_headers(),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["is_new"] is True and data["needs_welcome"] is True


async def test_resolve_new_google_unverified_rejected(client, async_db):
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "google-new", "email": "new2@example.com", "email_verified": False},
        headers=internal_headers(),
    )
    assert res.status_code == 409
    assert res.json()["detail"]["error"] == "email_not_verified"


async def test_resolve_new_github_verified_creates_and_stores_token(client, async_db):
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json = lambda: [{"email": "gh@example.com", "primary": True, "verified": True}]
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("src.api.internal_auth.httpx.AsyncClient", return_value=mock_client):
        res = await client.post(
            "/internal/auth/resolve",
            json={"provider": "github", "provider_account_id": "42", "email": "gh@example.com", "access_token": "gh-token-123", "provider_login": "octocat"},
            headers=internal_headers(),
        )
    assert res.status_code == 200
    assert res.json()["is_new"] is True

    result = await async_db.execute(select(GithubToken))
    token = result.scalar_one()
    assert token.access_token_encrypted != "gh-token-123"

    user_res = await async_db.execute(select(User).where(func.lower(User.email) == "gh@example.com"))
    user = user_res.scalar_one()
    got = await get_sync_token(async_db, user.id)
    assert got is not None
    assert got.token == "gh-token-123"
    assert got.oauth_app == "login"
    assert got.scopes == "read:user,user:email"


async def test_resolve_new_github_unverified_rejected(client, async_db):
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json = lambda: [{"email": "gh2@example.com", "primary": False, "verified": False}]
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("src.api.internal_auth.httpx.AsyncClient", return_value=mock_client):
        res = await client.post(
            "/internal/auth/resolve",
            json={"provider": "github", "provider_account_id": "43", "email": "gh2@example.com", "access_token": "tok"},
            headers=internal_headers(),
        )
    assert res.status_code == 409
    assert res.json()["detail"]["error"] == "email_not_verified"


# --- internal auth rejection ---

async def test_internal_no_token_rejected(client):
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "x", "email": "a@b.com", "email_verified": True},
    )
    assert res.status_code == 401


async def test_internal_user_jwt_rejected(client):
    token = jose_jwt.encode({"sub": "abc", "email": "a@b.com"}, settings.JWT_SECRET, algorithm="HS256")
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "x", "email": "a@b.com", "email_verified": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 401


async def test_internal_wrong_aud_rejected(client):
    token = jose_jwt.encode({"aud": "other"}, TEST_INTERNAL, algorithm="HS256")
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "x", "email": "a@b.com", "email_verified": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 401


# --- get_current_user by sub / fallback / no auto-create ---

async def test_get_current_user_by_sub(async_db):
    from fastapi import HTTPException
    from fastapi.security import HTTPAuthorizationCredentials

    from src.core.auth import get_current_user

    user = await _create_user(async_db, "sub@example.com", provider="google")
    token = jose_jwt.encode({"sub": str(user.id), "email": "sub@example.com"}, settings.JWT_SECRET, algorithm="HS256")
    got = await get_current_user(credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), db=async_db)
    assert got.id == user.id


async def test_get_current_user_no_sub_falls_back_to_email(async_db):
    from fastapi.security import HTTPAuthorizationCredentials

    from src.core.auth import get_current_user

    user = await _create_user(async_db, "fallback@example.com", provider="google")
    token = jose_jwt.encode({"email": "fallback@example.com"}, settings.JWT_SECRET, algorithm="HS256")
    got = await get_current_user(credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), db=async_db)
    assert got.id == user.id


async def test_unknown_user_not_auto_created(async_db):
    from fastapi import HTTPException
    from fastapi.security import HTTPAuthorizationCredentials

    from src.core.auth import get_current_user

    token = jose_jwt.encode({"sub": str(uuid.uuid4()), "email": "ghost@example.com"}, settings.JWT_SECRET, algorithm="HS256")
    with pytest.raises(HTTPException) as exc:
        await get_current_user(credentials=HTTPAuthorizationCredentials(scheme="Bearer", credentials=token), db=async_db)
    assert exc.value.status_code == 401
    result = await async_db.execute(select(User).where(User.email == "ghost@example.com"))
    assert result.scalar_one_or_none() is None


# --- finding 2: stuck users (same provider, no/different identity) ---

async def test_resolve_same_provider_no_identity_creates_identity(client, async_db):
    user = await _create_user(async_db, "no-ident@example.com", provider="google")
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "google-new1", "email": "no-ident@example.com", "email_verified": True},
        headers=internal_headers(),
    )
    assert res.status_code == 200
    assert res.json()["is_new"] is False
    result = await async_db.execute(
        select(UserIdentity).where(UserIdentity.user_id == user.id, UserIdentity.provider == "google")
    )
    ident = result.scalar_one()
    assert ident.provider_account_id == "google-new1" and ident.kind == "login"


async def test_resolve_same_provider_github_no_identity_creates_identity(client, async_db):
    user = await _create_user(async_db, "gh-noid@example.com", provider="github")
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "github", "provider_account_id": "gh-new1", "email": "gh-noid@example.com", "access_token": "tok"},
        headers=internal_headers(),
    )
    assert res.status_code == 200
    assert res.json()["is_new"] is False


async def test_resolve_same_provider_different_account_rejected(client, async_db):
    user = await _create_user(async_db, "diff-acct@example.com", provider="google")
    await _create_identity(async_db, user.id, "google", "google-old")
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "google-other", "email": "diff-acct@example.com", "email_verified": True},
        headers=internal_headers(),
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["error"] == "provider_mismatch"
    assert detail["provider"] == "google"
    assert detail["message"] == "This email is linked to a different Google account. Sign in with that account."


async def test_resolve_same_provider_different_github_account_rejected(client, async_db):
    user = await _create_user(async_db, "diff-gh@example.com", provider="github")
    await _create_identity(async_db, user.id, "github", "gh-old")
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "github", "provider_account_id": "gh-other", "email": "diff-gh@example.com", "access_token": "tok"},
        headers=internal_headers(),
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["error"] == "provider_mismatch"
    assert detail["message"] == "This email is linked to a different GitHub account. Sign in with that account."


# --- finding 4: GitHub email verified without primary ---

async def test_resolve_new_github_verified_non_primary_succeeds(client, async_db):
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json = lambda: [{"email": "np@example.com", "primary": False, "verified": True}]
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("src.api.internal_auth.httpx.AsyncClient", return_value=mock_client):
        res = await client.post(
            "/internal/auth/resolve",
            json={"provider": "github", "provider_account_id": "77", "email": "np@example.com", "access_token": "gh-tok"},
            headers=internal_headers(),
        )
    assert res.status_code == 200


# --- finding 5: credentials message ---

async def test_resolve_credentials_mismatch_message(client, async_db):
    user = User(
        email="cred@example.com",
        name="Cred",
        provider="credentials",
        hashed_password=hash_password("Password123!"),
    )
    async_db.add(user)
    await async_db.commit()
    res = await client.post(
        "/internal/auth/resolve",
        json={"provider": "google", "provider_account_id": "google-x", "email": "cred@example.com", "email_verified": True},
        headers=internal_headers(),
    )
    assert res.status_code == 409
    assert res.json()["detail"]["message"] == "This email is registered with an email and password. Sign in with your email and password."


# --- finding 6: scopes normalization ---

async def test_resolve_github_scopes_normalized(client, async_db):
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json = lambda: [{"email": "scopes@example.com", "primary": True, "verified": True}]
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("src.api.internal_auth.httpx.AsyncClient", return_value=mock_client):
        res = await client.post(
            "/internal/auth/resolve",
            json={
                "provider": "github",
                "provider_account_id": "88",
                "email": "scopes@example.com",
                "access_token": "gh-tok",
                "scopes": "read:user, user:email",
            },
            headers=internal_headers(),
        )
    assert res.status_code == 200
    result = await async_db.execute(select(GithubToken))
    token = result.scalar_one()
    assert token.scopes == "read:user,user:email"


# --- finding 7/8: SyncToken dataclass + missing encryption key ---

async def test_get_sync_token_returns_dataclass(client, async_db):
    from src.services.github_tokens import SyncToken

    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json = lambda: [{"email": "sync@example.com", "primary": True, "verified": True}]
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("src.api.internal_auth.httpx.AsyncClient", return_value=mock_client):
        res = await client.post(
            "/internal/auth/resolve",
            json={"provider": "github", "provider_account_id": "99", "email": "sync@example.com", "access_token": "gh-tok"},
            headers=internal_headers(),
        )
    assert res.status_code == 200
    user_res = await async_db.execute(select(User).where(func.lower(User.email) == "sync@example.com"))
    user = user_res.scalar_one()
    got = await get_sync_token(async_db, user.id)
    assert isinstance(got, SyncToken)
    assert got.token == "gh-tok"


async def test_resolve_github_without_encryption_key_still_succeeds(client, async_db, monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_TOKEN_KEY", "")
    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.json = lambda: [{"email": "nokey@example.com", "primary": True, "verified": True}]
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("src.api.internal_auth.httpx.AsyncClient", return_value=mock_client):
        res = await client.post(
            "/internal/auth/resolve",
            json={"provider": "github", "provider_account_id": "111", "email": "nokey@example.com", "access_token": "gh-tok"},
            headers=internal_headers(),
        )
    assert res.status_code == 200
    assert res.json()["ok"] is True
    result = await async_db.execute(select(User).where(func.lower(User.email) == "nokey@example.com"))
    assert result.scalar_one_or_none() is not None
    tokens_res = await async_db.execute(select(GithubToken))
    assert tokens_res.scalar_one_or_none() is None
