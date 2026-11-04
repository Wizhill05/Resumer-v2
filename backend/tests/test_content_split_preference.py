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
    original_processor = ARRAY.result_processor
    def array_result_processor(self, dialect, coltype):
        if dialect.name == "sqlite":
            return lambda value: json.loads(value) if value is not None else None
        return original_processor(self, dialect, coltype)
    monkeypatch.setattr(ARRAY, "result_processor", array_result_processor)
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


async def _seed_profile(
    session_maker,
    user_id,
    projects=2,
    experiences=2,
    *,
    github_url="https://github.com/example",
    skills=("Python", "SQL", "Git"),
):
    async with session_maker() as db:
        db.add(
            Profile(
                user_id=user_id,
                full_name="Pref User",
                email="pref-user@example.com",
                github_url=github_url,
                skills=list(skills),
            )
        )
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
async def test_check_readiness_uses_viable_split_when_preference_does_not_fit(setup_test_env):
    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id, projects=2, experiences=2)

    user.preferred_projects = 3
    user.preferred_experience = 3

    result = await check_readiness_handler(template_id="personal-classic")
    # is_ready means "some split is available"; the incompatible stored
    # preference must not block when another allowed split fits.
    assert result["is_ready"] is True
    assert result["default_split"] == {"projects": 3, "experience": 3}
    assert result["required_split"] == {"projects": 2, "experience": 2}
    assert result["split_auto_selected"] is True
    assert result["ai_steering"]["recommended_action"] == "PROCEED_TO_GENERATE"
    assert "automatically use" in result["ai_steering"]["system_directive"]


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
        assert gen.creativity_mode == "proper"


async def test_rest_generate_respects_custom_default_mode(setup_test_env, monkeypatch):
    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id, projects=2, experiences=2)

    async with session_maker() as db:
        current_user = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        current_user.preferred_creativity_mode = "proper"
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
        assert gen.creativity_mode == "proper"


async def test_rest_generate_allows_per_run_mode_override_without_changing_user_default(setup_test_env, monkeypatch):
    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id, projects=2, experiences=2)

    async with session_maker() as db:
        current_user = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        current_user.preferred_creativity_mode = "proper"
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
            creativity_mode="super_larp",
        )
        gen = await start_generation(req, current_user, db)
        assert gen.creativity_mode == "super_larp"

    # User's default mode must remain "proper"
    async with session_maker() as db:
        reloaded = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        assert reloaded.preferred_creativity_mode == "proper"


async def test_put_profile_defaults_persists_creativity_mode(setup_test_env):
    user, session_maker = setup_test_env
    from src.api.profile import get_defaults, update_defaults
    from src.schemas.generation import UserDefaultsUpdate

    async with session_maker() as db:
        current_user = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        assert current_user.preferred_creativity_mode == "proper"

        # Update to super_larp
        updated = await update_defaults(
            UserDefaultsUpdate(creativity_mode="super_larp", preferred_projects=4, preferred_experience=1),
            current_user=current_user,
            db=db,
        )
        assert updated.creativity_mode == "super_larp"
        assert updated.preferred_projects == 4
        assert updated.preferred_experience == 1

    # Verify fresh fetch from database
    async with session_maker() as db:
        refetched_user = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        assert refetched_user.preferred_creativity_mode == "super_larp"
        assert refetched_user.preferred_projects == 4
        assert refetched_user.preferred_experience == 1

        defaults_out = await get_defaults(current_user=refetched_user)
        assert defaults_out.creativity_mode == "super_larp"
        assert defaults_out.preferred_projects == 4
        assert defaults_out.preferred_experience == 1




@pytest.mark.parametrize(
    ("projects", "experiences", "expected"),
    [(0, 0, False), (1, 1, False), (1, 2, False), (2, 1, False),
     (1, 3, True), (2, 2, True), (3, 1, True)],
)
async def test_generation_ready_endpoint(setup_test_env, projects, experiences, expected, monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from src.api.profile import router
    from src.core.auth import get_current_user
    from src.core.database import get_db

    monkeypatch.setattr(ARRAY, "result_processor", lambda self, dialect, coltype: (lambda value: json.loads(value) if value is not None else None) if dialect.name == "sqlite" else None)
    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id, projects=projects, experiences=experiences)
    async with session_maker() as db:
        profile = (await db.execute(select(Profile).where(Profile.user_id == user.id))).scalar_one()
        profile.github_url = "https://github.com/example"
        profile.skills = ["Python", "SQL", "Git"]
        await db.commit()
    app = FastAPI()
    app.include_router(router)

    async def test_db():
        async with session_maker() as db:
            yield db

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = test_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/profile/generation-ready")
    assert response.status_code == 200
    assert response.json()["is_ready"] is expected
    if not expected:
        assert "old resumes" in response.json()["next_steps"]
        assert "/profile" in response.json()["next_steps"]


@pytest.mark.parametrize("missing", ["name", "email", "link", "skills", "project_details", "experience_details"])
async def test_generation_ready_rejects_incomplete_profile(setup_test_env, missing, monkeypatch):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from src.api.profile import router
    from src.core.auth import get_current_user
    from src.core.database import get_db

    monkeypatch.setattr(ARRAY, "result_processor", lambda self, dialect, coltype: (lambda value: json.loads(value) if value is not None else None) if dialect.name == "sqlite" else None)
    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id)
    async with session_maker() as db:
        profile = (await db.execute(select(Profile).where(Profile.user_id == user.id))).scalar_one()
        profile.github_url = "https://github.com/example"
        profile.skills = ["Python", "SQL", "Git"]
        if missing == "name":
            profile.full_name = " "
            user.name = None
        elif missing == "email":
            profile.email = " "
            user.email = ""
        elif missing == "link":
            profile.github_url = " "
        elif missing == "skills":
            profile.skills = ["Python", " python ", ""]
        elif missing == "project_details":
            for project in (await db.execute(select(UserProject).where(UserProject.user_id == user.id))).scalars():
                project.bullet_points = [" "]
        elif missing == "experience_details":
            for experience in (await db.execute(select(UserExperience).where(UserExperience.user_id == user.id))).scalars():
                experience.bullet_points = [" "]
        await db.commit()

    app = FastAPI()
    app.include_router(router)

    async def test_db():
        async with session_maker() as db:
            yield db

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = test_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/profile/generation-ready")
    assert response.status_code == 200
    data = response.json()
    assert data["is_ready"] is False
    fields = [gap["field"] for gap in data["missing"]]
    expected_field = {"name": "full_name", "email": "email", "link": "professional_link", "skills": "skills", "project_details": "projects.", "experience_details": "experiences."}[missing]
    assert any(field.startswith(expected_field) for field in fields)
    if missing == "skills":
        assert data["skills_needed"] == 2


async def test_generation_selects_viable_split_and_runner_filters_entries(setup_test_env, monkeypatch):
    from src.pipeline.job_runner import _load_initial_state

    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id, projects=2, experiences=2)
    async with session_maker() as db:
        profile = (await db.execute(select(Profile).where(Profile.user_id == user.id))).scalar_one()
        profile.full_name = "  "
        profile.email = "  "
        db.add(UserProject(user_id=user.id, name="Incomplete", bullet_points=[]))
        db.add(UserExperience(user_id=user.id, role="Incomplete", organization="Org", bullet_points=[]))
        saved_user = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        saved_user.preferred_projects = 3
        saved_user.preferred_experience = 3
        await db.commit()
    user.preferred_projects = 3
    user.preferred_experience = 3
    await _mock_trigger_no_op(monkeypatch)
    result = await generate_resume_handler(job_description="Engineer", wait_for_completion=False)
    assert result["success"] is True
    assert result["content_split"] == {"projects": 2, "experience": 2}
    assert result["split_auto_selected"] is True
    async with session_maker() as db:
        generation = (await db.execute(select(Generation))).scalar_one()
        state = await _load_initial_state(db, generation)
        assert state["profile"]["full_name"] == user.name
        assert state["profile"]["email"] == user.email
        assert len(state["projects"]) == 2
        assert len(state["experiences"]) == 2


async def test_http_generation_picks_viable_split_and_checks_profile(setup_test_env, monkeypatch):
    from fastapi import HTTPException

    user, session_maker = setup_test_env
    await _seed_profile(session_maker, user.id)
    async def noop(*args, **kwargs):
        pass
    for name in ("reap_stuck_generations", "check_rate_limit", "trigger_pipeline"):
        monkeypatch.setattr(f"src.api.generation.{name}", noop)
    async with session_maker() as db:
        current = (await db.execute(select(User).where(User.id == user.id))).scalar_one()
        current.preferred_projects = 3
        current.preferred_experience = 3
        request = GenerationCreate(template_id="personal-classic", job_description="Engineer")
        generation = await start_generation(request, current, db)
        assert generation.content_split == {"projects": 2, "experience": 2}
        profile = (await db.execute(select(Profile).where(Profile.user_id == user.id))).scalar_one()
        profile.github_url = None
        await db.flush()
        with pytest.raises(HTTPException) as error:
            await start_generation(request, current, db)
        assert error.value.status_code == 400
        assert any("link" in message for message in error.value.detail)


async def test_guest_generation_rejects_incomplete_entries(monkeypatch):
    from fastapi import HTTPException, Response
    from src.api.guest import start_guest_generation
    from src.schemas.guest import GuestGenerationCreate
    from src.schemas.profile import ExperienceCreate, ProjectCreate

    async def noop(*args, **kwargs):
        pass
    monkeypatch.setattr("src.api.guest._guest_token", lambda *args: "guest-token")
    monkeypatch.setattr("src.api.guest._check_guest_rate_limit", noop)
    data = GuestGenerationCreate(
        job_description="Engineer",
        projects=[ProjectCreate(name="Incomplete"), ProjectCreate(name="Incomplete 2")],
        experiences=[
            ExperienceCreate(role="Engineer", organization="Org", bullet_points=["Built things"]),
            ExperienceCreate(role="Engineer", organization="Org", bullet_points=["Shipped things"]),
        ],
    )
    with pytest.raises(HTTPException) as error:
        await start_guest_generation(data, Response(), db=None)
    assert error.value.status_code == 400
    assert "usable" in error.value.detail
