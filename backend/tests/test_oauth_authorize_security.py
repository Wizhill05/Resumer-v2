"""Regression tests for the /oauth/authorize account-takeover bug.

Previously an anonymous POST with only ``email=victim@...`` (or ``user_id=``) minted an
auth code for that account and redirected it to an attacker-chosen redirect_uri.
"""
import base64
import hashlib
import sqlite3
import uuid
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))
from src.api.oauth import ALLOWED_CONNECTOR_REDIRECT_URIS
from src.core.config import settings
from src.core.database import get_db
from src.main import app
from src.models.oauth import OAuthAuthorizationCode, OAuthClient, OAuthRefreshToken
from src.models.user import Base, User

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
EVIL = "https://evil.example/cb"
GOOD = "https://chatgpt.com/oauth/callback"
VERIFIER = "a_long_enough_code_verifier_for_security_tests_123"
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip("=")


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [User.__table__, OAuthClient.__table__, OAuthAuthorizationCode.__table__, OAuthRefreshToken.__table__]
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tables))
    async with sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


@pytest.fixture
async def client(async_db: AsyncSession):
    async def override_get_db():
        yield async_db

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


async def _count(db: AsyncSession, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _make_user(db: AsyncSession, email: str = "victim@example.com") -> User:
    user = User(id=uuid.uuid4(), email=email, name="Victim")
    db.add(user)
    await db.commit()
    return user


async def _make_client(db: AsyncSession, redirect_uris: list[str]) -> str:
    client_id = f"client_{uuid.uuid4().hex[:8]}"
    db.add(OAuthClient(client_id=client_id, client_name="Test App", redirect_uris=redirect_uris))
    await db.commit()
    return client_id


def _form(client_id: str, redirect_uri: str, **extra) -> dict:
    return {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": "s",
        "scope": "profile:read",
        "code_challenge": CHALLENGE,
        "code_challenge_method": "S256",
        **extra,
    }


def _get_params(client_id: str, redirect_uri: str, **extra) -> dict:
    return {"response_type": "code", **_form(client_id, redirect_uri, **extra)}


def _signed(email: str) -> str:
    return jwt.encode({"email": email}, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


# ── The takeover itself ──────────────────────────────────────────────────────

async def test_anonymous_post_with_email_only_is_rejected(client: AsyncClient, async_db: AsyncSession):
    await _make_user(async_db)
    users_before = await _count(async_db, User)

    res = await client.post(
        "/oauth/authorize",
        data=_form("attacker", EVIL, email="victim@example.com"),
        follow_redirects=False,
    )
    assert res.status_code == 400  # evil.example is not allowlisted for an unknown client
    assert "location" not in res.headers

    # Even with an allowlisted redirect the email alone must not authenticate.
    res = await client.post(
        "/oauth/authorize",
        data=_form("attacker", GOOD, email="victim@example.com"),
        follow_redirects=False,
    )
    assert res.status_code == 401
    assert "location" not in res.headers
    assert await _count(async_db, OAuthAuthorizationCode) == 0
    assert await _count(async_db, User) == users_before


async def test_anonymous_post_with_unknown_email_does_not_create_user(client: AsyncClient, async_db: AsyncSession):
    res = await client.post(
        "/oauth/authorize",
        data=_form("chatgpt", GOOD, email="nobody@example.com"),
        follow_redirects=False,
    )
    assert res.status_code == 401
    assert await _count(async_db, User) == 0
    assert await _count(async_db, OAuthAuthorizationCode) == 0


async def test_anonymous_post_with_user_id_only_is_rejected(client: AsyncClient, async_db: AsyncSession):
    victim = await _make_user(async_db)
    client_id = await _make_client(async_db, [EVIL])

    res = await client.post(
        "/oauth/authorize",
        data=_form(client_id, EVIL, user_id=str(victim.id)),
        follow_redirects=False,
    )
    assert res.status_code == 401
    assert "location" not in res.headers
    assert await _count(async_db, OAuthAuthorizationCode) == 0


async def test_forged_token_is_rejected(client: AsyncClient, async_db: AsyncSession):
    await _make_user(async_db)
    forged = jwt.encode({"email": "victim@example.com"}, "not-the-secret", algorithm=settings.JWT_ALGORITHM)
    res = await client.post("/oauth/authorize", data=_form("chatgpt", GOOD, token=forged), follow_redirects=False)
    assert res.status_code == 401
    assert await _count(async_db, OAuthAuthorizationCode) == 0


async def test_consent_page_has_no_user_id_field(client: AsyncClient, async_db: AsyncSession):
    await _make_user(async_db)
    res = await client.get("/oauth/authorize", params=_get_params("chatgpt", GOOD, token=_signed("victim@example.com")))
    assert res.status_code == 200
    assert 'name="user_id"' not in res.text


async def test_consent_page_escapes_user_controlled_values(client: AsyncClient, async_db: AsyncSession):
    await _make_user(async_db)
    cid = await _make_client(async_db, [GOOD])
    res = await client.get(
        "/oauth/authorize",
        params=_get_params(cid, GOOD, state='"><script>alert(1)</script>', token=_signed("victim@example.com")),
    )
    assert res.status_code == 200
    assert "<script>alert(1)</script>" not in res.text


# ── Legitimate flow still works ──────────────────────────────────────────────

async def test_signed_token_with_registered_redirect_succeeds(client: AsyncClient, async_db: AsyncSession):
    user = await _make_user(async_db)
    client_id = await _make_client(async_db, ["https://app.example/cb"])

    res = await client.post(
        "/oauth/authorize",
        data=_form(client_id, "https://app.example/cb", token=_signed(user.email)),
        follow_redirects=False,
    )
    assert res.status_code == 302
    loc = urlparse(res.headers["location"])
    assert f"{loc.scheme}://{loc.netloc}{loc.path}" == "https://app.example/cb"
    assert parse_qs(loc.query)["code"][0].startswith("code_")
    assert parse_qs(loc.query)["state"] == ["s"]
    assert await _count(async_db, OAuthAuthorizationCode) == 1


# ── redirect_uri validation ──────────────────────────────────────────────────

async def test_existing_client_unregistered_redirect_rejected_on_get_and_post(client: AsyncClient, async_db: AsyncSession):
    user = await _make_user(async_db)
    client_id = await _make_client(async_db, ["https://app.example/cb"])
    token = _signed(user.email)

    get_res = await client.get(
        "/oauth/authorize", params=_get_params(client_id, EVIL, token=token), follow_redirects=False
    )
    assert get_res.status_code == 400
    assert "location" not in get_res.headers

    post_res = await client.post(
        "/oauth/authorize", data=_form(client_id, EVIL, token=token), follow_redirects=False
    )
    assert post_res.status_code == 400
    assert "location" not in post_res.headers
    assert await _count(async_db, OAuthAuthorizationCode) == 0


@pytest.mark.parametrize(
    "evil_uri",
    [
        "https://evil.example/?next=chatgpt.com",
        "https://chatgpt.com.evil.example/oauth/callback",
        "http://localhost:9999/cb",
        "https://chatgpt.com/oauth/callback/../evil",
    ],
)
async def test_substring_and_localhost_redirects_not_accepted(client: AsyncClient, async_db: AsyncSession, evil_uri: str):
    user = await _make_user(async_db)
    # existing client with an allowlisted URI must not be extended with lookalikes
    client_id = await _make_client(async_db, [GOOD])
    res = await client.post(
        "/oauth/authorize", data=_form(client_id, evil_uri, token=_signed(user.email)), follow_redirects=False
    )
    assert res.status_code == 400
    # nor may a brand-new client_id use them
    res = await client.post(
        "/oauth/authorize", data=_form("fresh", evil_uri, token=_signed(user.email)), follow_redirects=False
    )
    assert res.status_code == 400
    assert await _count(async_db, OAuthAuthorizationCode) == 0
    assert await _count(async_db, OAuthClient) == 1


async def test_unknown_client_non_allowlisted_redirect_rejected(client: AsyncClient, async_db: AsyncSession):
    user = await _make_user(async_db)
    token = _signed(user.email)

    get_res = await client.get("/oauth/authorize", params=_get_params("attacker", EVIL, token=token), follow_redirects=False)
    assert get_res.status_code == 400
    post_res = await client.post("/oauth/authorize", data=_form("attacker", EVIL, token=token), follow_redirects=False)
    assert post_res.status_code == 400
    assert "location" not in post_res.headers
    assert await _count(async_db, OAuthClient) == 0  # no client provisioned for the attacker
    assert await _count(async_db, OAuthAuthorizationCode) == 0


@pytest.mark.parametrize("redirect_uri", ALLOWED_CONNECTOR_REDIRECT_URIS)
async def test_unknown_client_allowlisted_connector_callback_still_works(
    client: AsyncClient, async_db: AsyncSession, redirect_uri: str
):
    user = await _make_user(async_db)
    token = _signed(user.email)

    get_res = await client.get("/oauth/authorize", params=_get_params("chatgpt", redirect_uri, token=token))
    assert get_res.status_code == 200

    post_res = await client.post(
        "/oauth/authorize", data=_form("chatgpt", redirect_uri, token=token), follow_redirects=False
    )
    assert post_res.status_code == 302
    assert post_res.headers["location"].startswith(redirect_uri)
    assert "code=" in post_res.headers["location"]


# ── Token endpoint ───────────────────────────────────────────────────────────

async def _issue_code(client: AsyncClient, async_db: AsyncSession, redirect_uri: str = GOOD) -> tuple[str, str]:
    user = await _make_user(async_db)
    client_id = await _make_client(async_db, [redirect_uri])
    res = await client.post(
        "/oauth/authorize", data=_form(client_id, redirect_uri, token=_signed(user.email)), follow_redirects=False
    )
    assert res.status_code == 302
    return client_id, parse_qs(urlparse(res.headers["location"]).query)["code"][0]


async def test_token_exchange_requires_matching_redirect_uri(client: AsyncClient, async_db: AsyncSession):
    client_id, code = await _issue_code(client, async_db)
    base = {"grant_type": "authorization_code", "code": code, "code_verifier": VERIFIER, "client_id": client_id}

    res = await client.post("/oauth/token", data={**base, "redirect_uri": EVIL})
    assert res.status_code == 400
    assert "redirect_uri" in res.json()["detail"]

    # The code is still usable by the legitimate client afterwards.
    ok = await client.post("/oauth/token", data={**base, "redirect_uri": GOOD})
    assert ok.status_code == 200


async def test_token_exchange_rejects_wrong_pkce_verifier(client: AsyncClient, async_db: AsyncSession):
    client_id, code = await _issue_code(client, async_db)
    res = await client.post(
        "/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": "wrong_verifier_wrong_verifier_wrong_verifier",
            "client_id": client_id,
            "redirect_uri": GOOD,
        },
    )
    assert res.status_code == 400
    assert "PKCE" in res.json()["detail"]


async def test_token_exchange_rejects_other_client_id(client: AsyncClient, async_db: AsyncSession):
    _, code = await _issue_code(client, async_db)
    res = await client.post(
        "/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": VERIFIER,
            "client_id": "someone_else",
            "redirect_uri": GOOD,
        },
    )
    assert res.status_code == 400


async def test_token_exchange_allows_omitted_redirect_uri(client: AsyncClient, async_db: AsyncSession):
    client_id, code = await _issue_code(client, async_db)
    res = await client.post(
        "/oauth/token",
        data={"grant_type": "authorization_code", "code": code, "code_verifier": VERIFIER, "client_id": client_id},
    )
    assert res.status_code == 200


@pytest.mark.parametrize(
    "uri,ok",
    [
        ("https://chatgpt.com/aip/g-abc123XYZ/oauth/callback", True),
        ("https://chat.openai.com/aip/g-abc123/oauth/callback", True),
        ("https://chatgpt.com/aip/g-abc/oauth/callback?x=1", False),
        ("https://chatgpt.com.evil.example/aip/g-abc/oauth/callback", False),
        ("https://chatgpt.com/aip/g-abc/../../evil/oauth/callback", False),
    ],
)
async def test_gpt_action_callback_pattern(client: AsyncClient, async_db: AsyncSession, uri: str, ok: bool):
    res = await client.get("/oauth/authorize", params=_get_params("gpt-action-client", uri), follow_redirects=False)
    assert (res.status_code != 400) == ok
