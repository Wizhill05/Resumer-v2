import io
import json
import sqlite3
import uuid
import pytest
from httpx import ASGITransport, AsyncClient

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))
sqlite3.register_adapter(list, json.dumps)

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.types import ARRAY
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "JSON"

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

from src.core.database import get_db
from src.core.file_links import generate_file_token
from src.main import app
from src.models.generation import Generation
from src.models.profile import Profile
from src.models.user import Base, User


@pytest.fixture
async def files_test_env():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    # Seed test user and completed generation
    async with session_factory() as session:
        user = User(
            id=uuid.uuid4(),
            email="developer@example.com",
            name="Alex Dev",
            provider="github",
        )
        session.add(user)

        profile = Profile(
            user_id=user.id,
            full_name="Alex Dev",
            email="developer@example.com",
            location="San Francisco, CA",
        )
        session.add(profile)

        gen = Generation(
            id=uuid.uuid4(),
            user_id=user.id,
            template_id="personal-classic",
            job_description="Staff Engineer",
            job_title="Software Engineer",
            company="Google",
            status="completed",
            pdf_storage_key="runs/test-gen/resume.pdf",
            render_metadata={
                "font_size": 10.5,
                "page_count": 1,
                "tailored_resume": {
                    "summary": "Experienced engineer.",
                    "skills": {"Languages": ["Python", "TypeScript"]},
                    "experiences": [],
                    "projects": [],
                    "education": [],
                },
            },
        )
        session.add(gen)
        await session.commit()
        await session.refresh(gen)

    yield {"user": user, "generation": gen, "session_factory": session_factory}

    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.mark.asyncio
async def test_get_resume_pdf_r2_streaming(files_test_env, monkeypatch):
    gen = files_test_env["generation"]
    gen_id = str(gen.id)
    token = generate_file_token(gen_id, kind="resume")

    # Mock R2 Storage
    class MockBody:
        def read(self, chunk_size):
            if not hasattr(self, "_read_done"):
                self._read_done = True
                return b"%PDF-1.4 Mock Streamed PDF Content"
            return b""

    class MockStorage:
        enabled = True
        s3_client = type("MockS3", (), {
            "get_object": staticmethod(lambda Bucket, Key: {"Body": MockBody()})
        })()
        def file_exists(self, key):
            return True

    monkeypatch.setattr("src.api.files.StorageService", lambda: MockStorage())

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # 1. Inline stream
        res = await client.get(f"/files/gen/{gen_id}/resume.pdf?t={token}")
        assert res.status_code == 200
        assert res.headers["content-type"] == "application/pdf"
        assert 'inline; filename="Resume_Google_Software_Engineer.pdf"' in res.headers["content-disposition"]
        assert res.headers["referrer-policy"] == "no-referrer"
        assert res.content == b"%PDF-1.4 Mock Streamed PDF Content"

        # 2. Attachment download (?dl=1)
        dl_res = await client.get(f"/files/gen/{gen_id}/resume.pdf?t={token}&dl=1")
        assert dl_res.status_code == 200
        assert 'attachment; filename="Resume_Google_Software_Engineer.pdf"' in dl_res.headers["content-disposition"]


@pytest.mark.asyncio
async def test_get_resume_pdf_chatgpt_utm_tracking_parameters(files_test_env, monkeypatch):
    gen = files_test_env["generation"]
    gen_id = str(gen.id)
    token = generate_file_token(gen_id, kind="resume")

    class MockBody:
        def read(self, chunk_size):
            if not hasattr(self, "_read_done"):
                self._read_done = True
                return b"%PDF-1.4 Content"
            return b""

    class MockStorage:
        enabled = True
        s3_client = type("MockS3", (), {
            "get_object": staticmethod(lambda Bucket, Key: {"Body": MockBody()})
        })()
        def file_exists(self, key):
            return True

    monkeypatch.setattr("src.api.files.StorageService", lambda: MockStorage())

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Appending utm_source from ChatGPT must NOT break token validation
        url = f"/files/gen/{gen_id}/resume.pdf?t={token}&utm_source=chatgpt.com&utm_medium=ai_referral"
        res = await client.get(url)
        assert res.status_code == 200
        assert res.headers["content-type"] == "application/pdf"


@pytest.mark.asyncio
async def test_get_resume_pdf_invalid_token_forbidden(files_test_env):
    gen = files_test_env["generation"]
    gen_id = str(gen.id)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # Missing token
        res_no_token = await client.get(f"/files/gen/{gen_id}/resume.pdf")
        assert res_no_token.status_code == 403

        # Tampered token
        res_bad_token = await client.get(f"/files/gen/{gen_id}/resume.pdf?t=9999999999.invalidhexsignature")
        assert res_bad_token.status_code == 403


@pytest.mark.asyncio
async def test_get_resume_pdf_expired_token(files_test_env):
    gen = files_test_env["generation"]
    gen_id = str(gen.id)
    # Expired 1 hour ago
    expired_token = generate_file_token(gen_id, kind="resume", expires_in_hours=-1)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        res = await client.get(f"/files/gen/{gen_id}/resume.pdf?t={expired_token}")
        assert res.status_code == 403


@pytest.mark.asyncio
async def test_get_resume_pdf_invalid_uuid(files_test_env):
    token = generate_file_token("not-a-valid-uuid", kind="resume")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        res = await client.get(f"/files/gen/not-a-valid-uuid/resume.pdf?t={token}")
        assert res.status_code == 400


@pytest.mark.asyncio
async def test_get_resume_pdf_not_found(files_test_env):
    missing_id = str(uuid.uuid4())
    token = generate_file_token(missing_id, kind="resume")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        res = await client.get(f"/files/gen/{missing_id}/resume.pdf?t={token}")
        assert res.status_code == 404
