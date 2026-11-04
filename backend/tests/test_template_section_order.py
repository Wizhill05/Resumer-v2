import json
import sqlite3
import uuid
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
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


from jose import jwt
from src.core.config import settings
from src.main import app
from src.models.generation import Generation
from src.models.user import Base, User
from src.schemas.template import DEFAULT_SECTION_ORDER, SECTION_IDS
from src.services.resume_render import build_resume_markdown, render_resume_html
from src.services.template_layout import (
    get_generation_section_order,
    resolve_section_order,
    save_user_template_layout,
    validate_section_order,
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
    monkeypatch.setattr("src.mcp.server.AsyncSessionLocal", session_maker)
    monkeypatch.setattr("src.mcp.context.AsyncSessionLocal", session_maker)
    monkeypatch.setattr("src.core.database.get_db", mock_get_db)
    monkeypatch.setattr("src.template_registry.routes.get_db", mock_get_db)

    async with session_maker() as db:
        user = User(email="layout_tester@example.com", name="Layout Tester", provider="test")
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


# ── 1. Validation Unit Tests ──────────────────────────────────────────────────


def test_validate_section_order_valid_permutation():
    custom_order = [
        "projects",
        "skills",
        "experiences",
        "education",
        "summary",
        "extracurriculars",
    ]
    res = validate_section_order(custom_order)
    assert res == custom_order


def test_validate_section_order_invalid_duplicates():
    dup_order = [
        "projects",
        "projects",
        "experiences",
        "education",
        "summary",
        "extracurriculars",
    ]
    with pytest.raises(HTTPException) as exc:
        validate_section_order(dup_order)
    assert exc.value.status_code == 422
    assert "Duplicate" in exc.value.detail or "must contain exactly" in exc.value.detail


def test_validate_section_order_missing_section():
    missing_order = ["projects", "skills", "experiences", "education", "summary"]
    with pytest.raises(HTTPException) as exc:
        validate_section_order(missing_order)
    assert exc.value.status_code == 422


def test_validate_section_order_unknown_section():
    unknown_order = [
        "projects",
        "skills",
        "experiences",
        "education",
        "summary",
        "hobbies",
    ]
    with pytest.raises(HTTPException) as exc:
        validate_section_order(unknown_order)
    assert exc.value.status_code == 422
    assert "Unknown section identifier" in exc.value.detail


def test_validate_section_order_non_list():
    with pytest.raises(HTTPException) as exc:
        validate_section_order("summary,education")
    assert exc.value.status_code == 422


# ── 2. Resolution & Legacy Fallback Tests ──────────────────────────────────────


def test_resolve_section_order_explicit_precedence():
    user = User(email="test@example.com", preferred_section_orders={"personal-classic": ["skills", "summary", "projects", "education", "experiences", "extracurriculars"]})
    explicit = ["projects", "experiences", "education", "skills", "summary", "extracurriculars"]
    resolved = resolve_section_order(explicit_order=explicit, user=user, template_id="personal-classic")
    assert resolved == explicit


def test_resolve_section_order_user_preference_precedence():
    pref = ["skills", "summary", "projects", "education", "experiences", "extracurriculars"]
    user = User(email="test@example.com", preferred_section_orders={"personal-classic": pref})
    resolved = resolve_section_order(explicit_order=None, user=user, template_id="personal-classic")
    assert resolved == pref


def test_resolve_section_order_fallback_to_default_when_no_pref():
    user = User(email="test@example.com", preferred_section_orders=None)
    resolved = resolve_section_order(explicit_order=None, user=user, template_id="personal-classic")
    assert resolved == DEFAULT_SECTION_ORDER


def test_legacy_generation_null_always_uses_default():
    # Even if user now has preferred_section_orders, an existing generation with None uses default!
    user = User(email="test@example.com", preferred_section_orders={"personal-classic": ["projects", "skills", "experiences", "education", "summary", "extracurriculars"]})
    gen_order = get_generation_section_order(None, "personal-classic")
    assert gen_order == DEFAULT_SECTION_ORDER


# ── 3. Template Layout API Tests ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_and_put_template_layout_api(db_env):
    user, token, session_maker = db_env
    headers = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # GET default
        get_res = await client.get("/templates/personal-classic/layout", headers=headers)
        assert get_res.status_code == 200
        data = get_res.json()
        assert data["template_id"] == "personal-classic"
        assert data["default_section_order"] == DEFAULT_SECTION_ORDER
        assert data["section_order"] == DEFAULT_SECTION_ORDER

        # PUT valid permutation
        custom = [
            "projects",
            "experiences",
            "education",
            "skills",
            "summary",
            "extracurriculars",
        ]
        put_res = await client.put(
            "/templates/personal-classic/layout",
            json={"section_order": custom},
            headers=headers,
        )
        assert put_res.status_code == 200
        put_data = put_res.json()
        assert put_data["section_order"] == custom

        # GET returns newly updated order
        get_res2 = await client.get("/templates/personal-classic/layout", headers=headers)
        assert get_res2.status_code == 200
        assert get_res2.json()["section_order"] == custom

        # PUT invalid permutation (duplicate)
        bad_put = await client.put(
            "/templates/personal-classic/layout",
            json={"section_order": ["projects", "projects", "education", "skills", "summary", "extracurriculars"]},
            headers=headers,
        )
        assert bad_put.status_code == 422


# ── 4. Jinja Rendering Behavioral Tests ────────────────────────────────────────


def test_jinja_rendering_respects_custom_order():
    resume_data = {
        "summary": "Experienced software architect.",
        "education": [{"degree": "B.S. CS", "institution": "State Univ", "location": "NY"}],
        "skills": {"Languages": ["Python", "TypeScript"]},
        "projects": [{"name": "Project Alpha", "bullet_points": ["Built cool system"]}],
        "experiences": [{"role": "Senior Engineer", "organization": "Acme Inc", "bullet_points": ["Scaled infra"]}],
        "extracurriculars": [{"description": "Open source contributor"}],
    }
    profile_data = {"full_name": "Jane Doe", "email": "jane@example.com"}

    custom_order = [
        "projects",
        "experiences",
        "skills",
        "education",
        "summary",
        "extracurriculars",
    ]

    html = render_resume_html(
        template_id="personal-classic",
        profile=profile_data,
        resume=resume_data,
        font_size=10.0,
        page_margin_mm=10.0,
        section_order=custom_order,
    )

    assert html is not None
    # Verify fixed header is at the top
    assert html.index("Jane Doe") < html.index("PROJECTS")

    # Check order of section headings in HTML
    idx_proj = html.index("PROJECTS")
    idx_exp = html.index("EXPERIENCE")
    idx_skills = html.index("SKILLS")
    idx_edu = html.index("EDUCATION")
    idx_sum = html.index("PROFESSIONAL SUMMARY")
    idx_extra = html.index("EXTRA-CURRICULAR ACTIVITIES & ACHIEVEMENTS")

    assert idx_proj < idx_exp < idx_skills < idx_edu < idx_sum < idx_extra


def test_jinja_rendering_omits_empty_sections():
    resume_data = {
        "summary": None,  # empty
        "education": [],   # empty
        "skills": {"Languages": ["Python"]},
        "projects": [{"name": "Project Beta", "bullet_points": ["Did something"]}],
        "experiences": [], # empty
        "extracurriculars": [],
    }
    profile_data = {"full_name": "Jane Doe"}

    html = render_resume_html(
        template_id="personal-classic",
        profile=profile_data,
        resume=resume_data,
        font_size=10.0,
        page_margin_mm=10.0,
        section_order=DEFAULT_SECTION_ORDER,
    )

    assert html is not None
    assert "PROFESSIONAL SUMMARY" not in html
    assert "EDUCATION" not in html
    assert "EXPERIENCE" not in html
    assert "EXTRA-CURRICULAR" not in html
    assert "SKILLS" in html
    assert "PROJECTS" in html


# ── 5. Markdown Generation Behavioral Tests ───────────────────────────────────


def test_build_resume_markdown_respects_order():
    resume_data = {
        "summary": "Experienced software architect.",
        "education": [{"degree": "B.S. CS", "institution": "State Univ"}],
        "skills": {"Languages": ["Python", "TypeScript"]},
        "projects": [{"name": "Project Alpha", "bullet_points": ["Built cool system"]}],
        "experiences": [{"role": "Senior Engineer", "organization": "Acme Inc", "bullet_points": ["Scaled infra"]}],
        "extracurriculars": [{"description": "Open source contributor"}],
    }
    profile_data = {"full_name": "Jane Doe"}

    custom_order = [
        "extracurriculars",
        "projects",
        "skills",
        "experiences",
        "education",
        "summary",
    ]

    md = build_resume_markdown(
        profile=profile_data,
        resume=resume_data,
        section_order=custom_order,
    )

    idx_extra = md.index("## Extra-Curricular Activities & Achievements")
    idx_proj = md.index("## Projects")
    idx_skills = md.index("## Skills")
    idx_exp = md.index("## Experience")
    idx_edu = md.index("## Education")
    idx_sum = md.index("## Professional Summary")

    assert idx_extra < idx_proj < idx_skills < idx_exp < idx_edu < idx_sum


# ── 6. PDF Rendering & Generation Creation Tests ──────────────────────────────


def test_pdf_rendering_respects_custom_order():
    from src.services.resume_render import render_resume_pdf
    import pypdfium2 as pdfium

    resume_data = {
        "summary": "Experienced software architect.",
        "education": [{"degree": "B.S. CS", "institution": "State Univ"}],
        "skills": {"Languages": ["Python", "TypeScript"]},
        "projects": [{"name": "Project Alpha", "bullet_points": ["Built cool system"]}],
        "experiences": [{"role": "Senior Engineer", "organization": "Acme Inc", "bullet_points": ["Scaled infra"]}],
        "extracurriculars": [{"description": "Open source contributor"}],
    }
    profile_data = {"full_name": "Jane Doe", "email": "jane@example.com"}

    custom_order = [
        "projects",
        "experiences",
        "skills",
        "education",
        "summary",
        "extracurriculars",
    ]

    pdf_bytes, page_count = render_resume_pdf(
        template_id="personal-classic",
        profile=profile_data,
        resume=resume_data,
        font_size=10.0,
        page_margin_mm=10.0,
        section_order=custom_order,
    )
    assert page_count >= 1
    assert len(pdf_bytes) > 0

    # Extract text using pdfium to verify actual text rendering order
    pdf = pdfium.PdfDocument(pdf_bytes)
    page_text = pdf[0].get_textpage().get_text_range()

    idx_proj = page_text.index("PROJECTS")
    idx_exp = page_text.index("EXPERIENCE")
    idx_skills = page_text.index("SKILLS")
    idx_edu = page_text.index("EDUCATION")
    idx_sum = page_text.index("PROFESSIONAL SUMMARY")
    idx_extra = page_text.index("EXTRA-CURRICULAR ACTIVITIES & ACHIEVEMENTS")

    assert idx_proj < idx_exp < idx_skills < idx_edu < idx_sum < idx_extra


@pytest.mark.asyncio
async def test_generation_create_snapshots_order_correctly(db_env, monkeypatch):
    user, token, session_maker = db_env

    # Setup profile with enough entries to pass readiness
    from src.models.profile import Profile, UserProject, UserExperience
    from src.schemas.generation import GenerationCreate
    from src.api.generation import start_generation

    async with session_maker() as db:
        u = await db.get(User, user.id)
        # Set user saved preference
        saved_pref = ["skills", "summary", "projects", "education", "experiences", "extracurriculars"]
        u.preferred_section_orders = {"personal-classic": saved_pref}

        prof = Profile(
            user_id=u.id,
            full_name="Test Person",
            email=u.email,
            github_url="https://github.com/tester",
            skills={"Languages": ["Python", "Go", "TypeScript"]},
        )
        db.add(prof)
        for i in range(3):
            db.add(UserProject(user_id=u.id, name=f"Proj {i}", description="Desc", technologies=["Python"], bullet_points=["Built something"]))
            db.add(UserExperience(user_id=u.id, role=f"Role {i}", organization="Org", bullet_points=["Did something"]))
        await db.commit()

    # Mock trigger_pipeline so it doesn't trigger background graph runner
    pipeline_triggered = []
    async def mock_trigger(gen_id: str):
        pipeline_triggered.append(gen_id)

    monkeypatch.setattr("src.api.generation.trigger_pipeline", mock_trigger)

    async with session_maker() as db:
        u = await db.get(User, user.id)
        # 1. No explicit order provided: should snapshot saved preference
        gen_data1 = GenerationCreate(
            template_id="personal-classic",
            job_description="Looking for Python architect...",
        )
        out1 = await start_generation(gen_data1, current_user=u, db=db)
        assert out1.section_order == saved_pref

        gen_row1 = await db.get(Generation, out1.id)
        assert gen_row1.section_order == saved_pref

        # 2. Explicit order provided: should snapshot explicit order
        explicit = ["extracurriculars", "projects", "education", "skills", "experiences", "summary"]
        gen_data2 = GenerationCreate(
            template_id="personal-classic",
            job_description="Looking for Python architect...",
            section_order=explicit,
        )
        out2 = await start_generation(gen_data2, current_user=u, db=db)
        assert out2.section_order == explicit

        gen_row2 = await db.get(Generation, out2.id)
        assert gen_row2.section_order == explicit

        # 3. Change user preference later: existing generation snapshot must NOT change!
        u.preferred_section_orders = {"personal-classic": DEFAULT_SECTION_ORDER}
        await db.commit()

        # Check gen_row1 section_order remains saved_pref
        await db.refresh(gen_row1)
        assert gen_row1.section_order == saved_pref


# ── 6. PDF Pages Fallback with Section Order ──────────────────────────────────


@pytest.mark.asyncio
async def test_pdf_pages_fallback_propagates_saved_section_order(db_env, monkeypatch):
    user, token, session_maker = db_env
    headers = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)

    custom_order = [
        "projects",
        "skills",
        "experiences",
        "education",
        "summary",
        "extracurriculars",
    ]

    resume_data = {
        "summary": "Full stack engineer with 5 years experience.",
        "skills": {"Languages": ["Python", "Rust"], "Frameworks": ["FastAPI", "React"]},
        "education": [{"institution": "MIT", "degree": "B.S. CS", "graduation_year": 2020}],
        "projects": [{"name": "Project Alpha", "bullet_points": ["Built cool system"]}],
        "experiences": [{"role": "Senior Engineer", "organization": "Acme Inc", "bullet_points": ["Scaled infra"]}],
        "extracurriculars": [{"description": "Open source contributor"}],
    }
    profile_data = {"full_name": "Jane Doe", "email": "jane@example.com"}

    async with session_maker() as db:
        gen = Generation(
            user_id=user.id,
            template_id="personal-classic",
            job_title="Software Engineer",
            job_description="Job description text...",
            status="completed",
            section_order=custom_order,
            pdf_storage_key=None,
            render_metadata={
                "tailored_resume": resume_data,
                "profile": profile_data,
                "font_size": 10.0,
            },
        )
        db.add(gen)
        await db.commit()
        await db.refresh(gen)
        gen_id = str(gen.id)

    import src.services.resume_render as rr_module

    captured_kwargs = []
    real_fit_and_render = rr_module.fit_and_render_pdf

    def spy_fit_and_render(*args, **kwargs):
        captured_kwargs.append(kwargs)
        return real_fit_and_render(*args, **kwargs)

    monkeypatch.setattr("src.services.resume_render.fit_and_render_pdf", spy_fit_and_render)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(f"/generate/{gen_id}/pdf-pages", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["page_count"] >= 1
        assert len(data["page_images"]) == data["page_count"]
        assert len(captured_kwargs) == 1
        assert captured_kwargs[0].get("section_order") == custom_order


@pytest.mark.asyncio
async def test_pdf_pages_fallback_legacy_null_order_uses_default(db_env, monkeypatch):
    user, token, session_maker = db_env
    headers = {"Authorization": f"Bearer {token}"}
    transport = ASGITransport(app=app)

    resume_data = {
        "summary": "Full stack engineer with 5 years experience.",
        "skills": {"Languages": ["Python", "Rust"]},
        "education": [{"institution": "MIT", "degree": "B.S. CS", "graduation_year": 2020}],
        "projects": [{"name": "Project Alpha", "bullet_points": ["Built cool system"]}],
        "experiences": [{"role": "Senior Engineer", "organization": "Acme Inc", "bullet_points": ["Scaled infra"]}],
        "extracurriculars": [{"description": "Open source contributor"}],
    }
    profile_data = {"full_name": "Jane Doe", "email": "jane@example.com"}

    async with session_maker() as db:
        gen = Generation(
            user_id=user.id,
            template_id="personal-classic",
            job_title="Software Engineer",
            job_description="Job description text...",
            status="completed",
            section_order=None,
            pdf_storage_key=None,
            render_metadata={
                "tailored_resume": resume_data,
                "profile": profile_data,
                "font_size": 10.0,
            },
        )
        db.add(gen)
        await db.commit()
        await db.refresh(gen)
        gen_id = str(gen.id)

    import src.services.resume_render as rr_module

    captured_kwargs = []
    real_fit_and_render = rr_module.fit_and_render_pdf

    def spy_fit_and_render(*args, **kwargs):
        captured_kwargs.append(kwargs)
        return real_fit_and_render(*args, **kwargs)

    monkeypatch.setattr("src.services.resume_render.fit_and_render_pdf", spy_fit_and_render)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get(f"/generate/{gen_id}/pdf-pages", headers=headers)
        assert res.status_code == 200
        assert len(captured_kwargs) == 1
        assert captured_kwargs[0].get("section_order") == DEFAULT_SECTION_ORDER


