import sqlite3
import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))

from src.core.database import get_db
from src.core.security import hash_password, verify_password
from src.main import app
from src.models.user import Base, User

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [User.__table__]
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


@pytest.fixture
async def seed_credentials_user(async_db: AsyncSession):
    """Create a credentials user the way the post-verification flow does."""
    user = User(
        email="charlie@example.com",
        name="Charlie",
        hashed_password=hash_password("Password123!"),
        provider="credentials",
    )
    async_db.add(user)
    await async_db.commit()
    return user


def test_password_hash_and_verify():
    pwd = "SecurePassword123!"
    hashed = hash_password(pwd)
    assert hashed != pwd
    assert ":" in hashed
    assert verify_password(pwd, hashed) is True
    assert verify_password("WrongPassword!", hashed) is False
    assert verify_password(pwd, "invalid:format:here") is False
    assert verify_password(pwd, None) is False


async def test_email_login_success(client: AsyncClient, seed_credentials_user):
    res = await client.post(
        "/auth/email/login",
        json={"email": "charlie@example.com", "password": "Password123!"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["email"] == "charlie@example.com"
    assert data["name"] == "Charlie"


async def test_email_login_wrong_password(client: AsyncClient, seed_credentials_user):
    res = await client.post(
        "/auth/email/login",
        json={"email": "charlie@example.com", "password": "WrongPassword!"},
    )
    assert res.status_code == 401
    assert "Incorrect password" in res.json()["detail"]


async def test_email_login_nonexistent_user(client: AsyncClient):
    res = await client.post(
        "/auth/email/login",
        json={"email": "nobody@example.com", "password": "Password123!"},
    )
    assert res.status_code == 401
    assert "No account found" in res.json()["detail"]


async def test_email_login_social_account_without_password(client: AsyncClient, async_db: AsyncSession):
    # Simulate a user created via Google social login
    user = User(
        email="socialuser@example.com",
        name="Social User",
        provider="google",
        hashed_password=None,
    )
    async_db.add(user)
    await async_db.commit()

    # Attempting login should advise user
    res = await client.post(
        "/auth/email/login",
        json={"email": "socialuser@example.com", "password": "AnyPassword123!"},
    )
    assert res.status_code == 401
    assert "Google" in res.json()["detail"]


async def test_email_login_legacy_unverified_credentials_user(client: AsyncClient, async_db: AsyncSession):
    # Grandfathered: credentials users with email_verified_at NULL can sign in.
    user = User(
        email="legacy@example.com",
        name="Legacy",
        hashed_password=hash_password("Password123!"),
        provider="credentials",
        email_verified_at=None,
    )
    async_db.add(user)
    await async_db.commit()

    res = await client.post(
        "/auth/email/login",
        json={"email": "legacy@example.com", "password": "Password123!"},
    )
    assert res.status_code == 200
    assert res.json()["email"] == "legacy@example.com"


async def test_old_register_endpoint_is_gone(client: AsyncClient, async_db: AsyncSession):
    res = await client.post(
        "/auth/email/register",
        json={"email": "gone@example.com", "password": "Password123!", "name": "Gone"},
    )
    assert res.status_code != 200
    from sqlalchemy import select

    user = (await async_db.execute(select(User).where(User.email == "gone@example.com"))).scalar_one_or_none()
    assert user is None
