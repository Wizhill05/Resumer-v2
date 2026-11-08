import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))

from src.api import integrations_github
from src.core.config import settings
from src.core.database import get_db
from src.core.token_crypto import decrypt_token, encrypt_token
from src.main import app
from src.models.identity import GithubLinkState, GithubToken, UserIdentity
from src.models.user import Base, User

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
TEST_FERNET = Fernet.generate_key().decode()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_TOKEN_KEY", TEST_FERNET)
    monkeypatch.setattr(settings, "GITHUB_CONNECT_CLIENT_ID", "connect-client-id")
    monkeypatch.setattr(settings, "GITHUB_CONNECT_CLIENT_SECRET", "connect-secret")
    monkeypatch.setattr(settings, "GITHUB_CONNECT_REDIRECT_URI", "https://resumer.buzz/api/integrations/github/callback")


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [User.__table__, UserIdentity.__table__, GithubToken.__table__, GithubLinkState.__table__]
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


def _auth_headers(user) -> dict:
    token = jose_jwt.encode({"sub": str(user.id), "email": user.email}, settings.JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


async def _create_user(async_db, email, provider="google"):
    user = User(email=email, name="Test", provider=provider, email_verified_at=datetime.now(timezone.utc), signup_completed_at=datetime.now(timezone.utc))
    async_db.add(user)
    await async_db.commit()
    await async_db.refresh(user)
    return user


async def _create_identity(async_db, user_id, account_id="123", kind="link", login="octocat"):
    ident = UserIdentity(user_id=user_id, provider="github", provider_account_id=account_id, kind=kind, provider_login=login)
    async_db.add(ident)
    await async_db.commit()
    await async_db.refresh(ident)
    return ident


async def _create_token(async_db, identity_id, oauth_app, scopes="read:user", status_="active"):
    token = GithubToken(
        identity_id=identity_id,
        oauth_app=oauth_app,
        access_token_encrypted=encrypt_token(f"tok-{oauth_app}"),
        scopes=scopes,
        status=status_,
    )
    async_db.add(token)
    await async_db.commit()
    await async_db.refresh(token)
    return token


def _patch_github(monkeypatch, gh_id=123, gh_login="octocat", scope="read:user", access_token="gh-access-token"):
    revoked = []

    async def fake_exchange(code, code_verifier):
        return {"access_token": access_token, "scope": scope}

    async def fake_fetch(token):
        return {"id": gh_id, "login": gh_login}

    async def fake_revoke(token):
        revoked.append(token)

    monkeypatch.setattr(integrations_github, "exchange_code_for_token", fake_exchange)
    monkeypatch.setattr(integrations_github, "fetch_github_user", fake_fetch)
    monkeypatch.setattr(integrations_github, "revoke_github_grant", fake_revoke)
    return revoked


async def _start_state(client, user, private=False):
    res = await client.post("/integrations/github/link/start", json={"private": private}, headers=_auth_headers(user))
    assert res.status_code == 200
    return res.json()


# --- status endpoint ---

async def test_status_not_connected(client, async_db):
    user = await _create_user(async_db, "alice@example.com")
    res = await client.get("/integrations/github", headers=_auth_headers(user))
    assert res.status_code == 200
    data = res.json()
    assert data["connected"] is False
    assert data["login"] is None
    assert data["kind"] is None
    assert data["private_access"] is False
    assert data["status"] is None
    assert data["can_disconnect"] is False


async def test_status_login(client, async_db):
    user = await _create_user(async_db, "bob@example.com", provider="github")
    ident = await _create_identity(async_db, user.id, kind="login")
    await _create_token(async_db, ident.id, "login")
    res = await client.get("/integrations/github", headers=_auth_headers(user))
    data = res.json()
    assert data["connected"] is True
    assert data["kind"] == "login"
    assert data["login"] == "octocat"
    assert data["private_access"] is False
    assert data["status"] == "active"
    assert data["can_disconnect"] is False


async def test_status_link_private(client, async_db):
    user = await _create_user(async_db, "carol@example.com")
    ident = await _create_identity(async_db, user.id, kind="link")
    await _create_token(async_db, ident.id, "connect", scopes="read:user,repo")
    res = await client.get("/integrations/github", headers=_auth_headers(user))
    data = res.json()
    assert data["connected"] is True
    assert data["kind"] == "link"
    assert data["private_access"] is True
    assert data["status"] == "active"
    assert data["can_disconnect"] is True


async def test_status_needs_reauth(client, async_db):
    user = await _create_user(async_db, "dave@example.com")
    ident = await _create_identity(async_db, user.id, kind="link")
    await _create_token(async_db, ident.id, "connect", status_="needs_reauth")
    res = await client.get("/integrations/github", headers=_auth_headers(user))
    data = res.json()
    assert data["connected"] is True
    assert data["status"] == "needs_reauth"
    # needs_reauth token does not count as active private access
    assert data["private_access"] is False


async def test_status_connect_needs_reauth_login_active(client, async_db):
    user = await _create_user(async_db, "olivia@example.com", provider="github")
    ident = await _create_identity(async_db, user.id, kind="login")
    await _create_token(async_db, ident.id, "connect", scopes="read:user,repo", status_="needs_reauth")
    await _create_token(async_db, ident.id, "login", status_="active")
    res = await client.get("/integrations/github", headers=_auth_headers(user))
    data = res.json()
    assert data["connected"] is True
    assert data["status"] == "active"
    assert data["private_access"] is False


async def test_status_all_tokens_needs_reauth(client, async_db):
    user = await _create_user(async_db, "paula@example.com", provider="github")
    ident = await _create_identity(async_db, user.id, kind="login")
    await _create_token(async_db, ident.id, "connect", status_="needs_reauth")
    await _create_token(async_db, ident.id, "login", status_="needs_reauth")
    res = await client.get("/integrations/github", headers=_auth_headers(user))
    data = res.json()
    assert data["connected"] is True
    assert data["status"] == "needs_reauth"
    assert data["private_access"] is False


# --- start ---

async def test_start_creates_hashed_state_and_authorize_url(client, async_db):
    import hashlib

    user = await _create_user(async_db, "erin@example.com")
    data = await _start_state(client, user, private=False)
    state = data["state"]
    authorize_url = data["authorize_url"]

    result = await async_db.execute(select(GithubLinkState))
    row = result.scalar_one()
    assert row.state_hash == hashlib.sha256(state.encode()).hexdigest()
    assert 43 <= len(row.code_verifier) <= 128
    assert row.want_private is False

    parsed = urlparse(authorize_url)
    assert parsed.hostname == "github.com"
    qs = parse_qs(parsed.query)
    assert qs["client_id"] == ["connect-client-id"]
    assert qs["redirect_uri"] == ["https://resumer.buzz/api/integrations/github/callback"]
    assert qs["scope"] == ["read:user"]
    assert qs["state"] == [state]
    assert qs["code_challenge_method"] == ["S256"]
    assert qs["allow_signup"] == ["false"]

    import base64

    expected = base64.urlsafe_b64encode(hashlib.sha256(row.code_verifier.encode()).digest()).decode().rstrip("=")
    assert qs["code_challenge"] == [expected]


async def test_start_private_scope(client, async_db):
    user = await _create_user(async_db, "frank@example.com")
    data = await _start_state(client, user, private=True)
    qs = parse_qs(urlparse(data["authorize_url"]).query)
    assert qs["scope"] == ["read:user repo"]
    result = await async_db.execute(select(GithubLinkState))
    assert result.scalar_one().want_private is True


# --- complete ---

async def test_complete_happy_path_google_user(client, async_db, monkeypatch):
    _patch_github(monkeypatch, scope="read:user")
    user = await _create_user(async_db, "gina@example.com", provider="google")
    start = await _start_state(client, user)

    res = await client.post(
        "/integrations/github/link/complete",
        json={"code": "abc", "state": start["state"]},
        headers=_auth_headers(user),
    )
    assert res.status_code == 200
    assert res.json() == {"ok": True}

    result = await async_db.execute(select(UserIdentity))
    ident = result.scalar_one()
    assert ident.provider == "github"
    assert ident.provider_account_id == "123"
    assert ident.kind == "link"
    assert ident.provider_login == "octocat"
    assert ident.email_at_link is None

    result = await async_db.execute(select(GithubToken))
    token = result.scalar_one()
    assert token.oauth_app == "connect"
    assert token.status == "active"
    assert decrypt_token(token.access_token_encrypted) == "gh-access-token"
    assert token.access_token_encrypted != "gh-access-token"


async def test_complete_state_from_other_user_forbidden(client, async_db, monkeypatch):
    _patch_github(monkeypatch)
    user_a = await _create_user(async_db, "henry@example.com")
    user_b = await _create_user(async_db, "ivy@example.com")
    start = await _start_state(client, user_a)

    res = await client.post(
        "/integrations/github/link/complete",
        json={"code": "abc", "state": start["state"]},
        headers=_auth_headers(user_b),
    )
    assert res.status_code == 403
    assert res.json()["detail"] == "failed"


async def test_complete_expired_state(client, async_db, monkeypatch):
    _patch_github(monkeypatch)
    user = await _create_user(async_db, "jack@example.com")
    start = await _start_state(client, user)
    result = await async_db.execute(select(GithubLinkState))
    row = result.scalar_one()
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await async_db.commit()

    res = await client.post(
        "/integrations/github/link/complete",
        json={"code": "abc", "state": start["state"]},
        headers=_auth_headers(user),
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "expired"


async def test_complete_reused_state(client, async_db, monkeypatch):
    _patch_github(monkeypatch)
    user = await _create_user(async_db, "kate@example.com")
    start = await _start_state(client, user)

    first = await client.post(
        "/integrations/github/link/complete",
        json={"code": "abc", "state": start["state"]},
        headers=_auth_headers(user),
    )
    assert first.status_code == 200

    second = await client.post(
        "/integrations/github/link/complete",
        json={"code": "abc", "state": start["state"]},
        headers=_auth_headers(user),
    )
    assert second.status_code == 400
    assert second.json()["detail"] == "expired"


async def test_complete_already_linked(client, async_db, monkeypatch):
    _patch_github(monkeypatch, gh_id=999, gh_login="other")
    owner = await _create_user(async_db, "leo@example.com")
    await _create_identity(async_db, owner.id, account_id="999", kind="link", login="other")
    user = await _create_user(async_db, "mia@example.com")
    start = await _start_state(client, user)

    res = await client.post(
        "/integrations/github/link/complete",
        json={"code": "abc", "state": start["state"]},
        headers=_auth_headers(user),
    )
    assert res.status_code == 409
    assert res.json()["detail"] == "already_linked"
    result = await async_db.execute(select(GithubToken))
    assert result.scalars().all() == []


async def test_complete_github_login_user_different_account(client, async_db, monkeypatch):
    _patch_github(monkeypatch, gh_id=456, gh_login="someone-else")
    user = await _create_user(async_db, "nina@example.com", provider="github")
    await _create_identity(async_db, user.id, account_id="123", kind="login")
    start = await _start_state(client, user)

    res = await client.post(
        "/integrations/github/link/complete",
        json={"code": "abc", "state": start["state"]},
        headers=_auth_headers(user),
    )
    assert res.status_code == 409
    assert res.json()["detail"] == "different_account"


async def test_complete_legacy_null_account_sign_in_again(client, async_db, monkeypatch):
    _patch_github(monkeypatch, gh_id=123, gh_login="octocat", scope="read:user,repo")
    user = await _create_user(async_db, "oliver@example.com", provider="github")
    ident = await _create_identity(async_db, user.id, account_id=None, kind="login")
    await _create_token(async_db, ident.id, "login")
    start = await _start_state(client, user)

    res = await client.post(
        "/integrations/github/link/complete",
        json={"code": "abc", "state": start["state"]},
        headers=_auth_headers(user),
    )
    assert res.status_code == 409
    assert res.json()["detail"] == "sign_in_again"
    await async_db.refresh(ident)
    assert ident.provider_account_id is None
    result = await async_db.execute(select(GithubToken).where(GithubToken.oauth_app == "connect"))
    assert result.scalars().all() == []


# --- disconnect / private ---

async def test_disconnect_link_deletes_identity_and_revokes(client, async_db, monkeypatch):
    revoked = _patch_github(monkeypatch)
    user = await _create_user(async_db, "pam@example.com")
    ident = await _create_identity(async_db, user.id, kind="link")
    await _create_token(async_db, ident.id, "connect")

    res = await client.delete("/integrations/github", headers=_auth_headers(user))
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    assert revoked == ["tok-connect"]

    result = await async_db.execute(select(UserIdentity))
    assert result.scalars().all() == []
    result = await async_db.execute(select(GithubToken))
    assert result.scalars().all() == []


async def test_disconnect_login_rejected(client, async_db, monkeypatch):
    _patch_github(monkeypatch)
    user = await _create_user(async_db, "quinn@example.com", provider="github")
    ident = await _create_identity(async_db, user.id, kind="login")
    await _create_token(async_db, ident.id, "login")

    res = await client.delete("/integrations/github", headers=_auth_headers(user))
    assert res.status_code == 400
    result = await async_db.execute(select(UserIdentity))
    assert len(result.scalars().all()) == 1


async def test_remove_private_login_keeps_login_token(client, async_db, monkeypatch):
    revoked = _patch_github(monkeypatch)
    user = await _create_user(async_db, "rosa@example.com", provider="github")
    ident = await _create_identity(async_db, user.id, kind="login")
    await _create_token(async_db, ident.id, "login")
    await _create_token(async_db, ident.id, "connect", scopes="read:user,repo")

    res = await client.delete("/integrations/github/private", headers=_auth_headers(user))
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["reconnect_required"] is False
    assert revoked == ["tok-connect"]

    result = await async_db.execute(select(GithubToken))
    remaining = result.scalars().all()
    assert len(remaining) == 1
    assert remaining[0].oauth_app == "login"
    result = await async_db.execute(select(UserIdentity))
    assert len(result.scalars().all()) == 1


async def test_remove_private_link_disconnects_all(client, async_db, monkeypatch):
    revoked = _patch_github(monkeypatch)
    user = await _create_user(async_db, "sam@example.com")
    ident = await _create_identity(async_db, user.id, kind="link")
    await _create_token(async_db, ident.id, "connect", scopes="read:user,repo")

    res = await client.delete("/integrations/github/private", headers=_auth_headers(user))
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["reconnect_required"] is True
    assert revoked == ["tok-connect"]

    result = await async_db.execute(select(UserIdentity))
    assert result.scalars().all() == []
    result = await async_db.execute(select(GithubToken))
    assert result.scalars().all() == []


async def test_remove_private_no_identity_rejected(client, async_db, monkeypatch):
    _patch_github(monkeypatch)
    user = await _create_user(async_db, "tina@example.com")
    res = await client.delete("/integrations/github/private", headers=_auth_headers(user))
    assert res.status_code == 400
