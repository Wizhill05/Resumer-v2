"""Guest trial abuse limits: IP caps, global cap, Turnstile, import ownership."""

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt
from sqlalchemy import update
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
from src.core.config import settings  # noqa: E402
from src.core.database import get_db  # noqa: E402
from src.models.generation import Generation, SupportRateLimit  # noqa: E402
from src.models.user import Base, User  # noqa: E402
from src.services.import_jobs import import_jobs  # noqa: E402

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

PDF = ("resume.pdf", b"%PDF-1.4 fake", "application/pdf")


def _internal_headers(ip: str, secret: str = "test-internal-secret") -> dict:
    token = jose_jwt.encode(
        {"aud": "internal", "exp": datetime.now(timezone.utc).timestamp() + 60},
        secret,
        algorithm="HS256",
    )
    return {"Authorization": f"Bearer {token}", "X-Client-IP": ip}


@pytest.fixture
async def client(monkeypatch):
    import_jobs.clear()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync: Base.metadata.create_all(
                sync, tables=[User.__table__, Generation.__table__, SupportRateLimit.__table__]
            )
        )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        app = FastAPI()
        app.include_router(router)

        async def get_session():
            yield db

        app.dependency_overrides[get_db] = get_session
        # Guests may only have one run in flight, so the fake pipeline
        # finishes each run instantly to let tests start the next one.
        async def finish_run(gen_id):
            await db.execute(update(Generation).where(Generation.id == uuid.UUID(gen_id)).values(status="completed"))
            await db.commit()

        trigger = AsyncMock(side_effect=finish_run)
        monkeypatch.setattr("src.api.guest.trigger_pipeline", trigger)
        monkeypatch.setattr("src.api.guest.extract_upload_text", AsyncMock(return_value="fake resume text"))
        monkeypatch.setattr("src.api.guest.run_guest_import_task", AsyncMock(return_value=None))
        async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as test_client:
            yield test_client, trigger, db, engine
    import_jobs.clear()
    await engine.dispose()


async def _generate(client, payload=None, headers=None):
    return await client.post("/guest/generate", json=dict(payload or GENERATE_PAYLOAD), headers=headers)


async def _import_start(client, headers=None, data=None):
    files = [("files", PDF)]
    kwargs: dict = {"files": files}
    if headers is not None:
        kwargs["headers"] = headers
    if data is not None:
        kwargs["data"] = data
    return await client.post("/guest/import/start", **kwargs)


async def test_generate_ip_limit_triggers_429(client, monkeypatch):
    test_client, *_ = client
    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "test-internal-secret")
    monkeypatch.setattr(settings, "GUEST_GENERATE_DAILY_PER_IP", 3)
    headers = _internal_headers("203.0.113.10")
    statuses = []
    for _ in range(5):
        # Cookieless clients get a fresh token each time, so only the IP
        # bucket can stop them. Clear cookies between calls.
        test_client.cookies.clear()
        resp = await _generate(test_client, headers=headers)
        statuses.append(resp.status_code)
        if resp.status_code == 429:
            detail = resp.json()["detail"]
            assert isinstance(detail, dict)
            assert detail["code"] == "guest_ip_limit"
            assert "network" in detail["message"]
            break
    assert statuses[-1] == 429, statuses


async def test_generate_no_trusted_ip_means_no_ip_limit(client, monkeypatch):
    test_client, *_ = client
    # Even with a tiny IP cap, a spoofed X-Client-IP without a valid internal
    # token is untrusted and must not be charged.
    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "test-internal-secret")
    monkeypatch.setattr(settings, "GUEST_GENERATE_DAILY_PER_IP", 1)
    headers = {"X-Client-IP": "203.0.113.11"}
    for _ in range(3):
        test_client.cookies.clear()
        resp = await _generate(test_client, headers=headers)
        assert resp.status_code == 200, resp.text


async def test_generate_global_cap_returns_503(client, monkeypatch):
    test_client, *_ = client
    monkeypatch.setattr(settings, "GUEST_DAILY_GLOBAL_CAP", 3)
    # Keep per-IP out of the way: no trusted IP, so it is skipped. Per-token
    # quota is 5, so the global cap (3) trips first.
    for _ in range(3):
        test_client.cookies.clear()
        resp = await _generate(test_client)
        assert resp.status_code == 200, resp.text
    test_client.cookies.clear()
    resp = await _generate(test_client)
    assert resp.status_code == 503, resp.text
    detail = resp.json()["detail"]
    assert isinstance(detail, dict)
    assert detail["code"] == "guest_trial_busy"
    assert "busy" in detail["message"]


async def test_turnstile_failure_returns_403(client, monkeypatch):
    test_client, *_ = client
    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "test-secret")
    monkeypatch.setattr(settings, "GUEST_TURNSTILE_REQUIRED", True)
    monkeypatch.setattr(
        "src.api.guest.verify_turnstile",
        AsyncMock(side_effect=HTTPException(422, "Please complete the human check and try again")),
    )
    payload = dict(GENERATE_PAYLOAD)
    payload["turnstile_token"] = "bad-token"
    resp = await _generate(test_client, payload=payload)
    assert resp.status_code == 403, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "turnstile_failed"
    assert detail["message"] == "Please complete the security check and try again."


async def test_turnstile_skipped_when_not_configured(client, monkeypatch):
    test_client, *_ = client
    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "")
    monkeypatch.setattr(settings, "GUEST_TURNSTILE_REQUIRED", True)
    verify = AsyncMock(side_effect=HTTPException(422, "should not run"))
    monkeypatch.setattr("src.api.guest.verify_turnstile", verify)
    resp = await _generate(test_client)
    assert resp.status_code == 200, resp.text
    verify.assert_not_awaited()


async def test_turnstile_skipped_when_not_required(client, monkeypatch):
    test_client, *_ = client
    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "test-secret")
    monkeypatch.setattr(settings, "GUEST_TURNSTILE_REQUIRED", False)
    verify = AsyncMock(side_effect=HTTPException(422, "should not run"))
    monkeypatch.setattr("src.api.guest.verify_turnstile", verify)
    resp = await _generate(test_client)
    assert resp.status_code == 200, resp.text
    verify.assert_not_awaited()


async def test_turnstile_success_allows_generate(client, monkeypatch):
    test_client, *_ = client
    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "test-secret")
    monkeypatch.setattr(settings, "GUEST_TURNSTILE_REQUIRED", True)
    verify = AsyncMock(return_value=None)
    monkeypatch.setattr("src.api.guest.verify_turnstile", verify)
    payload = dict(GENERATE_PAYLOAD)
    payload["turnstile_token"] = "good-token"
    resp = await _generate(test_client, payload=payload)
    assert resp.status_code == 200, resp.text
    verify.assert_awaited_once()


async def test_turnstile_runs_after_cheap_validation(client, monkeypatch):
    test_client, *_ = client
    monkeypatch.setattr(settings, "TURNSTILE_SECRET_KEY", "test-secret")
    monkeypatch.setattr(settings, "GUEST_TURNSTILE_REQUIRED", True)
    verify = AsyncMock(side_effect=HTTPException(422, "should not run"))
    monkeypatch.setattr("src.api.guest.verify_turnstile", verify)
    bad = dict(GENERATE_PAYLOAD)
    bad["content_split"] = {"projects": 99, "experience": 99}
    bad["turnstile_token"] = "bad-token"
    resp = await test_client.post("/guest/generate", json=bad)
    assert resp.status_code == 422, resp.text
    verify.assert_not_awaited()


@pytest.mark.parametrize(
    "path,kwargs",
    [
        ("/guest/import/parse", {"files": [("files", PDF)]}),
        ("/guest/import/extract", {"json": {"texts": ["hello world"], "filenames": ["a"]}}),
        ("/guest/import/resumes", {"files": [("files", PDF)]}),
    ],
)
async def test_removed_import_endpoints_are_gone(client, path, kwargs):
    test_client, *_ = client
    resp = await test_client.post(path, **kwargs)
    assert resp.status_code in (404, 405), resp.text


async def test_import_status_requires_owner_cookie(client):
    test_client, *_ = client
    resp = await _import_start(test_client)
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]

    owner_resp = await test_client.get(f"/guest/import/status/{job_id}")
    assert owner_resp.status_code == 200, owner_resp.text
    assert "token_hash" not in owner_resp.json()

    test_client.cookies.clear()
    stranger = await test_client.get(f"/guest/import/status/{job_id}", cookies={"resumer_guest_token": "someone-else"})
    assert stranger.status_code == 404, stranger.text

    test_client.cookies.clear()
    anon = await test_client.get(f"/guest/import/status/{job_id}")
    assert anon.status_code == 404, anon.text


async def test_import_per_token_limit(client, monkeypatch):
    test_client, *_ = client
    monkeypatch.setattr(settings, "GUEST_IMPORT_DAILY_PER_TOKEN", 2)
    # Same cookie jar across calls: the per-token bucket accumulates.
    statuses = []
    for _ in range(4):
        resp = await _import_start(test_client)
        statuses.append(resp.status_code)
        if resp.status_code == 429:
            break
    assert statuses[-1] == 429, statuses


async def test_exhausted_token_does_not_burn_ip_slots(client, monkeypatch):
    test_client, _trigger, db, _engine = client
    monkeypatch.setattr(settings, "INTERNAL_API_SECRET", "test-internal-secret")
    monkeypatch.setattr(settings, "GUEST_GENERATE_DAILY_PER_IP", 100)
    headers = _internal_headers("203.0.113.40")
    for _ in range(5):
        resp = await _generate(test_client, headers=headers)
        assert resp.status_code == 200, resp.text
    for _ in range(3):
        resp = await _generate(test_client, headers=headers)
        assert resp.status_code == 429, resp.text
        assert resp.json()["detail"]["code"] == "guest_quota_exhausted"
    bucket = await db.get(SupportRateLimit, "guest-ip:203.0.113.40:generate")
    assert bucket is not None
    assert bucket.request_count == 5
