import uuid
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.auth import get_current_admin
from src.core.database import get_db
from src.main import app
from src.models.generation import LLMProviderConfig
from src.models.user import Base, User
from src.services.llm_config import LLMConfigService


@pytest.fixture(autouse=True)
def default_models(monkeypatch):
    from src.core.config import settings
    monkeypatch.setattr(settings, "FREE_MODEL_NAME", "google/gemini-3.8-flash")
    monkeypatch.setattr(settings, "PRO_MODEL_NAME", "gemini-3.8-flash-tiered")
    monkeypatch.setattr(settings, "OPENROUTER_FALLBACK_MODEL", "google/gemini-3.8-flash")


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


def test_omniroute_root_and_v1_are_equivalent(monkeypatch):
    from src.core.config import settings
    monkeypatch.setattr(settings, "PRO_MODEL_BASE_URL", "https://gateway.example/")
    assert LLMConfigService.resolve_provider("https://gateway.example/v1", "omniroute") == "omniroute"
    with pytest.raises(ValueError):
        LLMConfigService.resolve_provider("https://other.example/v1", "omniroute")


@pytest.fixture
async def async_db():
    from src.services.llm_config import llm_config_service
    llm_config_service._init_defaults()
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [User.__table__, LLMProviderConfig.__table__]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, tables=tables))

    async_session = async_sessionmaker(engine, expire_on_commit=False)
    async with async_session() as session:
        yield session

    llm_config_service._init_defaults()
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
    assert pro_cfg.model == "gemini-3.8-flash-tiered"
    assert "omniroute" in pro_cfg.base_url or "render" in pro_cfg.base_url

    assert free_cfg.tier == "free"
    assert free_cfg.model == "google/gemini-3.8-flash"
    assert "openrouter.ai" in free_cfg.base_url


@pytest.mark.asyncio
async def test_llm_instantiation():
    service = LLMConfigService()
    
    pro_llm = service.get_llm(tier="pro", api_key_override="test-key")
    assert pro_llm.model_name == "gemini-3.8-flash-tiered"

    free_llm = service.get_llm(tier="free", api_key_override="test-openrouter-key")
    assert free_llm.model_name == "google/gemini-3.8-flash"
    assert free_llm.openai_api_base == "https://openrouter.ai/api/v1"
    assert free_llm.max_tokens == 8192

@pytest.mark.asyncio
async def test_llm_pro_with_openrouter_url(monkeypatch):
    from src.core.api_key_pool import openrouter_pool
    monkeypatch.setattr("src.services.llm_config.openrouter_pool", __import__("src.core.api_key_pool", fromlist=["ApiKeyPool"]).ApiKeyPool(["sk-or-v1-pro-testkey"], "test"))

    service = LLMConfigService()
    # Simulate admin pointing pro tier to openrouter
    service._cache["pro"].base_url = "https://openrouter.ai/api/v1"
    service._cache["pro"].provider_name = "openrouter"
    service._cache["pro"].model = "google/gemini-3.7-flash"

    llm = service.get_llm(tier="pro")
    assert llm.model_name == "google/gemini-3.7-flash"
    assert str(llm.openai_api_base).rstrip("/") == "https://openrouter.ai/api/v1"
    # API key should be from openrouter_pool
    assert llm.openai_api_key.get_secret_value() == "sk-or-v1-pro-testkey"

@pytest.mark.asyncio
async def test_llm_config_service_db_roundtrip_no_keys(async_db: AsyncSession):
    service = LLMConfigService()
    # Update free tier in DB
    updated = await service.update_tier_config(
        db=async_db,
        tier="free",
        base_url="https://openrouter.ai/api/v1",
        model="google/gemini-3.7-flash",
        temperature=0.4,
    )
    assert updated.model == "google/gemini-3.7-flash"
    assert updated.temperature == 0.4

    # Fresh service instance reading from DB
    fresh_service = LLMConfigService()
    await fresh_service.load_from_db(async_db)
    loaded_free = fresh_service.get_tier_config("free")
    assert loaded_free.model == "google/gemini-3.7-flash"
    assert loaded_free.temperature == 0.4
    assert not hasattr(loaded_free, "api_keys")


@pytest.mark.asyncio
async def test_llm_config_service_error_fallback_and_rollback(async_db: AsyncSession):
    service = LLMConfigService()

    # Simulate a failing query by closing/invalidating or mocking execute
    class FailingSession:
        def __init__(self, real_session):
            self._real = real_session
            self.rolled_back = False

        async def execute(self, *args, **kwargs):
            raise RuntimeError("Simulated DB column missing error")

        async def rollback(self):
            self.rolled_back = True
            await self._real.rollback()

    failing_session = FailingSession(async_db)
    # Should not raise; should catch and log warning, and trigger rollback
    await service.load_from_db(failing_session)
    assert failing_session.rolled_back is True
    # In-memory defaults remain intact
    free_cfg = service.get_tier_config("free")
    assert free_cfg.model is not None
    assert "openrouter.ai" in free_cfg.base_url

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
        assert data["pro"]["model"] == "gemini-3.8-flash-tiered"
        assert data["free"]["model"] == "google/gemini-3.8-flash"
        assert "api_keys" not in data["pro"]
        assert "masked_keys" not in data["pro"]

        # 2. PUT model-settings to switch free model
        update_payload = {
            "tier": "free",
            "base_url": "https://openrouter.ai/api/v1",
            "model": "google/gemini-3.7-flash",
            "temperature": 0.3,
            "fallback_provider": "openrouter",
            "fallback_model": "google/gemini-3.8-flash",
        }
        put_res = await client.put("/admin/model-settings", json=update_payload)
        assert put_res.status_code == 200
        put_data = put_res.json()
        assert put_data["tier"] == "free"
        assert put_data["model"] == "google/gemini-3.7-flash"
        assert put_data["temperature"] == 0.3
        assert "api_keys" not in put_data
        assert "masked_keys" not in put_data
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

@pytest.mark.parametrize("url,model,provider", [
    ("https://api.cerebras.ai/v1", "gemini-3.8-flash", "cerebras"),
    ("https://api.groq.com/openai/v1", "gemini-3.8-flash", "groq"),
    ("https://generativelanguage.googleapis.com/v1beta", "gemini-3.8-flash", "google"),
    ("https://openrouter.ai.evil.test/api/v1", "google/gemini-3.8-flash", "openrouter"),
    ("https://openrouter.ai/api/v1", "meta-llama/llama-3.3-70b-instruct", "openrouter"),
])
def test_unsupported_routes_rejected(url, model, provider):
    service = LLMConfigService()
    cfg = service.get_tier_config("free")
    cfg.base_url, cfg.model, cfg.provider_name = url, model, provider
    with pytest.raises(ValueError):
        service.get_llm(api_key_override="test-key")


@pytest.mark.asyncio
async def test_api_key_pool_quarantine():
    from src.core.api_key_pool import ApiKeyPool
    pool = ApiKeyPool(["key-A", "key-B", "key-C"], "TestPool")

    k1 = pool.next()
    assert k1 == "key-A"
    # Quarantine key-A
    pool.mark_failure("key-A", cooldown_seconds=10.0)

    # Next calls should skip key-A
    k2 = pool.next()
    assert k2 == "key-B"
    k3 = pool.next()
    assert k3 == "key-C"
    k4 = pool.next()
    assert k4 == "key-B"  # key-A still in quarantine


@pytest.mark.asyncio
async def test_dynamic_fallback_llm():
    service = LLMConfigService()
    service._cache["pro"].fallback_provider = "openrouter"
    service._cache["pro"].fallback_model = "google/gemini-3.8-flash"

    fallback_llm = service.get_fallback_llm(tier="pro", api_key_override="test-openrouter-key")
    assert fallback_llm.model_name == "google/gemini-3.8-flash"
    assert str(fallback_llm.openai_api_base).rstrip("/") == "https://openrouter.ai/api/v1"


@pytest.mark.asyncio
async def test_legacy_rows_are_adapted_without_db_write(async_db):
    from sqlalchemy import select
    async_db.add_all([
        LLMProviderConfig(tier='pro', provider_name='omniroute',
            base_url=__import__('src.core.config', fromlist=['settings']).settings.PRO_MODEL_BASE_URL,
            model='gemini-3.8-flash-tiered', fallback_provider='google', fallback_model='gemma-4-31b-it'),
        LLMProviderConfig(tier='free', provider_name='cerebras', base_url='https://api.cerebras.ai/v1',
            model='qwen-3.8-27b', fallback_provider='google', fallback_model='gemma-4-31b-it'),
    ])
    await async_db.commit()
    service = LLMConfigService()
    await service.load_from_db(async_db)
    assert service.get_tier_config('pro').fallback_provider == 'openrouter'
    assert service.get_tier_config('pro').fallback_model == 'google/gemini-3.8-flash'
    assert service.get_tier_config('free').model == 'google/gemini-3.8-flash'
    rows = (await async_db.execute(select(LLMProviderConfig))).scalars().all()
    assert all(row.fallback_provider == 'google' for row in rows)
    assert next(row for row in rows if row.tier == 'free').provider_name == 'cerebras'


async def test_update_rejects_unsupported_before_touching_db():
    class UnusableDB:
        async def execute(self, *args):
            raise AssertionError('Invalid route touched DB')
    service = LLMConfigService()
    for kwargs in [
        {'model': 'meta-llama/llama-3.3-70b-instruct'},
        {'fallback_provider': 'google'},
        {'fallback_model': 'gemma-4-31b-it'},
        {'base_url': 'https://api.groq.com/openai/v1'},
    ]:
        params = dict(tier='free', base_url='https://openrouter.ai/api/v1', model='google/gemini-3.8-flash',
                      fallback_provider='openrouter', fallback_model='google/gemini-3.8-flash')
        params.update(kwargs)
        with pytest.raises(ValueError):
            await service.update_tier_config(UnusableDB(), **params)


def test_missing_route_keys_never_borrow_other_pool(monkeypatch):
    from src.services import llm_config
    from src.core.api_key_pool import ApiKeyPool, ApiKeyUnavailable
    service = LLMConfigService()
    monkeypatch.setattr(llm_config, 'openrouter_pool', ApiKeyPool([], 'empty'))
    monkeypatch.setattr(llm_config, 'pro_pool', ApiKeyPool(['private-pro-key'], 'pro'))
    with pytest.raises(ApiKeyUnavailable):
        service.get_fallback_llm('pro')
