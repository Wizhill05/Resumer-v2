"""Generic fixed-window rate limiting on the support_rate_limits table.

The table is shared by support and guest trial limits. Keys are namespaced by
callers (``ip:...``, ``guest-cookie:...``, ``guest-ip:...``,
``guest-token:...``) so buckets never collide.
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import case, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.generation import SupportRateLimit

logger = logging.getLogger(__name__)


def insert_for(db: AsyncSession):
    try:
        dialect_name = db.get_bind().dialect.name
    except Exception:
        dialect_name = getattr(getattr(getattr(db, "bind", None), "dialect", None), "name", "postgresql")
    return sqlite_insert if dialect_name == "sqlite" else pg_insert


# Fraction of limiter calls that also prune long-expired buckets.
_RATE_LIMIT_CLEANUP_PROBABILITY = 0.01


async def cleanup_expired_rate_limits(db: AsyncSession, now: datetime) -> None:
    try:
        await db.execute(delete(SupportRateLimit).where(SupportRateLimit.reset_at < now - timedelta(days=1)))
        await db.commit()
    except Exception:
        logger.warning("Rate limit cleanup failed", exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass


async def check_rate_limit(
    db: AsyncSession,
    key: str,
    limit: int,
    window: timedelta,
    friendly: str | dict,
    *,
    cleanup_probability: float | None = None,
) -> None:
    """Increment the bucket for ``key`` and raise 429 when over ``limit``.

    ``window`` is the fixed window length (support uses one hour, guest daily
    limits use 24 hours). ``friendly`` is used as the HTTPException detail, so
    callers may pass a plain message (support) or a ``{"code", "message"}``
    object (guest).
    """
    now = datetime.now(timezone.utc)
    reset_at = now + window
    insert_fn = insert_for(db)
    stmt = (
        insert_fn(SupportRateLimit)
        .values(key=key, request_count=1, reset_at=reset_at)
        .on_conflict_do_update(
            index_elements=[SupportRateLimit.key],
            set_={
                "request_count": case(
                    (SupportRateLimit.reset_at <= now, 1),
                    else_=SupportRateLimit.request_count + 1,
                ),
                "reset_at": case(
                    (SupportRateLimit.reset_at <= now, reset_at),
                    else_=SupportRateLimit.reset_at,
                ),
            },
        )
        .returning(SupportRateLimit.request_count, SupportRateLimit.reset_at)
    )
    result = await db.execute(stmt)
    count, _reset = result.one()
    await db.commit()
    probability = _RATE_LIMIT_CLEANUP_PROBABILITY if cleanup_probability is None else cleanup_probability
    if random.random() < probability:
        await cleanup_expired_rate_limits(db, now)
    if count > limit:
        raise HTTPException(429, friendly)
