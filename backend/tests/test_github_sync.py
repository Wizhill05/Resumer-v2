import base64
import json
import sqlite3
import uuid
from datetime import datetime, timezone

import httpx
import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.types import ARRAY
from sqlalchemy.dialects.postgresql import JSONB

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))
sqlite3.register_adapter(list, json.dumps)


@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "JSON"


@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"


from src.core.config import settings
from src.core.database import get_db
from src.main import app
from src.models.identity import GithubToken, UserIdentity
from src.models.profile import Profile, UserEducation, UserExperience, UserExtracurricular, UserProject
from src.models.user import Base, User
from src.schemas.profile import GitHubProjectDraft
from src.services import github_client
from src.services.github_tokens import upsert_github_token

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
TEST_FERNET = Fernet.generate_key().decode()

ALL_TABLES = [
    User.__table__,
    UserIdentity.__table__,
    GithubToken.__table__,
    Profile.__table__,
    UserProject.__table__,
    UserExperience.__table__,
    UserEducation.__table__,
    UserExtracurricular.__table__,
]


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(settings, "GITHUB_TOKEN_KEY", TEST_FERNET)
    github_client.clear_cache()


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, tables=ALL_TABLES))
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.drop_all(sync_conn, tables=ALL_TABLES))
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


def auth_headers(user) -> dict:
    token = jose_jwt.encode({"sub": str(user.id), "email": user.email}, settings.JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


async def _create_user(async_db, email, provider="google"):
    user = User(
        email=email,
        name="Test",
        provider=provider,
        email_verified_at=datetime.now(timezone.utc),
        signup_completed_at=datetime.now(timezone.utc),
    )
    async_db.add(user)
    await async_db.commit()
    await async_db.refresh(user)
    return user


async def _create_github_identity(async_db, user_id, login="octocat", account_id="42"):
    ident = UserIdentity(
        user_id=user_id,
        provider="github",
        provider_account_id=account_id,
        kind="login",
        provider_login=login,
    )
    async_db.add(ident)
    await async_db.commit()
    await async_db.refresh(ident)
    return ident


def _mock_github(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    real_cls = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = transport
        return real_cls(*args, **kwargs)

    monkeypatch.setattr(github_client.httpx, "AsyncClient", factory)


def _repos_payload():
    return [
        {"name": "alpha", "full_name": "octocat/alpha", "description": None, "html_url": "https://github.com/octocat/alpha", "language": "Python", "stargazers_count": 3, "updated_at": "2026-01-01T00:00:00Z", "private": True},
        {"name": "forky", "full_name": "octocat/forky", "description": "fork", "html_url": "https://github.com/octocat/forky", "language": None, "stargazers_count": 0, "updated_at": "2026-01-01T00:00:00Z", "fork": True, "private": False},
    ]


async def test_token_mode_ignores_username_and_sends_bearer(client, async_db, monkeypatch):
    user = await _create_user(async_db, "tok@example.com", provider="github")
    ident = await _create_github_identity(async_db, user.id, login="octocat")
    await upsert_github_token(async_db, ident.id, "login", "secret-token", "read:user,user:email")
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json=_repos_payload(), headers={"X-RateLimit-Remaining": "4999"})

    _mock_github(monkeypatch, handler)
    res = await client.get("/profile/import/github-repos?username=someone-else", headers=auth_headers(user))
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["source"] == "token"
    assert data["connected"] is True
    assert data["github_username"] == "octocat"
    assert "/user/repos" in seen["url"]
    assert "someone-else" not in seen["url"]
    assert "users/someone-else" not in seen["url"]
    assert seen["auth"] == "Bearer secret-token"
    assert len(data["repos"]) == 1


async def _setup_token_user(async_db, email, scopes):
    user = await _create_user(async_db, email, provider="github")
    ident = await _create_github_identity(async_db, user.id, account_id=email)
    await upsert_github_token(async_db, ident.id, "connect", "tok", scopes)
    return user


async def test_visibility_all_when_repo_scope(client, async_db, monkeypatch):
    user = await _setup_token_user(async_db, "vis-all@example.com", "read:user,repo")
    seen_params = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_params.update(dict(request.url.params))
        return httpx.Response(200, json=[])

    _mock_github(monkeypatch, handler)
    res = await client.get("/profile/import/github-repos", headers=auth_headers(user))
    assert res.status_code == 200, res.text
    assert seen_params.get("visibility") == "all"


async def test_visibility_public_without_repo_scope(client, async_db, monkeypatch):
    user = await _setup_token_user(async_db, "vis-public@example.com", "read:user,user:email")
    seen_params = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen_params.update(dict(request.url.params))
        return httpx.Response(200, json=[])

    _mock_github(monkeypatch, handler)
    res = await client.get("/profile/import/github-repos", headers=auth_headers(user))
    assert res.status_code == 200, res.text
    assert seen_params.get("visibility") == "public"


async def test_public_mode_without_username_returns_empty(client, async_db):
    user = await _create_user(async_db, "plain@example.com")
    res = await client.get("/profile/import/github-repos", headers=auth_headers(user))
    assert res.status_code == 200
    assert res.json() == {"repos": [], "connected": False, "github_username": None, "source": "public"}


async def test_invalid_username_400(client, async_db):
    user = await _create_user(async_db, "plain2@example.com")
    res = await client.get("/profile/import/github-repos?username=bad--name", headers=auth_headers(user))
    assert res.status_code == 400
    res = await client.get("/profile/import/github-repos?username=" + "a" * 40, headers=auth_headers(user))
    assert res.status_code == 400


async def test_401_marks_needs_reauth_and_returns_409(client, async_db, monkeypatch):
    user = await _create_user(async_db, "auth@example.com", provider="github")
    ident = await _create_github_identity(async_db, user.id)
    token = await upsert_github_token(async_db, ident.id, "login", "bad-token", "read:user")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Bad credentials"})

    _mock_github(monkeypatch, handler)
    res = await client.get("/profile/import/github-repos", headers=auth_headers(user))
    assert res.status_code == 409
    assert res.json() == {"detail": "Reconnect GitHub"}
    result = await async_db.execute(select(GithubToken).where(GithubToken.id == token.id))
    assert result.scalar_one().status == "needs_reauth"


async def test_rate_limit_returns_429_with_reset_at(client, async_db, monkeypatch):
    user = await _create_user(async_db, "plain3@example.com")
    reset_epoch = str(int(datetime(2026, 11, 8, 15, 30, tzinfo=timezone.utc).timestamp()))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"message": "API rate limit exceeded"},
            headers={"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": reset_epoch},
        )

    _mock_github(monkeypatch, handler)
    res = await client.get("/profile/import/github-repos?username=octocat", headers=auth_headers(user))
    assert res.status_code == 429
    body = res.json()
    assert body["detail"] == "GitHub's shared limit is used up. Connect GitHub to keep importing."
    assert body["reset_at"] == datetime(2026, 11, 8, 15, 30, tzinfo=timezone.utc).isoformat()


async def test_forks_excluded_and_private_flag_passed_through(client, async_db, monkeypatch):
    user = await _create_user(async_db, "plain4@example.com")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_repos_payload())

    _mock_github(monkeypatch, handler)
    res = await client.get("/profile/import/github-repos?username=octocat", headers=auth_headers(user))
    assert res.status_code == 200
    repos = res.json()["repos"]
    assert len(repos) == 1
    assert repos[0]["private"] is True
    assert repos[0]["full_name"] == "octocat/alpha"


async def test_unauthenticated_cache_hit_avoids_second_request(client, async_db, monkeypatch):
    user = await _create_user(async_db, "plain5@example.com")
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(200, json=[])

    _mock_github(monkeypatch, handler)
    first = await client.get("/profile/import/github-repos?username=octocat", headers=auth_headers(user))
    second = await client.get("/profile/import/github-repos?username=octocat", headers=auth_headers(user))
    assert first.status_code == 200
    assert second.status_code == 200
    assert calls["count"] == 1


def test_client_has_no_non_get_method():
    for name in ("github_post", "github_put", "github_patch", "github_delete", "post", "put", "patch", "delete", "request"):
        assert not hasattr(github_client, name), name
    source = github_client.__file__
    import pathlib

    text = pathlib.Path(source).read_text()
    for token in (".post(", ".put(", ".patch(", ".delete(", ".request("):
        assert token not in text, token
    assert hasattr(github_client, "github_get")


async def test_project_import_uses_token_and_leaves_link_off_private_repo(client, async_db, monkeypatch):
    import src.services.github_import as github_import

    user = await _create_user(async_db, "priv@example.com", provider="github")
    ident = await _create_github_identity(async_db, user.id)
    await upsert_github_token(async_db, ident.id, "login", "secret-token", "read:user")
    seen_auths = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_auths.append(request.headers.get("authorization"))
        path = request.url.path
        if path.endswith("/languages"):
            return httpx.Response(200, json={"Python": 100})
        if path.endswith("/contents"):
            return httpx.Response(200, json=[])
        if path.endswith("/readme"):
            return httpx.Response(404, json={"message": "Not Found"})
        return httpx.Response(200, json={"private": True, "html_url": "https://github.com/octocat/secret"})

    _mock_github(monkeypatch, handler)

    async def fake_invoke(fn, payload, role, node_name):
        return GitHubProjectDraft(
            name="Secret App",
            description="desc",
            technologies=["Python"],
            github_url="https://github.com/octocat/secret",
        )

    monkeypatch.setattr(github_import, "invoke_with_fallback", fake_invoke)
    res = await client.post("/profile/import/github-project", json={"url": "octocat/secret"}, headers=auth_headers(user))
    assert res.status_code == 200, res.text
    data = res.json()
    assert seen_auths
    assert all(auth == "Bearer secret-token" for auth in seen_auths)
    assert data["github_url"] is None
    messages = [w["message"] if isinstance(w, dict) else w for w in data["warnings"]]
    assert "Private repo, link left off. Add a public link if you have one." in messages


async def test_repos_network_timeout_returns_502(client, async_db, monkeypatch):
    user = await _create_user(async_db, "timeout-repos@example.com")

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    _mock_github(monkeypatch, handler)
    res = await client.get("/profile/import/github-repos?username=octocat", headers=auth_headers(user))
    assert res.status_code == 502, res.text
    assert res.json() == {"detail": "Couldn't reach GitHub. Try again."}


async def test_project_import_network_timeout_returns_502(client, async_db, monkeypatch):
    user = await _create_user(async_db, "timeout-project@example.com")

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    _mock_github(monkeypatch, handler)
    res = await client.post("/profile/import/github-project", json={"url": "octocat/secret"}, headers=auth_headers(user))
    assert res.status_code == 502, res.text
    assert res.json() == {"detail": "Couldn't reach GitHub. Try again."}


async def test_project_import_rate_limit_returns_429_shape(client, async_db, monkeypatch):
    user = await _create_user(async_db, "priv2@example.com")
    reset_epoch = str(int(datetime(2026, 11, 8, 16, 0, tzinfo=timezone.utc).timestamp()))

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"message": "API rate limit exceeded"},
            headers={"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": reset_epoch},
        )

    _mock_github(monkeypatch, handler)
    res = await client.post("/profile/import/github-project", json={"url": "octocat/secret"}, headers=auth_headers(user))
    assert res.status_code == 429, res.text
    body = res.json()
    assert body["detail"] == "GitHub's shared limit is used up. Connect GitHub to keep importing."
    assert "reset_at" in body
