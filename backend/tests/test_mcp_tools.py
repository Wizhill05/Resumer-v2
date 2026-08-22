import json
import sqlite3
import uuid
from datetime import datetime, timezone
import pytest

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))
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
from src.mcp.context import get_mcp_db, reset_current_mcp_user, set_current_mcp_user
from src.mcp.tools.editor import (
    edit_resume_section_handler,
    get_resume_json_handler,
    preview_resume_handler,
    render_resume_handler,
    save_resume_edits_handler,
)
from src.mcp.tools.generation import (
    download_resume_handler,
    generate_resume_handler,
    get_generation_status_handler,
)
from src.mcp.tools.profile import (
    add_education_handler,
    add_experience_handler,
    add_extracurricular_handler,
    add_project_handler,
    delete_education_handler,
    delete_experience_handler,
    delete_extracurricular_handler,
    delete_project_handler,
    get_profile_handler,
    list_data_summary_handler,
    update_education_handler,
    update_experience_handler,
    update_extracurricular_handler,
    update_profile_handler,
    update_project_handler,
)
from src.mcp.tools.readiness import check_readiness_handler, list_templates_handler
from src.models.generation import (
    Generation,
    GenerationLog,
    GenerationNodeMetric,
    PromptConfig,
    UserCreditOverride,
    UserRateLimit,
)
from src.models.oauth import OAuthAuthorizationCode, OAuthClient, OAuthRefreshToken
from src.models.profile import (
    Profile,
    UserEducation,
    UserExperience,
    UserExtracurricular,
    UserProject,
)
from src.models.user import Base, User


TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def setup_test_env(monkeypatch):
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [
        User.__table__,
        Profile.__table__,
        UserProject.__table__,
        UserExperience.__table__,
        UserEducation.__table__,
        UserExtracurricular.__table__,
        Generation.__table__,
        GenerationLog.__table__,
        UserRateLimit.__table__,
        UserCreditOverride.__table__,
    ]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, tables=tables))

    session_maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Monkeypatch AsyncSessionLocal in src.core.database and src.mcp.context
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def mock_get_mcp_db():
        async with session_maker() as s:
            yield s

    monkeypatch.setattr("src.mcp.context.AsyncSessionLocal", session_maker)
    monkeypatch.setattr("src.mcp.context.get_mcp_db", mock_get_mcp_db)
    monkeypatch.setattr("src.core.database.AsyncSessionLocal", session_maker)

    # Create a test user
    async with session_maker() as db:
        test_user = User(
            email="developer@example.com",
            name="Alex Developer",
            provider="mcp-test",
        )
        db.add(test_user)
        await db.commit()
        await db.refresh(test_user)

    token = set_current_mcp_user(test_user)

    yield test_user

    reset_current_mcp_user(token)
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.drop_all(sync_conn, tables=tables))
    await engine.dispose()


# ── Profile Management Tool Tests ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_profile_crud_and_summary(setup_test_env: User):
    # 1. Update Profile Basics
    prof_res = await update_profile_handler(
        full_name="Alex Developer",
        email="developer@example.com",
        location="San Francisco, CA",
        skills=["Python", "TypeScript", "FastAPI", "React"],
        summary="Senior Full-Stack Engineer with 5+ years experience building scalable web apps.",
    )
    assert prof_res["success"] is True
    assert prof_res["profile"]["full_name"] == "Alex Developer"
    assert "FastAPI" in prof_res["profile"]["skills"]

    # 2. Add Projects
    p1 = await add_project_handler(
        name="Distributed Cache",
        description="High-performance in-memory cache in Go and Redis.",
        technologies=["Go", "Redis", "gRPC"],
        bullet_points=["Reduced p99 latency by 45%", "Handled 100k req/sec"],
    )
    assert p1["success"] is True
    proj1_id = p1["project"]["id"]

    p2 = await add_project_handler(
        name="AI Agent Platform",
        description="Autonomous workflow engine using LangGraph.",
        technologies=["Python", "LangGraph", "FastAPI"],
        bullet_points=["Orchestrated 50+ concurrent agents", "Built streamable MCP integration"],
    )
    assert p2["success"] is True

    # 3. Add Work Experience
    e1 = await add_experience_handler(
        role="Senior Backend Engineer",
        organization="TechCorp",
        location="Remote",
        start_date="2022-01-01",
        bullet_points=["Architected multi-tenant microservices", "Led team of 6 engineers"],
    )
    assert e1["success"] is True
    exp1_id = e1["experience"]["id"]

    e2 = await add_experience_handler(
        role="Software Engineer",
        organization="StartupInc",
        location="San Francisco, CA",
        start_date="2020-06-01",
        end_date="2021-12-31",
        bullet_points=["Built REST APIs with FastAPI", "Implemented CI/CD pipelines"],
    )
    assert e2["success"] is True

    # 4. Add Education
    edu = await add_education_handler(
        degree="B.S. in Computer Science",
        institution="University of California, Berkeley",
        location="Berkeley, CA",
        gpa="3.9",
        coursework=["Distributed Systems", "Algorithms", "Operating Systems"],
    )
    assert edu["success"] is True

    # 5. Add Extracurricular
    extra = await add_extracurricular_handler(
        title="Open Source Contributor",
        organization="FastAPI",
        description="Contributed bug fixes and performance improvements to Starlette / FastAPI ecosystem.",
    )
    assert extra["success"] is True

    # 6. Retrieve Full Profile
    profile_data = await get_profile_handler()
    assert profile_data["counts"]["projects"] == 2
    assert profile_data["counts"]["experiences"] == 2
    assert profile_data["counts"]["education"] == 1
    assert profile_data["counts"]["extracurriculars"] == 1
    assert profile_data["profile"]["full_name"] == "Alex Developer"

    # 7. Check Data Summary
    summary = await list_data_summary_handler()
    assert summary["completeness_score"] >= 80
    assert summary["status"] == "ready"


# ── Readiness & AI Steering Tool Tests ───────────────────────────────────────

@pytest.mark.asyncio
async def test_readiness_gap_detection_and_steering(setup_test_env: User):
    # Empty profile: must be BLOCKED and produce explicit AI steering
    r_empty = await check_readiness_handler(template_id="personal-classic")
    assert r_empty["is_ready"] is False
    assert r_empty["status"] == "BLOCKED"
    assert len(r_empty["blocking_reasons"]) > 0
    assert r_empty["ai_steering"]["recommended_action"] == "PROMPT_USER_FOR_MISSING_DATA"
    assert "DO NOT call generate_resume yet" in r_empty["ai_steering"]["system_directive"]
    assert len(r_empty["ai_steering"]["suggested_questions"]) > 0

    # Populate partial profile (only 1 project when split requires 2)
    await update_profile_handler(full_name="Alex Developer", email="alex@example.com")
    await add_project_handler(name="Portfolio App", technologies=["Next.js"])
    await add_experience_handler(role="Engineer", organization="Acme Inc", bullet_points=["Built web app"])
    await add_experience_handler(role="Intern", organization="Beta Co", bullet_points=["Assisted team"])

    r_partial = await check_readiness_handler(
        template_id="personal-classic",
        content_split={"projects": 2, "experience": 2},
    )
    assert r_partial["is_ready"] is False
    assert any("at least 2 project(s), but only 1 found" in reason for reason in r_partial["blocking_reasons"])
    assert any("You currently have 1 project" in q for q in r_partial["ai_steering"]["suggested_questions"])

    # Add second project: profile now meets requirement -> status READY
    await add_project_handler(name="Chat Server", technologies=["Rust", "Tokio"], bullet_points=["Real-time socket server"])
    r_full = await check_readiness_handler(
        template_id="personal-classic",
        content_split={"projects": 2, "experience": 2},
    )
    assert r_full["is_ready"] is True
    assert r_full["status"] == "READY"
    assert r_full["ai_steering"]["recommended_action"] in ("PROCEED_TO_GENERATE", "PROMPT_OPTIONAL_IMPROVEMENTS_OR_GENERATE")


# ── Surgical Resume Editing Tool Tests ───────────────────────────────────────

@pytest.mark.asyncio
async def test_surgical_resume_editing(setup_test_env: User, monkeypatch):
    user = setup_test_env

    class MockStorage:
        def upload_bytes(self, data, key, content_type):
            return True
    class MockFitResult:
        font_size = 10.5
        page_count = 1
        fits_target = True

    monkeypatch.setattr("src.mcp.tools.editor.StorageService", lambda: MockStorage())
    monkeypatch.setattr("src.mcp.tools.editor.fit_and_render_pdf", lambda **kwargs: (b"%PDF-mock", MockFitResult()))

    # Create a completed generation with tailored resume JSON
    async with get_mcp_db() as db:
        initial_tailored = {
            "summary": "Full stack engineer specializing in Python and React.",
            "skills": {
                "Languages": ["Python", "TypeScript", "SQL"],
                "Frameworks": ["FastAPI", "React", "Next.js"],
            },
            "experiences": [
                {
                    "role": "Senior Engineer",
                    "organization": "TechCorp",
                    "bullet_points": [
                        "Architected scalable backend APIs in FastAPI.",
                        "Optimized database queries for 30% latency reduction.",
                    ],
                }
            ],
            "projects": [
                {
                    "name": "Cloud Storage Sync",
                    "technologies": ["Go", "AWS S3"],
                    "bullet_points": ["Synced 10M files daily."],
                }
            ],
            "education": [],
            "extracurriculars": [],
        }

        gen = Generation(
            user_id=user.id,
            template_id="personal-classic",
            job_description="Senior Backend Developer role requiring FastAPI, AWS, and PostgreSQL.",
            status="completed",
            pdf_storage_key="runs/test-gen-123/resume.pdf",
            render_metadata={
                "tailored_resume": initial_tailored,
                "editor_revision": 0,
                "font_size": 10.5,
                "page_count": 1,
            },
        )
        db.add(gen)
        await db.commit()
        await db.refresh(gen)
        gen_id = str(gen.id)

    # 1. Fetch Resume JSON
    json_data = await get_resume_json_handler(generation_id=gen_id)
    assert json_data["success"] is True
    assert json_data["editor_revision"] == 0
    assert json_data["tailored_resume"]["summary"] == "Full stack engineer specializing in Python and React."

    # 2. Surgically edit a bullet point
    patch_res = await edit_resume_section_handler(
        generation_id=gen_id,
        path="experiences[0].bullet_points[0]",
        operation="set",
        value="Architected event-driven microservices processing 1M events/min using Kafka and FastAPI.",
        expected_revision=0,
    )
    assert patch_res["success"] is True

    # 3. Append a new skill to Languages
    skill_patch = await edit_resume_section_handler(
        generation_id=gen_id,
        path="skills.Languages",
        operation="append",
        value="Rust",
        expected_revision=0,
    )
    assert skill_patch["success"] is True

    # 4. Verify updated staged JSON
    updated_json = await get_resume_json_handler(generation_id=gen_id)
    assert updated_json["tailored_resume"]["experiences"][0]["bullet_points"][0].startswith("Architected event-driven microservices")
    assert "Rust" in updated_json["tailored_resume"]["skills"]["Languages"]

    # 5. Test Preview
    preview_res = await preview_resume_handler(generation_id=gen_id)
    assert preview_res["success"] is True
    assert preview_res["fits_target"] is True

    # 6. Save Edits -> Persists and increments revision
    save_res = await save_resume_edits_handler(generation_id=gen_id, expected_revision=0)
    assert save_res["success"] is True
    assert save_res["editor_revision"] == 1
    assert f"/files/gen/{gen_id}/resume.pdf?t=" in save_res["download_url"]
    assert save_res["resume_json"] is not None

    # 7. Saving with stale revision (0) must fail with REVISION_CONFLICT
    conflict_res = await save_resume_edits_handler(generation_id=gen_id, expected_revision=0)
    assert conflict_res["success"] is False
    assert conflict_res["error_code"] == "REVISION_CONFLICT"

    # 8. Test direct single-step render_resume_handler with custom modified JSON
    custom_json = dict(updated_json["tailored_resume"])
    custom_json["summary"] = "Direct single-step modified executive summary."
    direct_render = await render_resume_handler(generation_id=gen_id, resume_json=custom_json)
    assert direct_render["success"] is True
    assert direct_render["editor_revision"] == 2
    assert direct_render["resume_json"]["summary"] == "Direct single-step modified executive summary."
    assert f"/files/gen/{gen_id}/resume.pdf?t=" in direct_render["download_url"]
# ── Resume Generation & Lifecycle Tool Tests ─────────────────────────────────

@pytest.mark.asyncio
async def test_mcp_resume_generation_lifecycle(setup_test_env: User, monkeypatch):
    user = setup_test_env

    # Mock storage
    class MockStorage:
        def upload_bytes(self, data, key, content_type):
            return True

    monkeypatch.setattr("src.mcp.tools.generation.StorageService", lambda: MockStorage())
    # 1. First test: Gated if profile has insufficient data
    blocked_res = await generate_resume_handler(
        job_description="Backend Engineer requiring Python and FastAPI",
        template_id="personal-classic",
    )
    assert blocked_res["success"] is False
    assert blocked_res["status"] == "blocked"
    assert blocked_res["error_code"] == "INSUFFICIENT_PROFILE_DATA"

    # 2. Populate profile with required entries (2 experiences, 2 projects)
    await update_profile_handler(
        full_name="Alex Developer",
        email="alex@example.com",
        summary="Senior Backend Engineer",
    )
    await add_project_handler(
        name="Resumer Engine",
        technologies=["Python", "FastAPI"],
        bullet_points=["Built async pipeline."],
    )
    await add_project_handler(
        name="Distributed Queue",
        technologies=["Go", "Redis"],
        bullet_points=["Handled 50k msgs/sec."],
    )
    await add_experience_handler(
        role="Lead Backend Engineer",
        organization="CloudScale",
        bullet_points=["Architected microservices."],
    )
    await add_experience_handler(
        role="Software Engineer",
        organization="StartupLab",
        bullet_points=["Built REST APIs."],
    )

    # 3. Mock trigger_pipeline to asynchronously mark generation completed
    async def mock_trigger_pipeline(gen_id: str):
        async def _finish_gen():
            await asyncio.sleep(0.05)
            async with get_mcp_db() as db:
                res = await db.execute(select(Generation).where(Generation.id == uuid.UUID(gen_id)))
                g = res.scalar_one_or_none()
                if g:
                    g.status = "completed"
                    g.job_title = "Backend Engineer"
                    g.company = "TechCorp"
                    g.pdf_storage_key = f"runs/{gen_id}/resume.pdf"
                    g.render_metadata = {
                        "page_count": 1,
                        "fit_warning": False,
                        "tailored_resume": {"summary": "Generated resume summary"},
                    }
                    db.add(GenerationLog(generation_id=g.id, node_name="save_artifacts", message="Done"))
                    await db.commit()
        import asyncio
        return asyncio.create_task(_finish_gen())

    monkeypatch.setattr("src.mcp.tools.generation.trigger_pipeline", mock_trigger_pipeline)

    # 4. Test generate_resume_handler with wait_for_completion=True (default)
    gen_res = await generate_resume_handler(
        job_description="Backend Engineer requiring Python and FastAPI",
        template_id="personal-classic",
        wait_for_completion=True,
        timeout_seconds=5,
    )
    assert gen_res["success"] is True
    assert gen_res["status"] == "completed"
    assert gen_res["job_title"] == "Backend Engineer"
    assert f"/files/gen/{gen_res['generation_id']}/resume.pdf?t=" in gen_res["download_url"]
    assert gen_res["resume_json"]["summary"] == "Generated resume summary"
    gen_id = gen_res["generation_id"]

    # 5. Test get_generation_status_handler on completed generation
    status_res = await get_generation_status_handler(generation_id=gen_id, wait_for_completion=False)
    assert status_res["success"] is True
    assert status_res["status"] == "completed"
    assert status_res["progress_percent"] == 100
    assert f"/files/gen/{gen_id}/resume.pdf?t=" in status_res["download_url"]
    assert status_res["resume_json"]["summary"] == "Generated resume summary"

    # 6. Test download_resume_handler
    dl_res = await download_resume_handler(generation_id=gen_id)
    assert dl_res["success"] is True
    assert f"/files/gen/{gen_id}/resume.pdf?t=" in dl_res["download_url"]
    assert dl_res["resume_json"]["summary"] == "Generated resume summary"
    # 7. Test generate_resume_handler with wait_for_completion=False
    async def mock_trigger_no_op(gen_id: str):
        import asyncio
        async def _noop():
            pass
        return asyncio.create_task(_noop())
    monkeypatch.setattr("src.mcp.tools.generation.trigger_pipeline", mock_trigger_no_op)

    async_res = await generate_resume_handler(
        job_description="Backend Engineer requiring Python and FastAPI",
        template_id="personal-classic",
        wait_for_completion=False,
    )
    assert async_res["success"] is True
    assert async_res["status"] == "in_progress"
    assert async_res["poll_tool"] == "get_generation_status"

@pytest.mark.asyncio
async def test_mcp_generation_failure_and_timeout(setup_test_env: User, monkeypatch):
    user = setup_test_env

    # Ensure profile has data
    await update_profile_handler(full_name="Alex Dev", email="alex@dev.com", summary="Engineer")
    await add_project_handler(name="Proj1", bullet_points=["A"])
    await add_project_handler(name="Proj2", bullet_points=["B"])
    await add_experience_handler(role="Role1", organization="Org1", bullet_points=["C"])
    await add_experience_handler(role="Role2", organization="Org2", bullet_points=["D"])

    # 1. Pipeline failure simulation
    async def mock_trigger_fail(gen_id: str):
        import asyncio
        async def _fail():
            await asyncio.sleep(0.05)
            async with get_mcp_db() as db:
                res = await db.execute(select(Generation).where(Generation.id == uuid.UUID(gen_id)))
                g = res.scalar_one_or_none()
                if g:
                    g.status = "failed"
                    g.error_message = "LLM rate limit exceeded"
                    await db.commit()
        return asyncio.create_task(_fail())

    monkeypatch.setattr("src.mcp.tools.generation.trigger_pipeline", mock_trigger_fail)

    fail_res = await generate_resume_handler(
        job_description="Senior Engineer",
        template_id="personal-classic",
        wait_for_completion=True,
        timeout_seconds=5,
    )
    assert fail_res["success"] is False
    assert fail_res["status"] == "failed"
    assert "LLM rate limit exceeded" in fail_res["error_message"]

    # 2. Pipeline timeout simulation
    async def mock_trigger_slow(gen_id: str):
        import asyncio
        async def _slow():
            await asyncio.sleep(10)
        return asyncio.create_task(_slow())

    monkeypatch.setattr("src.mcp.tools.generation.trigger_pipeline", mock_trigger_slow)

    timeout_res = await generate_resume_handler(
        job_description="Senior Engineer",
        template_id="personal-classic",
        wait_for_completion=True,
        timeout_seconds=1,  # Short timeout for test
    )
    assert timeout_res["success"] is True
    assert timeout_res["status"] == "pending" or timeout_res["status"] == "in_progress"
    assert timeout_res["poll_tool"] == "get_generation_status"
