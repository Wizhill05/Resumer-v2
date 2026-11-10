"""Account deletion with a 7-day grace period.

Lifecycle
---------
1. ``schedule_deletion`` - the user asks to delete their account. We stamp
   ``deletion_requested_at`` / ``deletion_scheduled_for`` (now + 7 days) and revoke the
   credentials that outlive a browser session (MCP connector refresh tokens, OAuth codes,
   pending GitHub link states). Nothing else is touched, so a restore is lossless.
2. While ``deletion_scheduled_for`` is set the account is locked: every auth path
   (backend JWTs, MCP, OAuth) treats it as signed out. Existing browser sessions are not
   enough to bring it back.
3. ``restore_if_pending`` - a fresh sign-in (password or Google/GitHub) *before* the
   deadline clears the schedule. After the deadline the account is treated as gone.
4. ``purge_user`` - once the deadline passes, R2 objects are deleted and then the
   ``users`` row; every user-owned table cascades from ``users.id`` in Postgres. The
   hourly ``account_deletion_loop`` does this, and sign-in / sign-up purge a due account
   on the spot so nobody waits on the loop to reuse their email.
5. External cleanup - the purge records ``AccountCleanupTask`` rows in the same
   transaction (PostHog person + events + recordings; GitHub "login" and "connect" app
   grants). The hourly loop runs ``run_cleanup_tasks`` right after purging and retries
   failures. Missing credentials make a task wait, not fail.

Restore and purge cannot both win: restore is a conditional UPDATE (``scheduled_for >
now``) and purge takes a row lock and re-checks ``scheduled_for <= now`` before it
touches storage.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.storage import StorageService
from src.models.generation import Generation, ReportAttachment, SupportReport
from src.models.identity import GithubLinkState, GithubToken, UserIdentity
from src.models.oauth import OAuthAuthorizationCode, OAuthRefreshToken
from src.models.user import AccountCleanupTask, User

logger = logging.getLogger(__name__)

GRACE_PERIOD = timedelta(days=7)

# Every artifact a generation can write lives under runs/{generation_id}/. Deleting the
# fixed names as well as the stored keys catches files whose key was never saved
# (e.g. an upload that succeeded right before the DB write failed).
_RUN_FILENAMES = ("resume.pdf", "resume.md", "thumb.webp")

KIND_POSTHOG = "posthog_person"
KIND_GITHUB = "github_grant"
# Hourly retries for ~3 days, then the task is parked as "failed" for the admin to see.
MAX_CLEANUP_ATTEMPTS = 72

_FIRST_DELAY_SECONDS = 180
_INTERVAL_SECONDS = 3600


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    """SQLite drops tzinfo in tests; treat naive values as UTC."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def is_due(user: User, now: datetime | None = None) -> bool:
    """True once a pending deletion has passed its deadline (restore no longer allowed)."""
    if user.deletion_scheduled_for is None:
        return False
    return _aware(user.deletion_scheduled_for) <= (now or _utcnow())


async def schedule_deletion(db: AsyncSession, user: User, now: datetime | None = None) -> datetime:
    """Lock the account and schedule its purge. Idempotent: a repeat call keeps the first deadline."""
    now = now or _utcnow()
    if user.deletion_scheduled_for is not None:
        return _aware(user.deletion_scheduled_for)

    scheduled_for = now + GRACE_PERIOD
    user.deletion_requested_at = now
    user.deletion_scheduled_for = scheduled_for
    user.deletion_restored_at = None

    # Connectors (ChatGPT, Claude, ...) hold refresh tokens that would otherwise keep
    # minting access tokens for a locked account. Restoring means reconnecting them.
    await db.execute(delete(OAuthRefreshToken).where(OAuthRefreshToken.user_id == user.id))
    await db.execute(delete(OAuthAuthorizationCode).where(OAuthAuthorizationCode.user_id == user.id))
    await db.execute(delete(GithubLinkState).where(GithubLinkState.user_id == user.id))
    await db.commit()
    logger.info("account_deletion: scheduled user %s for %s", user.id, scheduled_for.isoformat())
    return scheduled_for


async def restore_if_pending(db: AsyncSession, user: User, now: datetime | None = None) -> bool:
    """Cancel a pending deletion during sign-in. Does not commit; the caller does.

    Returns True when the account was restored, False when there was nothing to restore.
    Raises ``AccountDeletedError`` when the deadline has passed (or the purge job holds
    the row), since that account must be treated as deleted.
    """
    if user.deletion_scheduled_for is None:
        return False
    now = now or _utcnow()
    result = await db.execute(
        update(User)
        .where(
            User.id == user.id,
            User.deletion_scheduled_for.is_not(None),
            User.deletion_scheduled_for > now,
        )
        .values(deletion_requested_at=None, deletion_scheduled_for=None, deletion_restored_at=now)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise AccountDeletedError(user.id)
    # Keep the in-session object in step without scheduling a second UPDATE.
    from sqlalchemy.orm.attributes import set_committed_value

    set_committed_value(user, "deletion_requested_at", None)
    set_committed_value(user, "deletion_scheduled_for", None)
    set_committed_value(user, "deletion_restored_at", now)
    logger.info("account_deletion: restored user %s on sign-in", user.id)
    return True


class AccountDeletedError(Exception):
    """The account's grace period is over; treat it as if it no longer exists."""

    def __init__(self, user_id):
        super().__init__(f"account {user_id} is past its deletion deadline")
        self.user_id = user_id


async def _storage_keys_for(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()

    def add(key: str | None) -> None:
        if key and key not in seen:
            seen.add(key)
            keys.append(key)

    gens = await db.execute(
        select(
            Generation.id,
            Generation.pdf_storage_key,
            Generation.md_storage_key,
            Generation.thumb_storage_key,
        ).where(Generation.user_id == user_id)
    )
    for gen_id, pdf_key, md_key, thumb_key in gens.all():
        add(pdf_key)
        add(md_key)
        add(thumb_key)
        for name in _RUN_FILENAMES:
            add(f"runs/{gen_id}/{name}")

    attachments = await db.execute(
        select(ReportAttachment.storage_key)
        .join(SupportReport, SupportReport.id == ReportAttachment.report_id)
        .where(SupportReport.user_id == user_id)
    )
    for (key,) in attachments.all():
        add(key)
    return keys


async def _cleanup_tasks_for(db: AsyncSession, user_id: uuid.UUID, email: str | None) -> list[AccountCleanupTask]:
    """External cleanup owed once this user is gone. Built before the delete, while the data exists."""
    tasks: list[AccountCleanupTask] = []

    # PostHog knows a signed-in person by their lowercased email (identify + sign-in
    # events) and API/MCP generation events by "api-user:<id>".
    distinct_ids = [f"api-user:{user_id}"]
    if email:
        distinct_ids.insert(0, email.strip().lower())
    tasks.append(AccountCleanupTask(kind=KIND_POSTHOG, payload={"distinct_ids": distinct_ids}))

    # GitHub grants for both apps: "login" (Auth.js sign-in) and "connect" (repo import).
    # The ciphertext is copied as-is, so no plaintext token is ever stored here.
    rows = await db.execute(
        select(GithubToken.oauth_app, GithubToken.access_token_encrypted)
        .join(UserIdentity, UserIdentity.id == GithubToken.identity_id)
        .where(UserIdentity.user_id == user_id)
    )
    for app, encrypted in rows.all():
        if app in ("login", "connect") and encrypted:
            tasks.append(AccountCleanupTask(kind=KIND_GITHUB, payload={"app": app, "token_encrypted": encrypted}))
    return tasks


async def purge_user(db: AsyncSession, user_id: uuid.UUID, now: datetime | None = None) -> bool:
    """Permanently delete a user whose grace period is over.

    Returns True if the user was deleted. Returns False (and changes nothing) when the
    user isn't due, is already gone, is locked by a concurrent purge, or R2 cleanup
    failed; in the last case the next run retries, so files are never orphaned.
    """
    now = now or _utcnow()
    try:
        # The row lock makes a concurrent restore wait for this transaction, then find
        # nothing to update (restore requires scheduled_for > now, which is false here).
        locked = await db.execute(
            select(User.id)
            .where(
                User.id == user_id,
                User.deletion_scheduled_for.is_not(None),
                User.deletion_scheduled_for <= now,
            )
            .with_for_update(skip_locked=True)
        )
        if locked.scalar_one_or_none() is None:
            # No row matched, so no lock is held. Leave the caller's transaction alone:
            # a rollback here would expire every object in a shared request session.
            return False

        keys = await _storage_keys_for(db, user_id)
        storage = StorageService()
        failed = await asyncio.to_thread(storage.delete_files, keys)
        if failed:
            logger.error(
                "account_deletion: %d of %d R2 objects for user %s could not be deleted; will retry",
                len(failed), len(keys), user_id,
            )
            await db.rollback()
            return False

        email = await db.scalar(select(User.email).where(User.id == user_id))
        tasks = await _cleanup_tasks_for(db, user_id, email)
        db.add_all(tasks)

        # Profiles, generations (+logs, metrics), identities, GitHub tokens, OAuth rows,
        # rate limits, credit overrides, feedback and support reports all cascade.
        await db.execute(delete(User).where(User.id == user_id))
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    # External cleanup runs from the loop (right after purge_due_accounts), never inline:
    # this function is also called during sign-in, which must not wait on PostHog/GitHub.
    logger.info("account_deletion: purged user %s (%d storage objects, %d cleanup tasks queued)", user_id, len(keys), len(tasks))
    return True


class _NotConfigured(Exception):
    """Credentials for this provider aren't set; wait without spending an attempt."""


async def _erase_posthog_person(payload: dict[str, Any]) -> None:
    from src.core.config import settings
    from src.services.posthog_insights import api_host

    key = settings.POSTHOG_DELETION_API_KEY or settings.POSTHOG_PERSONAL_API_KEY
    if not key or not settings.POSTHOG_PROJECT_ID:
        raise _NotConfigured("PostHog deletion key or project id not set")
    import httpx

    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(
            f"{api_host()}/api/projects/{settings.POSTHOG_PROJECT_ID}/persons/bulk_delete/",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "distinct_ids": payload.get("distinct_ids") or [],
                "delete_events": True,
                "delete_recordings": True,
            },
        )
    if res.status_code == 403:
        raise RuntimeError("PostHog rejected the key (403): it needs the person:write scope")
    if res.status_code not in (200, 202):
        raise RuntimeError(f"PostHog bulk_delete returned HTTP {res.status_code}")
    body = res.json() if res.content else {}
    # These two steps mean the person *was* deleted (see PostHog's API docs); anything else
    # means it wasn't, and a retry is the documented fix.
    errors = [
        e for e in (body.get("deletion_errors") or [])
        if e.get("step") not in ("log_activity", "publish_clickhouse_tombstone")
    ]
    if errors:
        raise RuntimeError(f"PostHog could not delete {len(errors)} person(s): {errors[:3]}")


async def _revoke_github_grant(payload: dict[str, Any]) -> None:
    from src.api.integrations_github import delete_github_grant
    from src.core.config import settings
    from src.core.token_crypto import decrypt_token

    app = payload.get("app")
    if app == "login":
        client_id, secret = settings.GITHUB_LOGIN_CLIENT_ID, settings.GITHUB_LOGIN_CLIENT_SECRET
    elif app == "connect":
        client_id, secret = settings.GITHUB_CONNECT_CLIENT_ID, settings.GITHUB_CONNECT_CLIENT_SECRET
    else:
        return  # unknown app: nothing we can do, drop the task
    if not client_id or not secret:
        raise _NotConfigured(f"GitHub {app} app credentials not set")
    try:
        token = decrypt_token(payload.get("token_encrypted") or "")
    except Exception:  # noqa: BLE001 - key rotated or corrupt: the token can never be used
        logger.warning("account_deletion: GitHub %s token undecryptable; dropping revoke task", app)
        return
    status_code = await delete_github_grant(token, client_id, secret)
    # 204 revoked; 404/422 the token is already invalid, so there's no grant left to revoke.
    if status_code not in (204, 404, 422):
        raise RuntimeError(f"GitHub grant revoke returned HTTP {status_code}")


_HANDLERS = {KIND_POSTHOG: _erase_posthog_person, KIND_GITHUB: _revoke_github_grant}


async def run_cleanup_tasks(db: AsyncSession, limit: int = 200) -> dict:
    """Run pending external cleanup. Done tasks are deleted; failures are retried later."""
    query = select(AccountCleanupTask).where(AccountCleanupTask.status == "pending")
    tasks = (await db.execute(query.order_by(AccountCleanupTask.created_at).limit(limit))).scalars().all()

    counts = {"done": 0, "retry": 0, "waiting": 0, "failed": 0}
    for task in tasks:
        handler = _HANDLERS.get(task.kind)
        try:
            if handler is not None:
                await handler(task.payload or {})
        except _NotConfigured as exc:
            counts["waiting"] += 1
            task.last_error = str(exc)
            continue
        except Exception as exc:  # noqa: BLE001 - record and retry on the next run
            task.attempts += 1
            task.last_attempt_at = _utcnow()
            task.last_error = str(exc)[:500]
            if task.attempts >= MAX_CLEANUP_ATTEMPTS:
                task.status = "failed"
                counts["failed"] += 1
                logger.error("account_deletion: giving up on %s task %s: %s", task.kind, task.id, exc)
            else:
                counts["retry"] += 1
                logger.warning("account_deletion: %s task %s failed (attempt %d): %s", task.kind, task.id, task.attempts, exc)
            continue
        await db.delete(task)
        counts["done"] += 1
    await db.commit()
    if any(counts.values()):
        logger.info("account_deletion: cleanup tasks %s", counts)
    return counts


async def purge_due_accounts(db: AsyncSession, now: datetime | None = None, limit: int = 500) -> dict:
    """Purge accounts whose grace period has ended, oldest first. Returns counts.

    Anything past ``limit`` (or skipped after an R2 failure) is picked up by the next run.
    """
    now = now or _utcnow()
    result = await db.execute(
        select(User.id)
        .where(User.deletion_scheduled_for.is_not(None), User.deletion_scheduled_for <= now)
        .order_by(User.deletion_scheduled_for)
        .limit(limit)
    )
    ids = list(result.scalars().all())
    await db.commit()  # end the read transaction before per-user work

    purged = 0
    skipped = 0
    for uid in ids:
        try:
            if await purge_user(db, uid, now):
                purged += 1
            else:
                skipped += 1
        except Exception as exc:  # noqa: BLE001 - one bad account must not stop the rest
            skipped += 1
            logger.exception("account_deletion: purge failed for user %s: %s", uid, exc)
    counts = {"purged": purged, "skipped": skipped}
    if purged or skipped:
        logger.info("account_deletion: run finished %s", counts)
    return counts


async def account_deletion_loop() -> None:
    """Background loop: first run a few minutes after startup, then hourly.

    Runs inside the single backend container, like the guest cleanup loop. Restarts and
    deploys only delay a run, and overlapping containers are safe because purge_user
    locks the row (SKIP LOCKED) and is idempotent.
    """
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
                await purge_due_accounts(session)
                await run_cleanup_tasks(session)
        except asyncio.CancelledError:
            break
        except Exception as exc:  # noqa: BLE001 - never crash the app
            logger.exception("account_deletion loop failed: %s", exc)
