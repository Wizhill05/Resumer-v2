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
from src.mcp.tools.editor import detect_orphans_handler
from src.models.generation import Generation, GenerationLog, UserCreditOverride, UserRateLimit
from src.models.profile import Profile
from src.models.user import Base, User
from src.services.resume_render import detect_resume_orphans

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def setup_orphan_test_env(monkeypatch):
    engine = create_async_engine(TEST_DB_URL, echo=False)
    tables = [
        User.__table__,
        Profile.__table__,
        Generation.__table__,
        GenerationLog.__table__,
        UserRateLimit.__table__,
        UserCreditOverride.__table__,
    ]
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, tables=tables))

    session_maker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def mock_get_mcp_db():
        async with session_maker() as s:
            yield s

    monkeypatch.setattr("src.mcp.context.AsyncSessionLocal", session_maker)
    monkeypatch.setattr("src.mcp.context.get_mcp_db", mock_get_mcp_db)
    monkeypatch.setattr("src.core.database.AsyncSessionLocal", session_maker)

    async with session_maker() as db:
        test_user = User(
            email="orphan_tester@example.com",
            name="Jane Developer",
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


@pytest.mark.asyncio
async def test_detect_resume_orphans_service_mocked(monkeypatch):
    """Test detect_resume_orphans service parsing WeasyPrint doc."""
    profile = {
        "full_name": "Jane Developer",
        "email": "jane@example.com",
    }
    resume = {
        "summary": "Full stack engineer building scalable distributed systems.",
        "skills": {"Languages": ["Python", "Rust", "TypeScript"]},
        "experiences": [
            {
                "role": "Senior Engineer",
                "organization": "Acme Corp",
                "start_date": "2022",
                "end_date": "Present",
                "bullet_points": [
                    "Engineered high-throughput indexing pipeline processing 10k events/sec.",
                ],
            }
        ],
        "projects": [
            {
                "name": "Resumer Project",
                "technologies": ["FastAPI", "PostgreSQL"],
                "bullet_points": [
                    "Built microservice architecture reducing overall API response latency.",
                ],
            }
        ],
    }

    # Run orphan detection
    result = detect_resume_orphans(
        template_id="personal-classic",
        profile=profile,
        resume=resume,
    )

    assert result["success"] is True
    assert "page_count" in result
    assert "target_pages" in result
    assert "fits_target" in result
    assert "has_orphans" in result
    assert "actionable_instructions_for_ai" in result


@pytest.mark.asyncio
async def test_mcp_detect_orphans_handler(setup_orphan_test_env: User):
    """Test detect_orphans_handler on stored generation and candidate override."""
    user = setup_orphan_test_env

    # 1. Create a completed generation record in DB
    gen_id = uuid.uuid4()
    async with get_mcp_db() as db:
        gen = Generation(
            id=gen_id,
            user_id=user.id,
            template_id="personal-classic",
            job_description="Seeking a Senior Software Architect for distributed caching systems.",
            job_title="Software Architect",
            company="TechCorp",
            status="completed",
            render_metadata={
                "editor_revision": 1,
                "font_size": 10.0,
                "page_count": 1,
                "tailored_resume": {
                    "summary": "Backend specialist with 8 years of distributed systems experience.",
                    "skills": {"Languages": ["Go", "Python", "SQL"]},
                    "experiences": [
                        {
                            "role": "Lead Architect",
                            "organization": "TechCorp",
                            "start_date": "2020",
                            "end_date": "Present",
                            "bullet_points": [
                                "Architected global distributed cache reducing database read IOPS by **45%** across 20 nodes.",
                            ],
                        }
                    ],
                    "projects": [],
                },
            },
        )
        db.add(gen)
        await db.commit()
    # 2. Test detect_orphans on stored state
    res_stored = await detect_orphans_handler(generation_id=str(gen_id))
    assert res_stored["success"] is True
    assert res_stored["generation_id"] == str(gen_id)
    assert res_stored["target_pages"] == 1
    assert "actionable_instructions_for_ai" in res_stored

    # 3. Test detect_orphans with candidate in-memory resume_json override (adding project)
    candidate_resume = {
        "summary": "Updated backend specialist summary.",
        "skills": {"Languages": ["Go", "Python", "Rust"]},
        "experiences": [
            {
                "role": "Lead Architect",
                "organization": "TechCorp",
                "start_date": "2020",
                "end_date": "Present",
                "bullet_points": [
                    "Architected global distributed cache reducing database read IOPS by **45%** across 20 nodes.",
                ],
            }
        ],
        "projects": [
            {
                "name": "New Scalable Ingestion Engine",
                "technologies": ["Rust", "Kafka"],
                "bullet_points": [
                    "Built streaming data pipeline processing over **100k events/sec** with sub-millisecond p99 latency.",
                ],
            }
        ],
    }

    res_candidate = await detect_orphans_handler(
        generation_id=str(gen_id),
        resume_json=candidate_resume,
    )
    assert res_candidate["success"] is True
    assert res_candidate["generation_id"] == str(gen_id)
    assert "orphans" in res_candidate
