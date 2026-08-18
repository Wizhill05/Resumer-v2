import base64
import hashlib
import sqlite3
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))
from src.core.config import settings
from src.core.database import get_db
from src.core.oauth import create_oauth_access_token, hash_token, verify_pkce
from src.main import app
from src.models.oauth import OAuthAuthorizationCode, OAuthClient, OAuthRefreshToken
from src.models.user import Base, User


# In-memory SQLite async test database
TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [User.__table__, OAuthClient.__table__, OAuthAuthorizationCode.__table__, OAuthRefreshToken.__table__]
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
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── PKCE Unit Tests ──────────────────────────────────────────────────────────

def test_pkce_verification():
    code_verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")

    assert verify_pkce(code_verifier, code_challenge, "S256") is True
    assert verify_pkce("wrong_verifier", code_challenge, "S256") is False
    assert verify_pkce(code_verifier, "wrong_challenge", "S256") is False


# ── Discovery Endpoints ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_oauth_discovery_metadata(client: AsyncClient):
    res = await client.get("/.well-known/oauth-authorization-server")
    assert res.status_code == 200
    data = res.json()
    assert "authorization_endpoint" in data
    assert "token_endpoint" in data
    assert "registration_endpoint" in data
    assert "S256" in data["code_challenge_methods_supported"]
    assert "profile:read" in data["scopes_supported"]


@pytest.mark.asyncio
async def test_oauth_protected_resource_metadata(client: AsyncClient):
    res = await client.get("/.well-known/oauth-protected-resource")
    assert res.status_code == 200
    data = res.json()
    assert "resource" in data
    assert "authorization_servers" in data


@pytest.mark.asyncio
async def test_oauth_discovery_metadata_aliases(client: AsyncClient):
    headers = {"x-forwarded-proto": "https", "x-forwarded-host": "resumer-backend.aryansingh.space"}
    for path in [
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-authorization-server/mcp",
        "/mcp/.well-known/oauth-authorization-server",
        "/.well-known/openid-configuration",
        "/.well-known/openid-configuration/mcp",
        "/mcp/.well-known/openid-configuration",
    ]:
        res = await client.get(path, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["authorization_endpoint"] == "https://resumer-backend.aryansingh.space/oauth/authorize"
        assert data["token_endpoint"] == "https://resumer-backend.aryansingh.space/oauth/token"

    for path in [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
        "/mcp/.well-known/oauth-protected-resource",
    ]:
        res = await client.get(path, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["resource"] == "https://resumer-backend.aryansingh.space"
        assert data["authorization_servers"] == ["https://resumer-backend.aryansingh.space"]


@pytest.mark.asyncio
async def test_favicon_endpoint(client: AsyncClient):
    res = await client.get("/favicon.ico")
    assert res.status_code == 204

# ── Dynamic Client Registration (RFC 7591) ───────────────────────────────────

@pytest.mark.asyncio
async def test_dynamic_client_registration(client: AsyncClient):
    payload = {
        "client_name": "ChatGPT Resumer Connector",
        "redirect_uris": ["https://chatgpt.com/oauth/callback"],
        "grant_types": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_method": "none",
    }
    res = await client.post("/oauth/register", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["client_name"] == "ChatGPT Resumer Connector"
    assert data["client_id"].startswith("client_")
    assert "https://chatgpt.com/oauth/callback" in data["redirect_uris"]



@pytest.mark.asyncio
async def test_oauth_authorize_get_login_page(client: AsyncClient):
    res = await client.get("/oauth/authorize", params={
        "response_type": "code",
        "client_id": "chatgpt",
        "redirect_uri": "https://chatgpt.com/oauth/callback",
        "scope": "profile:read",
        "state": "state_123",
        "code_challenge": "dRl9_fTku4PZgEU78ZyIsNzVY2pCJHJds9aUGAajlz0",
        "code_challenge_method": "S256",
    }, follow_redirects=False)
    assert res.status_code == 302
    location = res.headers["location"]
    assert "/oauth/authorize" in location
    assert "client_id=chatgpt" in location
    assert "backend_url=" in location
# ── Full OAuth 2.1 PKCE Flow ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_oauth_pkce_flow(client: AsyncClient):
    # 1. Register client
    reg_res = await client.post("/oauth/register", json={
        "client_name": "Gemini Connected App",
        "redirect_uris": ["https://gemini.google.com/auth/callback"],
    })
    client_id = reg_res.json()["client_id"]

    # 2. Setup PKCE
    code_verifier = "a_very_secret_and_long_random_code_verifier_12345"
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")

    # 3. User Consent / Authorize POST
    auth_res = await client.post("/oauth/authorize", data={
        "client_id": client_id,
        "redirect_uri": "https://gemini.google.com/auth/callback",
        "scope": "profile:read profile:write resume:generate resume:edit",
        "state": "random_csrf_state_123",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "email": "candidate@example.com",
    }, follow_redirects=False)

    assert auth_res.status_code == 302
    location = auth_res.headers["location"]
    assert "https://gemini.google.com/auth/callback" in location
    assert "state=random_csrf_state_123" in location

    from urllib.parse import parse_qs, urlparse
    parsed = urlparse(location)
    auth_code = parse_qs(parsed.query)["code"][0]
    assert auth_code.startswith("code_")

    # 4. Exchange Auth Code with wrong verifier -> must fail
    fail_res = await client.post("/oauth/token", data={
        "grant_type": "authorization_code",
        "code": auth_code,
        "code_verifier": "wrong_verifier_should_fail",
        "client_id": client_id,
        "redirect_uri": "https://gemini.google.com/auth/callback",
    })
    assert fail_res.status_code == 400
    assert "PKCE verification failed" in fail_res.json()["detail"]

    # 5. Exchange Auth Code with correct verifier -> must succeed
    token_res = await client.post("/oauth/token", data={
        "grant_type": "authorization_code",
        "code": auth_code,
        "code_verifier": code_verifier,
        "client_id": client_id,
        "redirect_uri": "https://gemini.google.com/auth/callback",
    })
    assert token_res.status_code == 200
    token_data = token_res.json()
    assert "access_token" in token_data
    assert "refresh_token" in token_data
    access_token = token_data["access_token"]
    refresh_token = token_data["refresh_token"]

    # 6. Verify Userinfo with access token
    userinfo_res = await client.get(
        "/oauth/userinfo",
        headers={"Authorization": f"Bearer {access_token}"}
    )
    assert userinfo_res.status_code == 200
    u_data = userinfo_res.json()
    assert u_data["email"] == "candidate@example.com"

    # 7. Refresh Token Exchange (Rotation)
    refresh_res = await client.post("/oauth/token", data={
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    })
    assert refresh_res.status_code == 200
    refreshed_data = refresh_res.json()
    assert refreshed_data["access_token"] != access_token
    assert refreshed_data["refresh_token"] != refresh_token
    new_refresh_token = refreshed_data["refresh_token"]

    # 8. Token Replay Attack Detection: using old refresh token must be rejected and revoke token family!
    replay_res = await client.post("/oauth/token", data={
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    })
    assert replay_res.status_code == 400
    assert "Revoked refresh token presented" in replay_res.json()["detail"]

    # 9. And the new token should also now be revoked due to family invalidation
    replay_new_res = await client.post("/oauth/token", data={
        "grant_type": "refresh_token",
        "refresh_token": new_refresh_token,
        "client_id": client_id,
    })
    assert replay_new_res.status_code == 400

@pytest.mark.asyncio
async def test_token_exchange_json_payload(client: AsyncClient):
    reg_res = await client.post("/oauth/register", json={
        "client_name": "JSON Client App",
        "redirect_uris": ["https://chatgpt.com/oauth/callback"],
    })
    client_id = reg_res.json()["client_id"]

    code_verifier = "a_secret_verifier_with_json_payload_test_1234567"
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")

    auth_res = await client.post("/oauth/authorize", data={
        "client_id": client_id,
        "redirect_uri": "https://chatgpt.com/oauth/callback",
        "scope": "profile:read profile:write resume:generate",
        "state": "json_state",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "email": "json_user@example.com",
    }, follow_redirects=False)
    assert auth_res.status_code == 302

    from urllib.parse import parse_qs, urlparse
    parsed = urlparse(auth_res.headers["location"])
    auth_code = parse_qs(parsed.query)["code"][0]

    # Token exchange using Content-Type: application/json
    token_res = await client.post("/oauth/token", json={
        "grant_type": "authorization_code",
        "code": auth_code,
        "code_verifier": code_verifier,
        "redirect_uri": "https://chatgpt.com/oauth/callback",
        "client_id": client_id,
    })
    assert token_res.status_code == 200
    token_data = token_res.json()
    assert "access_token" in token_data
    assert "refresh_token" in token_data


@pytest.mark.asyncio
async def test_oauth_authorize_with_signed_token(client: AsyncClient, async_db: AsyncSession):
    from jose import jwt
    user = User(id=uuid.uuid4(), email="bridge_user@example.com", name="Bridge User")
    async_db.add(user)
    await async_db.commit()

    user_token = jwt.encode(
        {"email": "bridge_user@example.com", "name": "Bridge User"},
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )

    # GET /oauth/authorize with token query param
    res = await client.get("/oauth/authorize", params={
        "response_type": "code",
        "client_id": "chatgpt",
        "redirect_uri": "https://chatgpt.com/oauth/callback",
        "scope": "profile:read profile:write resume:generate resume:edit",
        "state": "state_signed",
        "code_challenge": "dRl9_fTku4PZgEU78ZyIsNzVY2pCJHJds9aUGAajlz0",
        "code_challenge_method": "S256",
        "token": user_token,
    })
    assert res.status_code == 200
    assert "Authorize Chatgpt Connector" in res.text
    assert "Bridge User" in res.text
    assert "auth_token" in res.headers.get("set-cookie", "")

    # POST /oauth/authorize with token
    post_res = await client.post("/oauth/authorize", data={
        "client_id": "chatgpt",
        "redirect_uri": "https://chatgpt.com/oauth/callback",
        "scope": "profile:read profile:write resume:generate resume:edit",
        "state": "state_signed",
        "code_challenge": "dRl9_fTku4PZgEU78ZyIsNzVY2pCJHJds9aUGAajlz0",
        "code_challenge_method": "S256",
        "token": user_token,
    }, follow_redirects=False)
    assert post_res.status_code == 302
    assert "https://chatgpt.com/oauth/callback" in post_res.headers["location"]
    assert "code=" in post_res.headers["location"]
