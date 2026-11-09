import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.types import ARRAY

from src.models.generation import (
    FeedbackRating,
    Generation,
    GenerationLog,
    GenerationNodeMetric,
    GuestRateLimit,
    SupportReport,
)
from src.models.user import Base, User
from src.services import guest_cleanup

sqlite3.register_adapter(uuid.UUID, lambda u: str(u))
sqlite3.register_converter("GUID", lambda b: uuid.UUID(b.decode()))
sqlite3.register_adapter(list, json.dumps)
sqlite3.register_adapter(dict, json.dumps)


@compiles(ARRAY, "sqlite")
def compile_array_sqlite(type_, compiler, **kw):
    return "JSON"


@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"


NOW = datetime(2026, 11, 9, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
async def db_session(monkeypatch):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    tables = [
        User.__table__,
        Generation.__table__,
        GenerationLog.__table__,
        GenerationNodeMetric.__table__,
        GuestRateLimit.__table__,
        SupportReport.__table__,
        FeedbackRating.__table__,
    ]
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=tables))
    async with sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


def _mock_storage(monkeypatch, *, enabled=True, fail_keys=()):
    storage = Mock()
    storage.enabled = enabled
    calls: list[str] = []

    def _delete(key):
        calls.append(key)
        if key in fail_keys:
            raise RuntimeError("synthetic R2 failure")
        return True

    storage.delete_file.side_effect = _delete
    monkeypatch.setattr(guest_cleanup, "StorageService", lambda: storage)
    return storage, calls


async def _make_user(db, email="guest-owner@example.com"):
    user = User(email=email, name="Owner")
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_generation(db, user, *, expires_at, is_guest=True, **kwargs):
    gen = Generation(
        user_id=user.id,
        template_id="personal-classic",
        job_description="Engineer role",
        status="completed",
        is_guest=is_guest,
        guest_token_hash=kwargs.pop("guest_token_hash", "tok-hash"),
        guest_input_snapshot={"profile": {"full_name": "Test"}},
        expires_at=expires_at,
        **kwargs,
    )
    db.add(gen)
    await db.commit()
    await db.refresh(gen)
    return gen


async def test_expired_guest_deleted_with_logs_and_storage(db_session, monkeypatch):
    _mock_storage(monkeypatch)
    user = await _make_user(db_session)
    expired = await _make_generation(
        db_session,
        user,
        expires_at=NOW - timedelta(days=8),
        pdf_storage_key="runs/expired/resume.pdf",
        md_storage_key="runs/expired/resume.md",
        thumb_storage_key="runs/expired/thumb.png",
    )
    db_session.add_all(
        [
            GenerationLog(generation_id=expired.id, message="step 1"),
            GenerationLog(generation_id=expired.id, message="done"),
        ]
    )
    await db_session.commit()

    counts = await guest_cleanup.purge_expired_guest_data(db_session, now=NOW)
    assert counts["generations_deleted"] == 1
    assert counts["storage_objects_deleted"] == 3

    assert await db_session.get(Generation, expired.id) is None
    logs = (await db_session.execute(select(GenerationLog).where(GenerationLog.generation_id == expired.id))).scalars().all()
    assert logs == []


async def test_storage_delete_called_for_non_null_keys_only(db_session, monkeypatch):
    storage, calls = _mock_storage(monkeypatch)
    user = await _make_user(db_session)
    gen = await _make_generation(
        db_session,
        user,
        expires_at=NOW - timedelta(days=8),
        pdf_storage_key="runs/a/resume.pdf",
        md_storage_key=None,
        thumb_storage_key="runs/a/thumb.png",
    )

    await guest_cleanup.purge_expired_guest_data(db_session, now=NOW)
    assert set(calls) == {"runs/a/resume.pdf", "runs/a/thumb.png"}
    assert len(calls) == 2
    assert await db_session.get(Generation, gen.id) is None


async def test_storage_disabled_skips_deletes_but_still_deletes_rows(db_session, monkeypatch):
    _mock_storage(monkeypatch, enabled=False)
    user = await _make_user(db_session)
    gen = await _make_generation(
        db_session,
        user,
        expires_at=NOW - timedelta(days=8),
        pdf_storage_key="runs/a/resume.pdf",
    )
    counts = await guest_cleanup.purge_expired_guest_data(db_session, now=NOW)
    assert counts["generations_deleted"] == 1
    assert counts["storage_objects_deleted"] == 0
    assert await db_session.get(Generation, gen.id) is None


async def test_unexpired_guest_kept(db_session, monkeypatch):
    _mock_storage(monkeypatch)
    user = await _make_user(db_session)
    fresh = await _make_generation(
        db_session,
        user,
        expires_at=NOW + timedelta(days=1),
        pdf_storage_key="runs/fresh/resume.pdf",
    )
    counts = await guest_cleanup.purge_expired_guest_data(db_session, now=NOW)
    assert counts["generations_deleted"] == 0
    remaining = await db_session.get(Generation, fresh.id)
    assert remaining is not None
    assert remaining.pdf_storage_key == "runs/fresh/resume.pdf"


async def test_claimed_row_and_null_expires_kept(db_session, monkeypatch):
    _mock_storage(monkeypatch)
    user = await _make_user(db_session)
    claimed = await _make_generation(
        db_session,
        user,
        expires_at=None,
        is_guest=False,
        guest_token_hash=None,
        pdf_storage_key="runs/claimed/resume.pdf",
    )
    no_expiry_guest = await _make_generation(
        db_session,
        user,
        expires_at=None,
        is_guest=True,
        pdf_storage_key="runs/noexpiry/resume.pdf",
    )
    counts = await guest_cleanup.purge_expired_guest_data(db_session, now=NOW)
    assert counts["generations_deleted"] == 0
    assert await db_session.get(Generation, claimed.id) is not None
    assert await db_session.get(Generation, no_expiry_guest.id) is not None


async def test_old_rate_limit_rows_pruned_fresh_kept(db_session, monkeypatch):
    _mock_storage(monkeypatch)
    db_session.add_all(
        [
            GuestRateLimit(token_hash="old", request_count=5, reset_at=NOW - timedelta(days=2)),
            GuestRateLimit(token_hash="recent", request_count=1, reset_at=NOW - timedelta(hours=2)),
            GuestRateLimit(token_hash="active", request_count=1, reset_at=NOW + timedelta(hours=1)),
        ]
    )
    await db_session.commit()

    counts = await guest_cleanup.purge_expired_guest_data(db_session, now=NOW)
    assert counts["rate_limits_deleted"] >= 1
    remaining = {row.token_hash for row in (await db_session.execute(select(GuestRateLimit))).scalars().all()}
    assert "old" not in remaining
    assert {"recent", "active"} <= remaining


async def test_support_report_and_feedback_unlinked_not_deleted(db_session, monkeypatch):
    _mock_storage(monkeypatch)
    user = await _make_user(db_session)
    gen = await _make_generation(db_session, user, expires_at=NOW - timedelta(days=8))
    report = SupportReport(user_id=user.id, message="help", generation_id=gen.id)
    rating = FeedbackRating(user_id=user.id, generation_id=gen.id, star_rating=5)
    metric = GenerationNodeMetric(generation_id=gen.id, node_name="draft", provider="test", status="ok")
    db_session.add_all([report, rating, metric])
    await db_session.commit()

    await guest_cleanup.purge_expired_guest_data(db_session, now=NOW)

    assert await db_session.get(Generation, gen.id) is None
    report = await db_session.get(SupportReport, report.id)
    assert report is not None
    assert report.generation_id is None
    rating = await db_session.get(FeedbackRating, rating.id)
    assert rating is not None
    assert rating.generation_id is None
    metrics = (await db_session.execute(select(GenerationNodeMetric))).scalars().all()
    assert metrics == []


async def test_storage_failure_does_not_block_delete(db_session, monkeypatch):
    _mock_storage(monkeypatch, fail_keys=("runs/a/resume.pdf",))
    user = await _make_user(db_session)
    gen = await _make_generation(
        db_session,
        user,
        expires_at=NOW - timedelta(days=8),
        pdf_storage_key="runs/a/resume.pdf",
        md_storage_key="runs/a/resume.md",
    )
    counts = await guest_cleanup.purge_expired_guest_data(db_session, now=NOW)
    assert counts["generations_deleted"] == 1
    assert await db_session.get(Generation, gen.id) is None


async def test_batching_deletes_all_expired(db_session, monkeypatch):
    _mock_storage(monkeypatch)
    user = await _make_user(db_session)
    for _ in range(3):
        await _make_generation(db_session, user, expires_at=NOW - timedelta(days=8))
    counts = await guest_cleanup.purge_expired_guest_data(db_session, now=NOW, batch_size=1)
    assert counts["generations_deleted"] == 3
    assert (await db_session.execute(select(Generation))).scalars().all() == []
