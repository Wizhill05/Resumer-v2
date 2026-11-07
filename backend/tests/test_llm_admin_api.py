"""API tests for /admin/llm/* and the analytics llm_status change."""
import uuid
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.auth import get_current_admin, get_current_user
from src.core.config import settings
from src.core.database import get_db
from src.main import app
from src.models.llm import LlmEndpoint, LlmRoleAssignment
from src.models.user import Base, User
from src.services import llm_probe

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [
        User.__table__,
        LlmEndpoint.__table__,
        LlmRoleAssignment.__table__,
    ]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, tables=tables))
        # Minimal stand-ins for tables /admin/analytics reads (the real
        # Generation model uses ARRAY, which SQLite cannot compile).
        await conn.execute(
            __import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS generations ("
                "id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36), template_id VARCHAR,"
                "status VARCHAR, is_guest BOOLEAN, created_at DATETIME, completed_at DATETIME)"
            )
        )
        await conn.execute(
            __import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS generation_node_metrics ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, generation_id VARCHAR(36),"
                "node_name VARCHAR, provider VARCHAR, model VARCHAR, status VARCHAR,"
                "latency_ms FLOAT, fallback_used BOOLEAN, parse_error BOOLEAN,"
                "error_message VARCHAR, prompt_tokens INTEGER, completion_tokens INTEGER,"
                "total_tokens INTEGER, created_at DATETIME)"
            )
        )

    async_session = async_sessionmaker(engine, expire_on_commit=False)
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


@pytest.fixture(autouse=True)
def _mock_fetch(monkeypatch):
    async def fake_fetch_models(base_url, api_key, extra_headers, timeout=10.0, transport=None):
        return {
            "ok": True,
            "normalized_base_url": "https://api.example.com/v1",
            "models_url": "https://api.example.com/v1/models",
            "latency_ms": 12.0,
            "models": [{"id": "m1", "owned_by": "o", "context_length": None, "kind": "chat", "capabilities": []}],
            "attempts": [],
            "error": None,
        }

    monkeypatch.setattr(llm_probe, "fetch_models", fake_fetch_models)
    monkeypatch.setattr("src.services.llm_config.llm_probe.fetch_models", fake_fetch_models)


async def _seed_admin(async_db: AsyncSession) -> User:
    admin = User(email="admin@example.com", name="Admin", provider="google")
    async_db.add(admin)
    await async_db.commit()
    await async_db.refresh(admin)
    app.dependency_overrides[get_current_admin] = lambda: admin
    return admin


async def _seed_non_admin(async_db: AsyncSession) -> User:
    user = User(email="user@example.com", name="User", provider="google")
    async_db.add(user)
    await async_db.commit()
    await async_db.refresh(user)
    app.dependency_overrides[get_current_user] = lambda: user
    return user


@pytest.mark.asyncio
async def test_non_admin_forbidden(client: AsyncClient, async_db: AsyncSession, monkeypatch):
    await _seed_non_admin(async_db)
    monkeypatch.setattr(settings, "ADMIN_EMAILS", "admin@example.com")
    try:
        res = await client.get("/admin/llm/config")
        assert res.status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_create_endpoint_encrypts_key(client: AsyncClient, async_db: AsyncSession):
    await _seed_admin(async_db)
    try:
        res = await client.post(
            "/admin/llm/endpoints",
            json={"base_url": "https://api.example.com/v1", "api_key": "sk-secret-abcdef", "default_model": "m1"},
        )
        assert res.status_code == 201, res.text
        data = res.json()
        assert data["has_api_key"] is True
        assert data["api_key_hint"] == "…cdef"
        assert "sk-secret" not in res.text
        row = (await async_db.execute(_endpoint_select())).scalar_one()
        assert row.api_key_encrypted != "sk-secret-abcdef"
        assert "sk-secret" not in (row.api_key_encrypted or "")
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


def _endpoint_select():
    from sqlalchemy import select

    return select(LlmEndpoint)


@pytest.mark.asyncio
async def test_create_derives_name_and_rejects_duplicate(client: AsyncClient, async_db: AsyncSession):
    await _seed_admin(async_db)
    try:
        res = await client.post("/admin/llm/endpoints", json={"base_url": "https://api.example.com/v1"})
        assert res.status_code == 201
        assert res.json()["name"] == "example.com"
        res2 = await client.post("/admin/llm/endpoints", json={"base_url": "https://api.example.com/v1"})
        assert res2.status_code == 201
        assert res2.json()["name"] == "example.com 2"
        res3 = await client.post(
            "/admin/llm/endpoints", json={"base_url": "https://other.example.com/v1", "name": "example.com"}
        )
        assert res3.status_code == 409
        assert res3.json()["detail"]["code"] == "duplicate_name"
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


@pytest.mark.asyncio
async def test_create_rejects_forbidden_header(client: AsyncClient, async_db: AsyncSession):
    await _seed_admin(async_db)
    try:
        res = await client.post(
            "/admin/llm/endpoints",
            json={"base_url": "https://api.example.com/v1", "extra_headers": {"Authorization": "x"}},
        )
        assert res.status_code == 422
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


@pytest.mark.asyncio
async def test_patch_key_lifecycle(client: AsyncClient, async_db: AsyncSession):
    await _seed_admin(async_db)
    try:
        created = await client.post(
            "/admin/llm/endpoints",
            json={"base_url": "https://api.example.com/v1", "api_key": "sk-first-12345678"},
        )
        endpoint_id = created.json()["id"]
        # PATCH without api_key keeps the key
        res = await client.patch(f"/admin/llm/endpoints/{endpoint_id}", json={"timeout_seconds": 42})
        assert res.status_code == 200
        assert res.json()["has_api_key"] is True
        # base_url change clears models
        await client.post(f"/admin/llm/endpoints/{endpoint_id}/models/refresh")
        res = await client.patch(f"/admin/llm/endpoints/{endpoint_id}", json={"base_url": "https://other.example.com/v1"})
        assert res.status_code == 200
        assert res.json()["models"] == []
        # clear
        res = await client.patch(f"/admin/llm/endpoints/{endpoint_id}", json={"clear_api_key": True})
        assert res.json()["has_api_key"] is False
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


@pytest.mark.asyncio
async def test_role_routing(client: AsyncClient, async_db: AsyncSession):
    await _seed_admin(async_db)
    try:
        created = await client.post("/admin/llm/endpoints", json={"base_url": "https://api.example.com/v1"})
        endpoint_id = created.json()["id"]

        # unknown endpoint -> 422
        res = await client.put(
            "/admin/llm/roles/default",
            json={"targets": [{"endpoint_id": str(uuid.uuid4()), "model": "m1"}]},
        )
        assert res.status_code == 422

        # too many targets -> 422
        res = await client.put(
            "/admin/llm/roles/default",
            json={"targets": [{"endpoint_id": endpoint_id, "model": f"m{i}"} for i in range(4)]},
        )
        assert res.status_code == 422

        # valid
        res = await client.put(
            "/admin/llm/roles/default",
            json={"targets": [{"endpoint_id": endpoint_id, "model": "m1"}]},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["ready"] is True
        default_role = next(r for r in data["roles"] if r["role"] == "default")
        assert len(default_role["effective_targets"]) == 1

        # pro inherits
        pro_role = next(r for r in data["roles"] if r["role"] == "pro")
        assert len(pro_role["effective_targets"]) == 1
        assert pro_role["effective_targets"][0]["inherited"] is True
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


@pytest.mark.asyncio
async def test_delete_in_use(client: AsyncClient, async_db: AsyncSession):
    await _seed_admin(async_db)
    try:
        created = await client.post("/admin/llm/endpoints", json={"base_url": "https://api.example.com/v1"})
        endpoint_id = created.json()["id"]
        await client.put(
            "/admin/llm/roles/default",
            json={"targets": [{"endpoint_id": endpoint_id, "model": "m1"}]},
        )
        res = await client.delete(f"/admin/llm/endpoints/{endpoint_id}")
        assert res.status_code == 409
        detail = res.json()["detail"]
        assert detail["code"] == "endpoint_in_use"
        assert "default" in detail["roles"]

        res = await client.delete(f"/admin/llm/endpoints/{endpoint_id}?force=true")
        assert res.status_code == 200
        assert res.json()["deleted"] is True
        assert "default" in res.json()["removed_from_roles"]

        config = await client.get("/admin/llm/config")
        default_role = next(r for r in config.json()["roles"] if r["role"] == "default")
        assert default_role["targets"] == []
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


@pytest.mark.asyncio
async def test_probe_uses_stored_key(client: AsyncClient, async_db: AsyncSession, monkeypatch):
    await _seed_admin(async_db)
    captured: dict = {}
    async def fake_fetch_models(base_url, api_key, extra_headers, timeout=15.0, transport=None):
        captured["api_key"] = api_key
        return {
            "ok": True, "normalized_base_url": base_url, "models_url": f"{base_url}/models",
            "latency_ms": 5.0, "models": [{"id": "m1", "owned_by": None, "context_length": None, "kind": "chat", "capabilities": []}],
            "attempts": [], "error": None,
        }

    monkeypatch.setattr(llm_probe, "fetch_models", fake_fetch_models)
    monkeypatch.setattr("src.services.llm_config.llm_probe.fetch_models", fake_fetch_models)
    try:
        created = await client.post(
            "/admin/llm/endpoints",
            json={"base_url": "https://api.example.com/v1", "api_key": "sk-stored-99999999"},
        )
        endpoint_id = created.json()["id"]
        res = await client.post(
            "/admin/llm/probe",
            json={"base_url": "https://api.example.com/v1", "endpoint_id": endpoint_id},
        )
        assert res.status_code == 200
        assert captured["api_key"] == "sk-stored-99999999"
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


@pytest.mark.asyncio
async def test_test_endpoint_401(client: AsyncClient, async_db: AsyncSession, monkeypatch):
    await _seed_admin(async_db)

    async def fake_test(base_url, api_key, extra_headers, extra_body, model, prompt, timeout, max_tokens=64, transport=None):
        return {
            "ok": False, "model": model, "latency_ms": 9.0, "output": None, "usage": None,
            "error": {"code": "unauthorized", "message": "The server rejected the bearer token (HTTP 401). Check the token.", "status_code": 401},
        }

    monkeypatch.setattr(llm_probe, "run_test_completion", fake_test)
    monkeypatch.setattr("src.services.llm_config.llm_probe.run_test_completion", fake_test)
    try:
        created = await client.post(
            "/admin/llm/endpoints",
            json={"base_url": "https://api.example.com/v1", "default_model": "m1"},
        )
        endpoint_id = created.json()["id"]
        res = await client.post(f"/admin/llm/endpoints/{endpoint_id}/test", json={})
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is False
        assert data["error"]["code"] == "unauthorized"
        config = await client.get("/admin/llm/config")
        endpoint = next(e for e in config.json()["endpoints"] if e["id"] == endpoint_id)
        assert endpoint["health"]["status"] == "error"
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


@pytest.mark.asyncio
async def test_analytics_llm_status(client: AsyncClient, async_db: AsyncSession):
    await _seed_admin(async_db)
    try:
        res = await client.get("/admin/analytics")
        assert res.status_code == 200
        data = res.json()
        assert "keys_status" not in data
        assert "llm_status" in data
        assert data["llm_status"]["ready"] is False
    finally:
        app.dependency_overrides.pop(get_current_admin, None)
