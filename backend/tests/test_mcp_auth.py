import json
import sqlite3
import uuid
import pytest
from starlette.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))
sqlite3.register_adapter(list, json.dumps)
sqlite3.register_adapter(dict, json.dumps)

from src.core.config import settings
from src.core.database import get_db
from src.core.oauth import create_oauth_access_token
from src.main import app
from src.mcp.server import mcp_server
from src.models.user import Base, User

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [User.__table__]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, tables=tables))

    session_maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_maker() as session:
        yield session

    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.drop_all(sync_conn, tables=tables))
    await engine.dispose()


@pytest.fixture
def client(async_db: AsyncSession):
    async def override_get_db():
        yield async_db

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, base_url="http://test") as tc:
        yield tc
    app.dependency_overrides.clear()


def test_mcp_unauthenticated_request_returns_401(client: TestClient):
    res = client.post("/mcp", json={
        "jsonrpc": "2.0",
        "method": "tools/list",
        "id": 1,
    })
    assert res.status_code == 401
    assert "WWW-Authenticate" in res.headers
    assert 'Bearer realm="Resumer"' in res.headers["WWW-Authenticate"]


def test_mcp_invalid_token_returns_401(client: TestClient):
    res = client.post(
        "/mcp",
        headers={"Authorization": "Bearer invalid_garbage_token"},
        json={"jsonrpc": "2.0", "method": "tools/list", "id": 1},
    )
    assert res.status_code == 401
    assert 'error="invalid_token"' in res.headers["WWW-Authenticate"]


@pytest.mark.asyncio
async def test_mcp_authenticated_token_resolves_user(client: TestClient, async_db: AsyncSession):
    # Create user
    user = User(
        email="mcp_user@example.com",
        name="MCP User",
        provider="oauth-mcp",
    )
    async_db.add(user)
    await async_db.commit()
    await async_db.refresh(user)

    # Mint OAuth access token
    access_tok, _ = create_oauth_access_token(
        user_id=user.id,
        email=user.email,
        scope="profile:read profile:write resume:generate resume:edit",
        client_id="client_test",
    )

    # Initialize MCP protocol request
    res = client.post(
        "/mcp",
        headers={
            "Authorization": f"Bearer {access_tok}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        },
        json={
            "jsonrpc": "2.0",
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test-client", "version": "1.0.0"},
            },
            "id": 1,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert "result" in data
    assert data["result"]["serverInfo"]["name"] == "Resumer MCP Server"


def test_mcp_sse_unauthenticated_request_returns_401(client: TestClient):
    res = client.get("/sse")
    assert res.status_code == 401
    assert "WWW-Authenticate" in res.headers
    assert 'Bearer realm="Resumer"' in res.headers["WWW-Authenticate"]


def test_mcp_sse_invalid_token_returns_401(client: TestClient):
    res = client.get("/sse", headers={"Authorization": "Bearer invalid_garbage_token"})
    assert res.status_code == 401
    assert 'error="invalid_token"' in res.headers["WWW-Authenticate"]


def test_mcp_messages_unauthenticated_request_returns_401(client: TestClient):
    res = client.post("/messages", json={"jsonrpc": "2.0", "method": "tools/list", "id": 1})
    assert res.status_code == 401
    assert "WWW-Authenticate" in res.headers
