import json
import sqlite3
import uuid
from contextlib import asynccontextmanager

import pytest

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_adapter(list, json.dumps)

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.types import ARRAY
from sqlalchemy.dialects.postgresql import JSONB


@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "JSON"


@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

from src.api.generation import start_generation
from src.mcp.context import get_mcp_db, reset_current_mcp_user, set_current_mcp_user
from src.mcp.tools.generation import generate_resume_handler
from src.mcp.tools.readiness import check_readiness_handler, list_templates_handler
from src.models.generation import Generation
from src.models.profile import Profile, UserExperience, UserProject
from src.models.user import Base, User
from src.schemas.generation import ContentSplitRequest, GenerationCreate
from src.services.content_split import resolve_default_split
from src.template_registry.service import TemplateRegistryService


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def setup_test_env(monkeypatch):
    engine = create_async_engine(TEST_DB_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn))

    session_maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    @asynccontextmanager
    async def mock_get_mcp_db():
        async with session_maker() as session:
            yield session

    monkeypatch.setattr("src.mcp.context.AsyncSessionLocal", session_maker)
    monkeypatch.setattr("src.mcp.context.get_mcp_db", mock_get_mcp_db)
    monkeypatch.setattr("src.core.database.AsyncSessionLocal", session_maker)

    async with session_maker() as db:
        test_user = User(email="pref-user@example.com", name="Pref User", provider="test")
        db.add(test_user)
        await db.commit()
        await db.refresh(test_user)

    token = set_current_mcp_user(test_user)

    yield test_user, session_maker

    reset_current_mcp_user(token)
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.drop_all(sync_conn))
    await engine.dispose()


def _manifest():
    return TemplateRegistryService.get_template_manifest("personal-classic")


# ── Resolver unit tests ───────────────────────────────────────────────────────


def test_resolver_falls_back_to_template_default_without_preference():
    user = User(email="no-pref@example.com")
    split = resolve_default_split(user, _manifest())
    assert (split.projects, split.experience) == (2, 2)


def test_resolver_uses_stored_preference_when_allowed():
    user = User(email="pref@example.com", preferred_projects=3, preferred_experience=2)
    split = resolve_default_split(user, _manifest())
    assert (split.projects, split.experience) == (3, 2)
    assert split.label == "Project Leaning (3 Projects, 2 Experiences)"


def test_resolver_ignores_preference_not_allowed_for_template():
    user = User(email="bad-pref@example.com", preferred_projects=5, preferred_experience=5)
    split = resolve_default_split(user, _manifest())
    assert (split.projects, split.experience) == (2, 2)


def test_resolver_handles_none_user():
    split = resolve_default_split(None, _manifest())
    assert (split.projects, split.experience) == (2, 2)


# ── MCP integration tests ─────────────────────────────────────────────────────


async def _seed_profile(session_maker, user_id, projects=2, experiences=2):
    async with session_maker() as db:
        db.add(Profile(user_id=user_id, full_name="Pref User", email="pref-user@example.com"))
        for i in range(projects):
            db.add(UserProject(user_id=user_id, name=f"Project {i}", bullet_points=[f"Built {i}"]))
        for i in range(experiences):
            db.add(
                UserExperience(
                    user_id=user_id,
                    role=f"Engineer {i}",
                    organization=f"Company {i}",
                    bullet_points=[f"Shipped {i}"],
                )
            )
        await db.commit()


async def _mock_trigger_no_op(monkeypatch):
    async def mock_trigger_pipeline(gen_id: str):
        return None

    monkeypatch.setattr("src.mcp.tools.generation.trigger_pipeline", mock_trigger_pipeline)


@pytest.mark.asyncio
async def test_mcp_generate_with_explicit_split_persists_preference(setup_test_env, monkeypatch):
    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id, projects=3, experiences=2)
    await _mock_trigger_no_op(monkeypatch)

    res = await generate_resume_handler(
        job_description="Backend Engineer requiring Python",
        template_id="personal-classic",
        content_split={"projects": 3, "experience": 2},
        wait_for_completion=False,
    )
    assert res["success"] is True
    assert res["content_split"] == {"projects": 3, "experience": 2}

    async with session_maker() as db:
        saved = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        assert saved.preferred_projects == 3
        assert saved.preferred_experience == 2


@pytest.mark.asyncio
async def test_mcp_generate_without_split_uses_stored_preference(setup_test_env, monkeypatch):
    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id, projects=3, experiences=2)
    await _mock_trigger_no_op(monkeypatch)

    # Simulate a fresh MCP request having loaded the stored preference.
    user.preferred_projects = 3
    user.preferred_experience = 2

    res = await generate_resume_handler(
        job_description="Backend Engineer requiring Python",
        template_id="personal-classic",
        wait_for_completion=False,
    )
    assert res["success"] is True
    assert res["content_split"] == {"projects": 3, "experience": 2}

    async with session_maker() as db:
        gen = (
            await db.execute(select(Generation).where(Generation.user_id == user.id))
        ).scalar_one()
        assert gen.content_split == {"projects": 3, "experience": 2}


@pytest.mark.asyncio
async def test_mcp_generate_rejects_invalid_split(setup_test_env):
    res = await generate_resume_handler(
        job_description="Backend Engineer requiring Python",
        template_id="personal-classic",
        content_split={"projects": 5, "experience": 5},
        wait_for_completion=False,
    )
    assert res["success"] is False
    assert res["error_code"] == "INVALID_CONTENT_SPLIT"


@pytest.mark.asyncio
async def test_check_readiness_uses_stored_preference(setup_test_env):
    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id, projects=2, experiences=2)

    user.preferred_projects = 3
    user.preferred_experience = 3

    result = await check_readiness_handler(template_id="personal-classic")
    assert result["is_ready"] is False
    assert result["required_split"] == {"projects": 3, "experience": 3}
    assert any("at least 3 project(s)" in reason for reason in result["blocking_reasons"])
    assert any("at least 3 experience(s)" in reason for reason in result["blocking_reasons"])


@pytest.mark.asyncio
async def test_list_templates_returns_personalized_default(setup_test_env):
    user, session_maker = setup_test_env

    user.preferred_projects = 3
    user.preferred_experience = 2

    result = await list_templates_handler()
    classic = next(t for t in result["templates"] if t["id"] == "personal-classic")
    assert classic["default_content_split"]["projects"] == 3
    assert classic["default_content_split"]["experience"] == 2


# ── REST API tests ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rest_generate_with_explicit_split_persists_preference(setup_test_env, monkeypatch):
    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id, projects=3, experiences=2)

    async def mock_noop(*args, **kwargs):
        return None

    monkeypatch.setattr("src.api.generation.reap_stuck_generations", mock_noop)
    monkeypatch.setattr("src.api.generation.check_rate_limit", mock_noop)
    monkeypatch.setattr("src.api.generation.trigger_pipeline", mock_noop)

    async with session_maker() as db:
        current_user = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        req = GenerationCreate(
            template_id="personal-classic",
            job_description="Backend Engineer requiring Python",
            content_split=ContentSplitRequest(projects=3, experience=2),
        )
        gen = await start_generation(req, current_user, db)
        assert gen.content_split == {"projects": 3, "experience": 2}
        await db.refresh(current_user)
        assert current_user.preferred_projects == 3
        assert current_user.preferred_experience == 2


@pytest.mark.asyncio
async def test_rest_generate_without_split_uses_stored_preference(setup_test_env, monkeypatch):
    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id, projects=3, experiences=2)

    async with session_maker() as db:
        current_user = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        current_user.preferred_projects = 3
        current_user.preferred_experience = 2
        await db.commit()

    async def mock_noop(*args, **kwargs):
        return None

    monkeypatch.setattr("src.api.generation.reap_stuck_generations", mock_noop)
    monkeypatch.setattr("src.api.generation.check_rate_limit", mock_noop)
    monkeypatch.setattr("src.api.generation.trigger_pipeline", mock_noop)

    async with session_maker() as db:
        current_user = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        req = GenerationCreate(
            template_id="personal-classic",
            job_description="Backend Engineer requiring Python",
        )
        gen = await start_generation(req, current_user, db)
        assert gen.content_split == {"projects": 3, "experience": 2}
