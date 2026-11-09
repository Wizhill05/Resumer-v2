"""Guest trial works without a consent cookie (consent gate removed)."""

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
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

from src.api.guest import _hash_token, guest_quota, router  # noqa: E402
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
        monkeypatch.setattr("src.api.guest.extract_upload_text", AsyncMock(return_value="fake resume text"))
        monkeypatch.setattr("src.api.guest.run_guest_import_task", AsyncMock(return_value=None))
        async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as test_client:
            yield test_client, trigger, db, engine
    await engine.dispose()


async def test_generate_without_consent_cookie_succeeds(client):
    test_client, trigger, *_ = client
    response = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert response.status_code == 200, response.text
    assert response.json()["id"]
    assert "resumer_guest_token" in response.headers.get("set-cookie", "")
    trigger.assert_awaited_once()
    # expires_at populated
    assert "expires_at" in response.json()
    assert response.json()["expires_at"] is not None


async def test_import_start_without_consent_cookie_succeeds(client):
    test_client, *_ = client
    files = [("files", ("resume.pdf", b"%PDF-1.4 fake", "application/pdf"))]
    response = await test_client.post("/guest/import/start", files=files)
    assert response.status_code == 200, response.text
    assert response.json()["job_id"]
    assert "resumer_guest_token" in response.headers.get("set-cookie", "")


async def test_five_generations_then_sixth_gets_429_object_detail(client):
    test_client, *_ = client
    for _ in range(5):
        r = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
        assert r.status_code == 200, r.text
    r6 = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert r6.status_code == 429, r6.text
    detail = r6.json()["detail"]
    assert isinstance(detail, dict)
    assert detail["code"] == "guest_quota_exhausted"
    assert detail["limit"] == 5
    assert detail["resets_at"] is not None
    assert "5" in detail["message"]


async def test_failed_generations_dont_count(client):
    test_client, _trigger, db, _engine = client
    r1 = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert r1.status_code == 200, r1.text
    gid = r1.json()["id"]
    # mark it failed directly
    await db.execute(update(Generation).where(Generation.id == uuid.UUID(gid)).values(status="failed"))
    await db.commit()
    # quota should be 0 now
    q = await test_client.get("/guest/quota")
    assert q.status_code == 200, q.text
    assert q.json()["used"] == 0
    assert q.json()["remaining"] == 5
    # so we can still make 5 more
    for _ in range(5):
        r = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
        assert r.status_code == 200, r.text
    # 6th non-failed would be 429
    r6 = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert r6.status_code == 429, r6.text


async def test_pipeline_start_failure_does_not_consume_credit(client, monkeypatch):
    from unittest.mock import AsyncMock
    test_client, trigger, _db, _engine = client
    # make next trigger fail once
    trigger.side_effect = Exception("boom")
    r_fail = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert r_fail.status_code == 502, r_fail.text
    # reset to success
    trigger.side_effect = None
    trigger.return_value = None
    # failed row should not count
    q = await test_client.get("/guest/quota")
    assert q.status_code == 200, q.text
    assert q.json()["used"] == 0
    # 5 more should succeed
    for _ in range(5):
        r = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
        assert r.status_code == 200, r.text
    r6 = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert r6.status_code == 429, r6.text


async def test_rows_older_than_24h_do_not_count(client):
    test_client, _trigger, db, _engine = client
    r1 = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert r1.status_code == 200, r1.text
    gid = r1.json()["id"]
    old_time = datetime.now(timezone.utc) - timedelta(hours=25)
    await db.execute(update(Generation).where(Generation.id == uuid.UUID(gid)).values(created_at=old_time))
    await db.commit()
    q = await test_client.get("/guest/quota")
    assert q.status_code == 200, q.text
    assert q.json()["used"] == 0
    assert q.json()["remaining"] == 5
    assert q.json()["resets_at"] is None


async def test_invalid_request_does_not_consume_credit(client):
    test_client, *_ = client
    # bad content_split
    bad = dict(GENERATE_PAYLOAD)
    bad["content_split"] = {"projects": 99, "experience": 99}
    r_bad = await test_client.post("/guest/generate", json=bad)
    assert r_bad.status_code == 422, r_bad.text
    q = await test_client.get("/guest/quota")
    # quota without cookie? we have cookie from bad request? _guest_token sets cookie even on validation failure? check logic: token minted before validation, so cookie set even on 422. So used still 0.
    assert q.json()["used"] == 0
    # not enough usable entries
    bad2 = dict(GENERATE_PAYLOAD)
    bad2["projects"] = [{"name": "Incomplete"}]
    bad2["experiences"] = [{"role": "Engineer", "organization": "Org", "bullet_points": []}]
    r_bad2 = await test_client.post("/guest/generate", json=bad2)
    assert r_bad2.status_code == 400, r_bad2.text
    q2 = await test_client.get("/guest/quota")
    assert q2.json()["used"] == 0
    # valid still works and is 1
    r_ok = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert r_ok.status_code == 200, r_ok.text
    q3 = await test_client.get("/guest/quota")
    assert q3.json()["used"] == 1


async def test_quota_endpoint_numbers_and_resets_at(client):
    test_client, *_ = client
    # no cookie initially -> used 0? Note: test_client starts without cookie, but first quota call does not mint. So used 0.
    q0 = await test_client.get("/guest/quota")
    assert q0.status_code == 200, q0.text
    assert q0.json() == {"limit": 5, "used": 0, "remaining": 5, "resets_at": None}
    # no set-cookie minted
    assert "resumer_guest_token" not in q0.headers.get("set-cookie", "")

    r1 = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert r1.status_code == 200, r1.text
    r2 = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert r2.status_code == 200, r2.text

    q2 = await test_client.get("/guest/quota")
    assert q2.status_code == 200, q2.text
    body = q2.json()
    assert body["limit"] == 5
    assert body["used"] == 2
    assert body["remaining"] == 3
    assert body["resets_at"] is not None


async def test_claimed_rows_guest_token_hash_none_do_not_count(client):
    test_client, _trigger, db, _engine = client
    # create a valid generation to establish cookie/token
    r1 = await test_client.post("/guest/generate", json=GENERATE_PAYLOAD)
    assert r1.status_code == 200, r1.text
    # extract cookie token hash from DB rows
    rows = (await db.execute(select(Generation))).scalars().all()
    assert len(rows) == 1
    real_hash = rows[0].guest_token_hash
    assert real_hash is not None
    user_id = rows[0].user_id

    # insert claimed row: guest_token_hash None
    claimed = Generation(
        user_id=user_id,
        template_id="personal-classic",
        job_description="Claimed",
        status="completed",
        is_guest=True,
        guest_token_hash=None,
        guest_input_snapshot={"profile": {"full_name": "Test"}},
    )
    db.add(claimed)
    await db.commit()

    q = await test_client.get("/guest/quota")
    assert q.json()["used"] == 1

    # also a non-guest row with same hash should not count (is_guest False)
    non_guest = Generation(
        user_id=user_id,
        template_id="personal-classic",
        job_description="Not guest",
        status="completed",
        is_guest=False,
        guest_token_hash=real_hash,
        guest_input_snapshot={"profile": {"full_name": "Test"}},
    )
    db.add(non_guest)
    await db.commit()

    q2 = await test_client.get("/guest/quota")
    assert q2.json()["used"] == 1


async def test_guest_quota_helper_direct(client):
    _test_client, _trigger, db, _engine = client
    # no token
    quota_none = await guest_quota(None, db)
    assert quota_none == {"limit": 5, "used": 0, "remaining": 5, "resets_at": None}
    # unknown hash
    quota_unknown = await guest_quota(_hash_token("nope"), db)
    assert quota_unknown["used"] == 0
