from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import pytest
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
from src.models.profile import Profile
from src.models.user import Base, User

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [User.__table__, Profile.__table__]
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


def auth_headers(user) -> dict:
    token = jose_jwt.encode({"sub": str(user.id), "email": user.email}, settings.JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


async def _create_user(async_db, email, name="Test User", signup_completed_at=None):
    user = User(
        email=email,
        name=name,
        provider="google",
        email_verified_at=datetime.now(timezone.utc),
        signup_completed_at=signup_completed_at,
    )
    async_db.add(user)
    await async_db.commit()
    await async_db.refresh(user)
    return user


async def _create_profile(async_db, user_id, **kwargs):
    profile = Profile(user_id=user_id, **kwargs)
    async_db.add(profile)
    await async_db.commit()
    await async_db.refresh(profile)
    return profile


# --- GET ---

async def test_get_prefill_falls_back_to_user_name(client, async_db):
    user = await _create_user(async_db, "alice@example.com", name="Alice A")
    res = await client.get("/account/welcome", headers=auth_headers(user))
    assert res.status_code == 200
    data = res.json()
    assert data == {
        "full_name": "Alice A",
        "subtitle": None,
        "location": None,
        "phone": None,
        "linkedin_url": None,
    }


async def test_get_prefill_from_profile(client, async_db):
    user = await _create_user(async_db, "bob@example.com", name="Bob B")
    await _create_profile(
        async_db,
        user.id,
        full_name="Bob Profile",
        subtitle="Backend engineer",
        location="Berlin",
        phone="123",
        linkedin_url="https://www.linkedin.com/in/bob",
    )
    res = await client.get("/account/welcome", headers=auth_headers(user))
    assert res.status_code == 200
    data = res.json()
    assert data["full_name"] == "Bob Profile"
    assert data["subtitle"] == "Backend engineer"
    assert data["location"] == "Berlin"
    assert data["phone"] == "123"
    assert data["linkedin_url"] == "https://www.linkedin.com/in/bob"


async def test_get_prefill_profile_null_name_falls_back(client, async_db):
    user = await _create_user(async_db, "carol@example.com", name="Carol C")
    await _create_profile(async_db, user.id, full_name=None, subtitle="Designer")
    res = await client.get("/account/welcome", headers=auth_headers(user))
    assert res.status_code == 200
    data = res.json()
    assert data["full_name"] == "Carol C"
    assert data["subtitle"] == "Designer"


# --- POST full save ---

async def test_post_full_save(client, async_db):
    user = await _create_user(async_db, "dave@example.com", name="Old Name", signup_completed_at=None)
    res = await client.post(
        "/account/welcome",
        json={
            "full_name": "  Dave New  ",
            "subtitle": "Backend engineer",
            "location": "Remote",
            "phone": "555-1234",
            "linkedin_url": "https://www.linkedin.com/in/dave",
        },
        headers=auth_headers(user),
    )
    assert res.status_code == 200
    assert res.json() == {"ok": True}

    await async_db.refresh(user)
    assert user.name == "Dave New"
    assert user.signup_completed_at is not None

    result = await async_db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one()
    assert profile.full_name == "Dave New"
    assert profile.subtitle == "Backend engineer"
    assert profile.location == "Remote"
    assert profile.phone == "555-1234"
    assert profile.linkedin_url == "https://www.linkedin.com/in/dave"


async def test_post_creates_profile_when_missing(client, async_db):
    user = await _create_user(async_db, "erin@example.com", name="Erin")
    res = await client.post(
        "/account/welcome",
        json={"full_name": "Erin New", "subtitle": "Designer"},
        headers=auth_headers(user),
    )
    assert res.status_code == 200
    result = await async_db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one()
    assert profile.full_name == "Erin New"
    assert profile.subtitle == "Designer"
    assert profile.location is None


async def test_post_existing_values_not_wiped_by_empty_input(client, async_db):
    user = await _create_user(async_db, "frank@example.com", name="Frank")
    await _create_profile(
        async_db,
        user.id,
        full_name="Frank F",
        subtitle="Old role",
        location="Paris",
        phone="999",
        linkedin_url="https://linkedin.com/in/frank",
    )
    res = await client.post(
        "/account/welcome",
        json={"full_name": "Frank New", "subtitle": "New role", "location": "", "phone": "   ", "linkedin_url": ""},
        headers=auth_headers(user),
    )
    assert res.status_code == 200
    result = await async_db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one()
    assert profile.full_name == "Frank New"
    assert profile.subtitle == "New role"
    assert profile.location == "Paris"
    assert profile.phone == "999"
    assert profile.linkedin_url == "https://linkedin.com/in/frank"


async def test_post_missing_optional_preserves_existing(client, async_db):
    user = await _create_user(async_db, "grace@example.com", name="Grace")
    await _create_profile(async_db, user.id, full_name="Grace G", subtitle="Old", location="Tokyo")
    res = await client.post(
        "/account/welcome",
        json={"full_name": "Grace G2", "subtitle": "New"},
        headers=auth_headers(user),
    )
    assert res.status_code == 200
    result = await async_db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one()
    assert profile.subtitle == "New"
    assert profile.location == "Tokyo"


# --- Skip ---

async def test_post_skip_saves_only_name(client, async_db):
    user = await _create_user(async_db, "heidi@example.com", name="Heidi Old", signup_completed_at=None)
    await _create_profile(
        async_db,
        user.id,
        full_name="Heidi H",
        subtitle="Existing role",
        location="Rome",
        phone="111",
        linkedin_url="https://linkedin.com/in/heidi",
    )
    res = await client.post(
        "/account/welcome",
        json={"full_name": "Heidi New", "skip": True},
        headers=auth_headers(user),
    )
    assert res.status_code == 200
    assert res.json() == {"ok": True}

    await async_db.refresh(user)
    assert user.name == "Heidi New"
    assert user.signup_completed_at is not None

    result = await async_db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one()
    assert profile.full_name == "Heidi New"
    assert profile.subtitle == "Existing role"
    assert profile.location == "Rome"
    assert profile.phone == "111"
    assert profile.linkedin_url == "https://linkedin.com/in/heidi"


async def test_post_skip_creates_profile_and_sets_completed(client, async_db):
    user = await _create_user(async_db, "ivan@example.com", name="Ivan", signup_completed_at=None)
    res = await client.post(
        "/account/welcome",
        json={"full_name": "Ivan I", "skip": True},
        headers=auth_headers(user),
    )
    assert res.status_code == 200
    await async_db.refresh(user)
    assert user.signup_completed_at is not None
    result = await async_db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one()
    assert profile.full_name == "Ivan I"
    assert profile.subtitle is None


async def test_post_skip_ignores_even_invalid_extras(client, async_db):
    user = await _create_user(async_db, "judy@example.com", name="Judy")
    res = await client.post(
        "/account/welcome",
        json={"full_name": "Judy J", "skip": True, "subtitle": "", "linkedin_url": "not-a-url"},
        headers=auth_headers(user),
    )
    assert res.status_code == 200
    result = await async_db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one()
    assert profile.full_name == "Judy J"
    assert profile.linkedin_url is None


# --- signup_completed_at set once ---

async def test_signup_completed_at_set_once(client, async_db):
    past = datetime.now(timezone.utc) - timedelta(days=30)
    user = await _create_user(async_db, "ken@example.com", name="Ken", signup_completed_at=past)
    res = await client.post(
        "/account/welcome",
        json={"full_name": "Ken K", "subtitle": "Engineer"},
        headers=auth_headers(user),
    )
    assert res.status_code == 200
    await async_db.refresh(user)
    # SQLite stores DateTime(timezone=True) as naive UTC; compare without tzinfo.
    saved = user.signup_completed_at
    assert saved is not None
    assert saved.replace(tzinfo=timezone.utc) == past

    res2 = await client.post(
        "/account/welcome",
        json={"full_name": "Ken K2", "subtitle": "Designer"},
        headers=auth_headers(user),
    )
    assert res2.status_code == 200
    await async_db.refresh(user)
    saved2 = user.signup_completed_at
    assert saved2 == saved


# --- LinkedIn validation ---

@pytest.mark.parametrize(
    "url",
    [
        "https://linkedin.com/in/ada",
        "https://www.linkedin.com/in/ada",
        "http://linkedin.com/in/ada",
        "https://de.linkedin.com/in/ada",
    ],
)
async def test_linkedin_valid_urls(client, async_db, url):
    user = await _create_user(async_db, f"li{uuid.uuid4().hex[:8]}@example.com", name="L I")
    res = await client.post(
        "/account/welcome",
        json={"full_name": "L I", "subtitle": "Engineer", "linkedin_url": url},
        headers=auth_headers(user),
    )
    assert res.status_code == 200, res.text


@pytest.mark.parametrize(
    "url",
    [
        "not-a-url",
        "https://google.com/in/ada",
        "https://notlinkedin.com/in/ada",
        "https://linkedin.com.evil.com/in/ada",
        "ftp://linkedin.com/in/ada",
        "linkedin.com/in/ada",
    ],
)
async def test_linkedin_invalid_urls(client, async_db, url):
    user = await _create_user(async_db, f"li{uuid.uuid4().hex[:8]}@example.com", name="L I")
    res = await client.post(
        "/account/welcome",
        json={"full_name": "L I", "subtitle": "Engineer", "linkedin_url": url},
        headers=auth_headers(user),
    )
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert isinstance(detail, str) and detail


async def test_linkedin_empty_treated_as_not_provided(client, async_db):
    user = await _create_user(async_db, "li-empty@example.com", name="L E")
    res = await client.post(
        "/account/welcome",
        json={"full_name": "L E", "subtitle": "Engineer", "linkedin_url": "   "},
        headers=auth_headers(user),
    )
    assert res.status_code == 200
    result = await async_db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one()
    assert profile.linkedin_url is None


# --- Length limits ---

async def test_full_name_required_and_limits(client, async_db):
    user = await _create_user(async_db, "limit1@example.com", name="Lim")
    # missing
    res = await client.post(
        "/account/welcome",
        json={"subtitle": "Engineer"},
        headers=auth_headers(user),
    )
    assert res.status_code == 400
    assert isinstance(res.json()["detail"], str)

    # empty / whitespace
    res = await client.post(
        "/account/welcome",
        json={"full_name": "   ", "subtitle": "Engineer"},
        headers=auth_headers(user),
    )
    assert res.status_code == 400

    # too long
    res = await client.post(
        "/account/welcome",
        json={"full_name": "A" * 101, "subtitle": "Engineer"},
        headers=auth_headers(user),
    )
    assert res.status_code == 400

    # exactly 100 ok
    res = await client.post(
        "/account/welcome",
        json={"full_name": "A" * 100, "subtitle": "Engineer"},
        headers=auth_headers(user),
    )
    assert res.status_code == 200


async def test_subtitle_required_unless_skip(client, async_db):
    user = await _create_user(async_db, "limit2@example.com", name="Lim2")
    res = await client.post(
        "/account/welcome",
        json={"full_name": "Lim2"},
        headers=auth_headers(user),
    )
    assert res.status_code == 400
    assert isinstance(res.json()["detail"], str)

    res = await client.post(
        "/account/welcome",
        json={"full_name": "Lim2", "subtitle": "   "},
        headers=auth_headers(user),
    )
    assert res.status_code == 400

    # skip without subtitle is fine
    res = await client.post(
        "/account/welcome",
        json={"full_name": "Lim2", "skip": True},
        headers=auth_headers(user),
    )
    assert res.status_code == 200


async def test_subtitle_location_phone_limits(client, async_db):
    user = await _create_user(async_db, "limit3@example.com", name="Lim3")

    res = await client.post(
        "/account/welcome",
        json={"full_name": "Lim3", "subtitle": "S" * 121},
        headers=auth_headers(user),
    )
    assert res.status_code == 400

    res = await client.post(
        "/account/welcome",
        json={"full_name": "Lim3", "subtitle": "S" * 120},
        headers=auth_headers(user),
    )
    assert res.status_code == 200

    res = await client.post(
        "/account/welcome",
        json={"full_name": "Lim3", "subtitle": "Engineer", "location": "L" * 121},
        headers=auth_headers(user),
    )
    assert res.status_code == 400

    res = await client.post(
        "/account/welcome",
        json={"full_name": "Lim3", "subtitle": "Engineer", "phone": "P" * 41},
        headers=auth_headers(user),
    )
    assert res.status_code == 400

    res = await client.post(
        "/account/welcome",
        json={"full_name": "Lim3", "subtitle": "Engineer", "location": "L" * 120, "phone": "P" * 40},
        headers=auth_headers(user),
    )
    assert res.status_code == 200


# --- Unauthenticated ---

async def test_unauthenticated_get_returns_401(client):
    res = await client.get("/account/welcome")
    assert res.status_code == 401


async def test_unauthenticated_post_returns_401(client):
    res = await client.post("/account/welcome", json={"full_name": "X Y", "subtitle": "Engineer"})
    assert res.status_code == 401


async def test_unauthenticated_bad_token_returns_401(client):
    res = await client.get("/account/welcome", headers={"Authorization": "Bearer invalid"})
    assert res.status_code == 401
