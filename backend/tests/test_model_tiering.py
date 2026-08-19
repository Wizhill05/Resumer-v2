import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from src.core.auth import get_current_admin
from src.core.database import get_db
from src.main import app
from src.models.generation import LLMProviderConfig
from src.models.user import Base, User
from src.services.llm_config import LLMConfigService


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def async_db():
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [User.__table__, LLMProviderConfig.__table__]
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


@pytest.mark.asyncio
async def test_llm_config_service_defaults():
    service = LLMConfigService()
    pro_cfg = service.get_tier_config("pro")
    free_cfg = service.get_tier_config("free")

    assert pro_cfg.tier == "pro"
    assert pro_cfg.model == "antigravity/gemini-3.7-flash-tiered"
    assert "omniroute" in pro_cfg.base_url or "render" in pro_cfg.base_url

    assert free_cfg.tier == "free"
    assert free_cfg.model == "poolside/laguna-xs-2.1:free"
    assert "openrouter.ai" in free_cfg.base_url


@pytest.mark.asyncio
async def test_llm_instantiation():
    service = LLMConfigService()
    
    pro_llm = service.get_llm(tier="pro")
    assert pro_llm.model_name == "antigravity/gemini-3.7-flash-tiered"

    free_llm = service.get_llm(tier="free", api_key_override="test-openrouter-key")
    assert free_llm.model_name == "poolside/laguna-xs-2.1:free"
    assert free_llm.openai_api_base == "https://openrouter.ai/api/v1"


@pytest.mark.asyncio
async def test_admin_model_settings_api(client: AsyncClient, async_db: AsyncSession):
    admin_user = User(
        email="admin@example.com",
        name="Admin User",
        provider="google",
        is_pro=True,
    )
    async_db.add(admin_user)
    await async_db.commit()

    app.dependency_overrides[get_current_admin] = lambda: admin_user

    try:
        # 1. GET model-settings
        res = await client.get("/admin/model-settings")
        assert res.status_code == 200
        data = res.json()
        assert "pro" in data
        assert "free" in data
        assert data["pro"]["model"] == "antigravity/gemini-3.7-flash-tiered"
        assert data["free"]["model"] == "poolside/laguna-xs-2.1:free"

        # 2. PUT model-settings to switch free model
        update_payload = {
            "tier": "free",
            "base_url": "https://openrouter.ai/api/v1",
            "model": "poolside/laguna-xs-2.1:free",
            "api_keys": ["sk-or-v1-testkey1", "sk-or-v1-testkey2"],
            "temperature": 0.3,
            "fallback_provider": "google",
            "fallback_model": "gemma-4-31b-it",
        }
        put_res = await client.put("/admin/model-settings", json=update_payload)
        assert put_res.status_code == 200
        put_data = put_res.json()
        assert put_data["tier"] == "free"
        assert put_data["temperature"] == 0.3
        assert put_data["keys_count"] == 2
        assert len(put_data["masked_keys"]) == 2
    finally:
        app.dependency_overrides.pop(get_current_admin, None)


@pytest.mark.asyncio
async def test_admin_user_tier_update(client: AsyncClient, async_db: AsyncSession):
    admin_user = User(
        email="admin@example.com",
        name="Admin User",
        provider="google",
        is_pro=True,
    )
    normal_user = User(
        email="normal_user@example.com",
        name="Normal User",
        provider="google",
        is_pro=False,
    )
    async_db.add_all([admin_user, normal_user])
    await async_db.commit()
    await async_db.refresh(normal_user)

    app.dependency_overrides[get_current_admin] = lambda: admin_user

    try:
        # Patch user to Pro
        res = await client.patch(f"/admin/users/{normal_user.id}/tier", json={"is_pro": True})
        assert res.status_code == 200
        data = res.json()
        assert data["id"] == str(normal_user.id)
        assert data["is_pro"] is True

        # Demote back to Free
        res2 = await client.patch(f"/admin/users/{normal_user.id}/tier", json={"is_pro": False})
        assert res2.status_code == 200
        assert res2.json()["is_pro"] is False
    finally:
        app.dependency_overrides.pop(get_current_admin, None)
