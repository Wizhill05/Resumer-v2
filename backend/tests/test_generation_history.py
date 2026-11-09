"""History list + dashboard summary endpoints (GET /generate/list, /summary)."""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt as jose_jwt
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
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


from src.api import generation as generation_api
from src.core.config import settings
from src.core.database import get_db
from src.main import app
from src.models.generation import Generation
from src.models.user import Base, User

JOB_DESCRIPTION = ("We are hiring a senior engineer to build distributed systems. " * 50)[:3000]
HEAVY_FIELDS = {
    "job_description", "content_split", "section_order", "render_metadata",
    "guest_input_snapshot", "user_id", "model_used", "send_email", "creativity_mode",
}


@pytest.fixture
async def async_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    tables = [User.__table__, Generation.__table__]
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tables))
    async with sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


@pytest.fixture
async def client(async_db):
    async def override_get_db():
        yield async_db

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as ac:
        yield ac
    app.dependency_overrides.clear()


def auth(user) -> dict:
    token = jose_jwt.encode({"sub": str(user.id), "email": user.email}, settings.JWT_SECRET, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


async def make_user(db, email) -> User:
    user = User(email=email, name=email, provider="google", email_verified_at=datetime.now(timezone.utc))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def add_gen(db, user, *, created_at, company="Acme", job_title="Engineer", gen_id=None, **kw) -> Generation:
    gen = Generation(
        id=gen_id or uuid.uuid4(),
        user_id=user.id,
        template_id="personal-classic",
        job_description=JOB_DESCRIPTION,
        job_title=job_title,
        company=company,
        status=kw.pop("status", "completed"),
        created_at=created_at,
        **kw,
    )
    db.add(gen)
    await db.commit()
    return gen


NOW = datetime.now(timezone.utc).replace(microsecond=0)


# ── summary ──────────────────────────────────────────────────────────────────


async def test_summary_values(client, async_db):
    user = await make_user(async_db, "a@example.com")
    other = await make_user(async_db, "b@example.com")
    await add_gen(async_db, user, created_at=NOW - timedelta(days=90), company="Old Co", job_title="Old")
    await add_gen(async_db, user, created_at=NOW - timedelta(hours=30), company="Mid Co", job_title="Mid")
    await add_gen(async_db, user, created_at=NOW - timedelta(hours=1), company="Newest Co", job_title="Newest")
    await add_gen(async_db, other, created_at=NOW, company="Other Co")

    month_start = (NOW - timedelta(days=60)).isoformat()
    res = await client.get("/generate/summary", params={"month_start": month_start}, headers=auth(user))
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 3
    assert body["used_today"] == 1
    assert body["this_month"] == 2  # since month_start: Mid + Newest
    assert body["latest_company"] == "Newest Co"
    assert body["latest_job_title"] == "Newest"
    assert datetime.fromisoformat(body["latest_created_at"]).replace(tzinfo=timezone.utc) == NOW - timedelta(hours=1)


async def test_summary_empty_user(client, async_db):
    user = await make_user(async_db, "empty@example.com")
    res = await client.get("/generate/summary", headers=auth(user))
    assert res.status_code == 200
    assert res.json() == {
        "total": 0, "latest_created_at": None, "latest_company": None,
        "latest_job_title": None, "used_today": 0, "this_month": 0,
    }


async def test_summary_not_swallowed_by_gen_id_route(client, async_db):
    """/summary and /list must resolve to their own handlers, not /{gen_id}
    (which would 500 on uuid.UUID('summary'))."""
    user = await make_user(async_db, "route@example.com")
    for path in ("/generate/summary", "/generate/list"):
        res = await client.get(path, headers=auth(user))
        assert res.status_code == 200, path
    paths = [r.path for r in generation_api.router.routes if r.path.startswith("/generate")]
    assert paths.index("/generate/summary") < paths.index("/generate/{gen_id}")
    assert paths.index("/generate/list") < paths.index("/generate/{gen_id}")


# ── list ─────────────────────────────────────────────────────────────────────


async def test_list_items_are_lightweight_and_include_pdf_version(client, async_db):
    user = await make_user(async_db, "light@example.com")
    await add_gen(
        async_db, user, created_at=NOW,
        render_metadata={"editor_revision": 4, "tailored_resume": {"blob": "x" * 5000}},
        content_split={"projects": 2, "experience": 3},
        section_order=["summary", "experience"],
        guest_input_snapshot={"profile": "x" * 5000},
        thumb_storage_key="thumbs/x.png",
    )
    await add_gen(async_db, user, created_at=NOW - timedelta(minutes=1), render_metadata=None)

    res = await client.get("/generate/list", headers=auth(user))
    assert res.status_code == 200
    page = res.json()
    first, second = page["items"]
    assert set(first) == {
        "id", "template_id", "job_title", "company", "status", "created_at",
        "thumb_storage_key", "pdf_version",
    }
    assert not HEAVY_FIELDS & set(first)
    assert JOB_DESCRIPTION[:40] not in res.text
    assert first["pdf_version"] == 4
    assert first["thumb_storage_key"] == "thumbs/x.png"
    assert second["pdf_version"] == 0
    assert page["total"] == page["unfiltered_total"] == 2
    assert page["next_cursor"] is None


async def test_list_pagination_order_and_boundaries(client, async_db):
    user = await make_user(async_db, "page@example.com")
    ids = []
    for i in range(5):
        gen = await add_gen(async_db, user, created_at=NOW - timedelta(minutes=i), job_title=f"Role {i}")
        ids.append(str(gen.id))

    res = await client.get("/generate/list", params={"limit": 2}, headers=auth(user))
    p1 = res.json()
    assert [i["id"] for i in p1["items"]] == ids[0:2]
    assert p1["next_cursor"]
    assert p1["total"] == 5

    p2 = (await client.get("/generate/list", params={"limit": 2, "cursor": p1["next_cursor"]}, headers=auth(user))).json()
    assert [i["id"] for i in p2["items"]] == ids[2:4]
    assert p2["next_cursor"]

    # Final page has exactly one row left: no next cursor.
    p3 = (await client.get("/generate/list", params={"limit": 2, "cursor": p2["next_cursor"]}, headers=auth(user))).json()
    assert [i["id"] for i in p3["items"]] == ids[4:]
    assert p3["next_cursor"] is None

    # A page that exactly consumes the remaining rows must not advertise another.
    exact = (await client.get("/generate/list", params={"limit": 5}, headers=auth(user))).json()
    assert len(exact["items"]) == 5 and exact["next_cursor"] is None


async def test_list_tie_break_on_identical_created_at(client, async_db):
    user = await make_user(async_db, "tie@example.com")
    expected = sorted((uuid.uuid4() for _ in range(5)), reverse=True)
    for gid in expected:
        await add_gen(async_db, user, created_at=NOW, gen_id=gid)

    seen: list[str] = []
    cursor = None
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = (await client.get("/generate/list", params=params, headers=auth(user))).json()
        seen += [i["id"] for i in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen == [str(g) for g in expected]  # created_at desc, id desc; no dupes/skips


async def test_list_limit_validation_and_bad_cursor(client, async_db):
    user = await make_user(async_db, "val@example.com")
    for params in ({"limit": 0}, {"limit": 101}):
        assert (await client.get("/generate/list", params=params, headers=auth(user))).status_code == 422
    assert (await client.get("/generate/list", params={"limit": 100}, headers=auth(user))).status_code == 200
    assert (await client.get("/generate/list", params={"cursor": "not-a-cursor"}, headers=auth(user))).status_code == 400


async def test_list_search_q(client, async_db):
    user = await make_user(async_db, "search@example.com")
    await add_gen(async_db, user, created_at=NOW, company="Google LLC", job_title="Staff Engineer")
    await add_gen(async_db, user, created_at=NOW - timedelta(minutes=1), company="Stripe", job_title="Infra Lead")
    await add_gen(async_db, user, created_at=NOW - timedelta(minutes=2), company="100%_Real", job_title=None)

    def names(res):
        return [i["company"] for i in res.json()["items"]]

    res = await client.get("/generate/list", params={"q": "  GOOGLE "}, headers=auth(user))
    assert names(res) == ["Google LLC"]
    assert res.json()["total"] == 1 and res.json()["unfiltered_total"] == 3
    assert names(await client.get("/generate/list", params={"q": "lead"}, headers=auth(user))) == ["Stripe"]
    # LIKE wildcards are literal, not patterns.
    assert names(await client.get("/generate/list", params={"q": "%"}, headers=auth(user))) == ["100%_Real"]
    assert names(await client.get("/generate/list", params={"q": "_"}, headers=auth(user))) == ["100%_Real"]
    assert names(await client.get("/generate/list", params={"q": "zzz"}, headers=auth(user))) == []
    # q composes with pagination.
    p1 = (await client.get("/generate/list", params={"q": "e", "limit": 1}, headers=auth(user))).json()
    assert p1["total"] == 3 and p1["next_cursor"]


# ── isolation ────────────────────────────────────────────────────────────────


async def test_user_isolation(client, async_db):
    alice = await make_user(async_db, "alice@example.com")
    bob = await make_user(async_db, "bob@example.com")
    mine = await add_gen(async_db, alice, created_at=NOW, company="Alice Co")
    theirs = await add_gen(async_db, bob, created_at=NOW + timedelta(seconds=1), company="Bob Co")

    page = (await client.get("/generate/list", headers=auth(alice))).json()
    assert [i["id"] for i in page["items"]] == [str(mine.id)]
    assert page["total"] == page["unfiltered_total"] == 1
    searched = (await client.get("/generate/list", params={"q": "Bob"}, headers=auth(alice))).json()
    assert searched["items"] == [] and searched["total"] == 0

    summary = (await client.get("/generate/summary", headers=auth(alice))).json()
    assert summary["total"] == 1 and summary["latest_company"] == "Alice Co"

    legacy = (await client.get("/generate", headers=auth(alice))).json()
    assert [g["id"] for g in legacy] == [str(mine.id)]
    assert str(theirs.id) not in json.dumps([page, summary, legacy])


# ── backward compatibility: GET /generate ────────────────────────────────────


async def test_legacy_list_keeps_full_shape_and_order(client, async_db):
    user = await make_user(async_db, "legacy@example.com")
    old = await add_gen(async_db, user, created_at=NOW - timedelta(days=1), render_metadata={"editor_revision": 2},
                        content_split={"projects": 1, "experience": 2}, section_order=["summary"])
    new = await add_gen(async_db, user, created_at=NOW, render_metadata=None)

    res = await client.get("/generate", headers=auth(user))
    assert res.status_code == 200
    body = res.json()
    assert isinstance(body, list)  # still a bare array, not the paginated envelope
    assert [g["id"] for g in body] == [str(new.id), str(old.id)]
    assert set(body[0]) == {
        "id", "user_id", "template_id", "job_title", "company", "status", "model_used",
        "job_description", "created_at", "completed_at", "thumb_storage_key", "content_split",
        "send_email", "creativity_mode", "section_order", "pdf_version",
    }
    assert body[0]["job_description"] == JOB_DESCRIPTION
    assert body[0]["pdf_version"] == 0
    assert body[1]["pdf_version"] == 2
    assert body[1]["content_split"] == {"projects": 1, "experience": 2}
    assert body[1]["section_order"] == ["summary"]
    assert "render_metadata" not in body[0]

    # Same payload as the single-item endpoint for the same row.
    single = (await client.get(f"/generate/{old.id}", headers=auth(user))).json()
    # (sqlite drops tzinfo on reload, so compare timestamps separately)
    assert {k: v for k, v in single.items() if k != "created_at"} == {
        k: v for k, v in body[1].items() if k != "created_at"
    }


# ── query shape ──────────────────────────────────────────────────────────────


def test_postgres_sql_selects_only_light_columns_and_uses_json_subfield():
    """The list query must not select the JSONB blobs or job_description."""
    from sqlalchemy import select

    stmt = select(
        Generation.id,
        generation_api._editor_revision_col().label("pdf_version"),
    ).where(Generation.user_id == uuid.uuid4()).order_by(Generation.created_at.desc(), Generation.id.desc())
    sql = str(stmt.compile(dialect=postgresql.dialect()))
    assert "render_metadata ->" in sql or "render_metadata #>" in sql
    assert "SELECT generations.id, coalesce(" in sql
    assert "job_description" not in sql and "guest_input_snapshot" not in sql
    assert "ORDER BY generations.created_at DESC, generations.id DESC" in sql
