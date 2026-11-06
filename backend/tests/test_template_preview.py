import json
import sqlite3
import uuid
from contextlib import asynccontextmanager

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.types import ARRAY

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_adapter(list, json.dumps)
sqlite3.register_adapter(dict, json.dumps)


@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "JSON"


@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"


from src.core.config import settings
from src.main import app
from src.models.generation import Generation
from src.models.user import Base, User
from src.schemas.template import DEFAULT_SECTION_ORDER
from src.services.template_layout import (
    load_sample_resume_fixture,
    render_template_preview_pages,
)
from src.template_registry.service import TemplateRegistryService

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def db_env(monkeypatch):
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn))

    session_maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    @asynccontextmanager
    async def mock_get_db():
        async with session_maker() as session:
            yield session

    from src.core.database import get_db

    async def override_get_db():
        async with session_maker() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr("src.core.database.AsyncSessionLocal", session_maker)
    monkeypatch.setattr("src.core.database.get_db", mock_get_db)
    monkeypatch.setattr("src.template_registry.routes.get_db", mock_get_db)

    async with session_maker() as db:
        user = User(email="preview_tester@example.com", name="Preview Tester", provider="test")
        db.add(user)
        await db.commit()
        await db.refresh(user)

    token = jwt.encode(
        {"sub": str(user.id), "email": user.email},
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )

    yield user, token, session_maker

    app.dependency_overrides.pop(get_db, None)
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.drop_all(sync_conn))
    await engine.dispose()


def test_load_sample_resume_fixture():
    fixture = load_sample_resume_fixture("dario-altman")
    assert "profile" in fixture
    assert "resume" in fixture
    assert fixture["profile"]["full_name"] == "Dario Altman"
    assert fixture["profile"]["subtitle"] == "AI Infrastructure Engineer"
    assert "summary" in fixture["resume"]
    assert "skills" in fixture["resume"]
    assert "projects" in fixture["resume"]
    assert "experiences" in fixture["resume"]


def test_render_template_preview_pages_direct():
    manifest = TemplateRegistryService.get_template_manifest("personal-classic")
    assert manifest is not None

    page_images, fit_result, effective_order = render_template_preview_pages(
        template_id="personal-classic",
        manifest=manifest,
        section_order=None,
    )
    assert len(page_images) == 1
    assert page_images[0].startswith("data:image/")
    assert fit_result.page_count == 1
    assert fit_result.fits_target is True
    assert fit_result.font_size >= manifest.min_font_size
    assert effective_order == list(manifest.default_section_order)


def test_render_template_preview_pages_custom_order():
    manifest = TemplateRegistryService.get_template_manifest("personal-classic")
    assert manifest is not None

    custom_order = [
        "experiences",
        "projects",
        "skills",
        "summary",
        "education",
        "extracurriculars",
    ]
    page_images, fit_result, effective_order = render_template_preview_pages(
        template_id="personal-classic",
        manifest=manifest,
        section_order=custom_order,
    )
    assert len(page_images) == 1
    assert page_images[0].startswith("data:image/")
    assert effective_order == custom_order


@pytest.mark.asyncio
async def test_preview_template_unauthenticated(db_env):
    user, token, _ = db_env
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post("/templates/personal-classic/preview", json={})
        assert res.status_code == 401


@pytest.mark.asyncio
async def test_preview_template_authenticated_default(db_env):
    user, token, session_maker = db_env
    headers = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/templates/personal-classic/preview",
            json={},
            headers=headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["template_id"] == "personal-classic"
        assert len(data["page_images"]) == 1
        assert data["page_images"][0].startswith("data:image/")
        assert data["page_count"] == 1
        assert data["font_size"] >= 9.0
        assert data["fit_warning"] is False
        assert data["section_order"] == DEFAULT_SECTION_ORDER

    # Verify no Generation records created and no LLM credits used
    async with session_maker() as db:
        gens = (await db.execute(select(Generation))).scalars().all()
        assert len(gens) == 0


@pytest.mark.asyncio
async def test_preview_template_authenticated_custom_order(db_env):
    user, token, _ = db_env
    headers = {"Authorization": f"Bearer {token}"}
    custom_order = [
        "skills",
        "experiences",
        "projects",
        "education",
        "summary",
        "extracurriculars",
    ]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/templates/personal-classic/preview",
            json={"section_order": custom_order},
            headers=headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["section_order"] == custom_order
        assert len(data["page_images"]) >= 1


@pytest.mark.asyncio
async def test_preview_template_not_found(db_env):
    user, token, _ = db_env
    headers = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/templates/nonexistent-template/preview",
            json={},
            headers=headers,
        )
        assert res.status_code == 404
        assert "not found" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_preview_template_invalid_section_order(db_env):
    user, token, _ = db_env
    headers = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Duplicate section
        res = await client.post(
            "/templates/personal-classic/preview",
            json={"section_order": ["summary", "summary", "skills", "projects", "experiences", "extracurriculars"]},
            headers=headers,
        )
        assert res.status_code == 422

        # Unknown section
        res = await client.post(
            "/templates/personal-classic/preview",
            json={"section_order": ["summary", "education", "skills", "projects", "experiences", "fake_section"]},
            headers=headers,
        )
        assert res.status_code == 422

        # Missing section
        res = await client.post(
            "/templates/personal-classic/preview",
            json={"section_order": ["summary", "education", "skills"]},
            headers=headers,
        )
        assert res.status_code == 422


async def test_preview_render_does_not_block_event_loop(monkeypatch):
    import asyncio
    import threading
    from types import SimpleNamespace

    from src.template_registry.routes import preview_template

    started = threading.Event()
    release = threading.Event()

    def slow_render(**kwargs):
        started.set()
        release.wait(timeout=3)
        return ["data:image/png;base64,AA=="], SimpleNamespace(page_count=1, font_size=10, fits_target=True), DEFAULT_SECTION_ORDER

    monkeypatch.setattr("src.template_registry.routes.render_template_preview_pages", slow_render)
    user = SimpleNamespace(preferred_section_orders=None)
    task = asyncio.create_task(preview_template("personal-classic", None, user))
    try:
        assert await asyncio.to_thread(started.wait, 2)
        await asyncio.wait_for(asyncio.sleep(0.01), timeout=0.5)
        assert not task.done()
    finally:
        release.set()
    assert (await task).page_count == 1


# ── Professional Sans Preview Tests ──────────────────────────────────────────


def test_render_professional_sans_preview_pages_direct():
    manifest = TemplateRegistryService.get_template_manifest("professional-sans")
    assert manifest is not None

    page_images, fit_result, effective_order = render_template_preview_pages(
        template_id="professional-sans",
        manifest=manifest,
        section_order=None,
    )
    assert len(page_images) == 1
    assert page_images[0].startswith("data:image/")
    assert fit_result.page_count == 1
    assert fit_result.fits_target is True
    assert fit_result.font_size >= manifest.min_font_size
    assert effective_order == list(manifest.default_section_order)


@pytest.mark.asyncio
async def test_preview_professional_sans_authenticated_default(db_env):
    user, token, session_maker = db_env
    headers = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)
    manifest = TemplateRegistryService.get_template_manifest("professional-sans")
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/templates/professional-sans/preview",
            json={},
            headers=headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["template_id"] == "professional-sans"
        assert len(data["page_images"]) == 1
        assert data["page_images"][0].startswith("data:image/")
        assert data["page_count"] == 1
        assert data["font_size"] >= manifest.min_font_size
        assert data["fit_warning"] is False
        assert data["section_order"] == list(manifest.default_section_order)

    # Verify no Generation records created and no LLM credits used
    async with session_maker() as db:
        gens = (await db.execute(select(Generation))).scalars().all()
        assert len(gens) == 0


@pytest.mark.asyncio
async def test_preview_professional_sans_authenticated_custom_order(db_env):
    user, token, _ = db_env
    headers = {"Authorization": f"Bearer {token}"}
    custom_order = [
        "experiences",
        "projects",
        "skills",
        "education",
        "summary",
        "extracurriculars",
    ]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/templates/professional-sans/preview",
            json={"section_order": custom_order},
            headers=headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["template_id"] == "professional-sans"
        assert data["section_order"] == custom_order
        assert len(data["page_images"]) >= 1


@pytest.mark.asyncio
async def test_preview_independent_template_isolation(db_env):
    user, token, session_maker = db_env
    headers = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)

    # User sets custom layout for personal-classic
    custom_classic = [
        "skills",
        "experiences",
        "projects",
        "education",
        "summary",
        "extracurriculars",
    ]
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        put_res = await client.put(
            "/templates/personal-classic/layout",
            json={"section_order": custom_classic},
            headers=headers,
        )
        assert put_res.status_code == 200

        # Previewing professional sans without explicit order resolves to sans default
        sans_manifest = TemplateRegistryService.get_template_manifest("professional-sans")
        res = await client.post("/templates/professional-sans/preview", json={}, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["template_id"] == "professional-sans"
        assert data["section_order"] == list(sans_manifest.default_section_order)
        assert data["section_order"] != custom_classic

        # Verify personal-classic layout in DB is still untouched
        classic_layout = await client.get("/templates/personal-classic/layout", headers=headers)
        assert classic_layout.json()["section_order"] == custom_classic
