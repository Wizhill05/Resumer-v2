import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, update

from src.core.storage import StorageService
from src.models.generation import (
    FeedbackRating,
    Generation,
    GenerationLog,
    GenerationNodeMetric,
    SupportReport,
)

logger = logging.getLogger(__name__)

# Non-null storage key columns on Generation that hold R2 objects.
STORAGE_KEY_COLUMNS = ("pdf_storage_key", "md_storage_key", "thumb_storage_key")

# First run ~2 minutes after startup, then hourly.
_FIRST_DELAY_SECONDS = 120
_INTERVAL_SECONDS = 3600


async def purge_expired_guest_data(db, now=None, batch_size: int = 200) -> dict:
    """Delete expired guest generations and their artifacts/logs.

    Only rows with ``is_guest == True AND expires_at IS NOT NULL AND
    expires_at < now`` are removed. Claimed rows (``is_guest == False`` or
    ``expires_at IS NULL``) are never touched.

    For each expired generation:
    - deletes every non-null R2 storage key (pdf, md, thumb),
    - deletes GenerationLog and GenerationNodeMetric rows (CASCADE FKs),
    - sets FeedbackRating and SupportReport generation_id to NULL
      (nullable, ondelete=SET NULL, preserved rather than deleted),
    - then deletes the Generation row.

    Returns a dict of counts:
    ``{"generations_deleted": int, "storage_objects_deleted": int}``.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    elif now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    generations_deleted = 0
    storage_objects_deleted = 0

    storage = StorageService()

    while True:
        result = await db.execute(
            select(Generation)
            .where(
                Generation.is_guest == True,  # noqa: E712
                Generation.expires_at.is_not(None),
                Generation.expires_at < now,
            )
            .order_by(Generation.expires_at)
            .limit(batch_size)
        )
        generations = result.scalars().all()
        if not generations:
            break

        for gen in generations:
            gen_id = gen.id
            keys: list[str] = []
            for col in STORAGE_KEY_COLUMNS:
                key = getattr(gen, col, None)
                if key and key not in keys:
                    keys.append(key)

            if storage.enabled:
                for key in keys:
                    try:
                        ok = await asyncio.to_thread(storage.delete_file, key)
                        if ok:
                            storage_objects_deleted += 1
                    except Exception as exc:  # noqa: BLE001 - swallow per-object errors
                        logger.warning(
                            "guest_cleanup: failed to delete R2 object %s for generation %s: %s",
                            key,
                            gen_id,
                            exc,
                        )

            await db.execute(delete(GenerationLog).where(GenerationLog.generation_id == gen_id))
            await db.execute(delete(GenerationNodeMetric).where(GenerationNodeMetric.generation_id == gen_id))
            await db.execute(
                update(SupportReport).where(SupportReport.generation_id == gen_id).values(generation_id=None)
            )
            await db.execute(
                update(FeedbackRating).where(FeedbackRating.generation_id == gen_id).values(generation_id=None)
            )
            await db.delete(gen)
            generations_deleted += 1

        await db.commit()

    counts = {
        "generations_deleted": generations_deleted,
        "storage_objects_deleted": storage_objects_deleted,
    }
    if generations_deleted:
        logger.info("guest_cleanup: purged %s", counts)
    return counts


async def guest_cleanup_loop() -> None:
    """Background loop: first run ~2 minutes after startup, then hourly."""
    from src.core.database import AsyncSessionLocal

    delay = _FIRST_DELAY_SECONDS
    while True:
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            break
        delay = _INTERVAL_SECONDS
        try:
            async with AsyncSessionLocal() as session:
                await purge_expired_guest_data(session)
        except asyncio.CancelledError:
            break
        except Exception as exc:  # noqa: BLE001 - never crash the app
            logger.exception("guest_cleanup loop failed: %s", exc)
