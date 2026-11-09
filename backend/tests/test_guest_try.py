"""Guest trial works without a consent cookie (consent gate removed)."""

import json
import sqlite3
import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.types import ARRAY

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))
sqlite3.register_adapter(list, json.dumps)


@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "JSON"


@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"


from src.api.guest import router  # noqa: E402
from src.core.database import get_db  # noqa: E402
from src.models.generation import Generation  # noqa: E402
from src.models.user import Base, User  # noqa: E402

GENERATE_PAYLOAD = {
    "template_id": "personal-classic",
    "job_description": "Senior engineer to build distributed systems. " * 20,
    "content_split": {"projects": 2, "experience": 2},
    "profile": {"full_name": "Test User"},
    "experiences": [
        {"role": "Engineer", "organization": "Acme", "bullet_points": ["Built X"]},
        {"role": "Senior Engineer", "organization": "Beta", "bullet_points": ["Led Y"]},
    ],
    "projects": [
        {"name": "App One", "description": "Does thing"},
        {"name": "App Two", "description": "Does other thing"},
    ],
    "education": [],
    "extracurriculars": [],
}


@pytest.fixture
async def client(monkeypatch):
    from unittest.mock import AsyncMock

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[User.__table__, Generation.__table__]))
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        app = FastAPI()
        app.include_router(router)

        async def get_session():
            yield db

        app.dependency_overrides[get_db] = get_session
        trigger = AsyncMock(return_value=None)
        monkeypatch.setattr("src.api.guest.trigger_pipeline", trigger)
        monkeypatch.setattr("src.api.guest._check_guest_rate_limit", AsyncMock(return_value=None))
        monkeypatch.setattr("src.api.guest.extract_upload_text", AsyncMock(return_value="fake resume text"))
        monkeypatch.setattr("src.api.guest.run_guest_import_task", AsyncMock(return_value=None))
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
            yield test_client, trigger
    await engine.dispose()


async def test_generate_without_consent_cookie_succeeds(client):
    test_client, trigger = client
    response = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert response.status_code == 200, response.text
    assert response.json()["id"]
    assert "resumer_guest_token" in response.headers.get("set-cookie", "")
    trigger.assert_awaited_once()


async def test_import_start_without_consent_cookie_succeeds(client):
    test_client, _ = client
    files = [("files", ("resume.pdf", b"%PDF-1.4 fake", "application/pdf"))]
    response = await test_client.post("/guest/import/start", files=files)
    assert response.status_code == 200, response.text
    assert response.json()["job_id"]
    assert "resumer_guest_token" in response.headers.get("set-cookie", "")
