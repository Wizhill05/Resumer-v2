from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, status
from jose import jwt
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.notify import send_account_restored_email
from src.core.provider_messages import provider_label, provider_mismatch_message
from src.models.identity import UserIdentity
from src.models.user import User
from src.services.account_deletion import AccountDeletedError, purge_user, restore_if_pending
from src.services.github_tokens import upsert_github_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/internal/auth", tags=["internal-auth"])


class ResolveRequest(BaseModel):
    provider: str
    provider_account_id: str
    email: str
    email_verified: bool = False
    name: str | None = None
    image: str | None = None
    access_token: str | None = None
    provider_login: str | None = None
    scopes: str | None = None


def _mismatch(provider: str | None):
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"ok": False, "error": "provider_mismatch", "provider": provider, "message": provider_mismatch_message(provider)},
    )


def _rejection(status_code: int, error: str, provider: str | None, message: str):
    return HTTPException(
        status_code=status_code,
        detail={"ok": False, "error": error, "provider": provider, "message": message},
    )


def _require_internal(authorization: str | None = Header(default=None)):
    if not settings.INTERNAL_API_SECRET:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Internal auth is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing internal token")
    token = authorization[7:]
    try:
        payload = jwt.decode(token, settings.INTERNAL_API_SECRET, algorithms=["HS256"], options={"verify_aud": True}, audience="internal")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")
    if payload.get("aud") != "internal":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")
    return payload


async def _github_email_verified(access_token: str | None, email: str) -> bool:
    if not access_token:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
            )
    except Exception:
        return False
    if res.status_code != 200:
        return False
    try:
        data = res.json()
    except Exception:
        return False
    for entry in data if isinstance(data, list) else []:
        if isinstance(entry, dict) and str(entry.get("email", "")).strip().lower() == email and entry.get("verified"):
            return True
    return False


class _EmailVerification:
    """Verifies the provider email at most once per request and rejects with 409 when unverified."""

    def __init__(self, payload: ResolveRequest, email: str):
        self._payload = payload
        self._email = email
        self._result: bool | None = None

    async def require(self) -> None:
        if self._result is None:
            if self._payload.provider == "google":
                self._result = bool(self._payload.email_verified)
            else:
                self._result = await _github_email_verified(self._payload.access_token, self._email)
        if not self._result:
            raise _rejection(409, "email_not_verified", None, "Your Google/GitHub email isn't verified.")


def _normalize_scopes(scopes: str | None) -> str:
    if scopes:
        parts = [s.strip() for s in scopes.split(",") if s.strip()]
        if parts:
            return ",".join(parts)
    return "read:user,user:email"


async def _purge_due_accounts_for(db: AsyncSession, payload: ResolveRequest, email: str, now: datetime) -> None:
    """Delete accounts for this login whose deletion grace period is over.

    Without this, someone signing in after their 7 days would hit the old row until the
    hourly purge ran. Once it's gone, resolve continues as a brand-new sign-up.
    """
    identity_owner = select(UserIdentity.user_id).where(
        UserIdentity.provider == payload.provider,
        UserIdentity.provider_account_id == payload.provider_account_id,
    )
    result = await db.execute(
        select(User.id).where(
            or_(User.id.in_(identity_owner), func.lower(User.email) == email),
            User.deletion_scheduled_for.is_not(None),
            User.deletion_scheduled_for <= now,
        )
    )
    for user_id in result.scalars().all():
        if not await purge_user(db, user_id, now):
            raise _rejection(503, "unavailable", None, "This account is being deleted. Try again in a few minutes.")


async def _succeed(db: AsyncSession, user: User, provider: str, is_new: bool, identity: UserIdentity, payload: ResolveRequest):
    now = datetime.now(timezone.utc)
    # A real sign-in inside the grace period cancels a pending deletion.
    try:
        restored = await restore_if_pending(db, user, now)
    except AccountDeletedError:
        # The deadline passed mid-request; the next attempt purges it and signs up fresh.
        await db.rollback()
        raise _rejection(503, "unavailable", None, "This account is being deleted. Try again in a few minutes.")
    identity.last_seen_at = now
    if payload.provider_login:
        identity.provider_login = payload.provider_login
    if payload.provider == "github" and payload.access_token:
        try:
            scopes = _normalize_scopes(payload.scopes)
            await upsert_github_token(db, identity.id, "login", payload.access_token, scopes)
        except Exception:
            logger.error("Failed to store GitHub login token; continuing sign-in without it")
            await db.commit()
    else:
        await db.commit()
    if restored:
        await asyncio.to_thread(send_account_restored_email, user.email, user.name)
    needs_welcome = user.signup_completed_at is None
    return {"ok": True, "uid": str(user.id), "provider": provider, "is_new": is_new, "needs_welcome": needs_welcome, "restored": restored}


@router.post("/resolve")
async def resolve_auth(
    payload: ResolveRequest,
    db: AsyncSession = Depends(get_db),
    _auth=Depends(_require_internal),
):
    if payload.provider not in ("google", "github"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported provider")
    email = payload.email.strip().lower()
    now = datetime.now(timezone.utc)
    verification = _EmailVerification(payload, email)
    await _purge_due_accounts_for(db, payload, email, now)

    # Step 1: existing identity
    result = await db.execute(
        select(UserIdentity).where(
            UserIdentity.provider == payload.provider,
            UserIdentity.provider_account_id == payload.provider_account_id,
        )
    )
    identity = result.scalar_one_or_none()
    if identity is not None:
        user_res = await db.execute(select(User).where(User.id == uuid.UUID(str(identity.user_id))))
        user = user_res.scalar_one()
        if identity.kind == "link":
            label = provider_label(user.provider)
            raise _rejection(409, "linked_not_login", user.provider, f"This GitHub account is connected to a Résumer account that signs in with {label}. Sign in with {label}.")
        return await _succeed(db, user, payload.provider, False, identity, payload)

    # Step 2: legacy claim - NULL provider_account_id, same email, same provider (single join query)
    result = await db.execute(
        select(UserIdentity)
        .join(User, User.id == UserIdentity.user_id)
        .where(
            UserIdentity.provider == payload.provider,
            UserIdentity.provider_account_id.is_(None),
            UserIdentity.kind == "login",
            func.lower(User.email) == email,
            User.provider == payload.provider,
        )
    )
    legacy = result.scalars().first()
    if legacy is not None:
        legacy.provider_account_id = payload.provider_account_id
        user_res = await db.execute(select(User).where(User.id == uuid.UUID(str(legacy.user_id))))
        user = user_res.scalar_one()
        return await _succeed(db, user, payload.provider, False, legacy, payload)

    # Look up user by email for steps 3-4 and same-provider handling
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    existing = result.scalar_one_or_none()
    if existing is not None:
        if existing.provider is None:
            # Step 3: unlocked legacy user - lock and create identity (email match alone is not proof of ownership)
            await verification.require()
            existing.provider = payload.provider
            if existing.email_verified_at is None:
                existing.email_verified_at = now
            identity = UserIdentity(
                user_id=existing.id,
                provider=payload.provider,
                provider_account_id=payload.provider_account_id,
                kind="login",
                provider_login=payload.provider_login,
                email_at_link=email,
            )
            db.add(identity)
            await db.flush()
            return await _succeed(db, existing, payload.provider, False, identity, payload)

        if existing.provider == payload.provider:
            # Same provider, different account handling:
            # (a) NULL-account already handled via claim above; (b) no identity -> create; (c) different account -> reject
            result = await db.execute(
                select(UserIdentity).where(
                    UserIdentity.user_id == existing.id,
                    UserIdentity.provider == payload.provider,
                )
            )
            existing_ident = result.scalar_one_or_none()
            if existing_ident is None:
                await verification.require()
                if existing.email_verified_at is None:
                    existing.email_verified_at = now
                identity = UserIdentity(
                    user_id=existing.id,
                    provider=payload.provider,
                    provider_account_id=payload.provider_account_id,
                    kind="login",
                    provider_login=payload.provider_login,
                    email_at_link=email,
                )
                db.add(identity)
                await db.flush()
                return await _succeed(db, existing, payload.provider, False, identity, payload)
            if existing_ident.provider_account_id is None:
                existing_ident.provider_account_id = payload.provider_account_id
                return await _succeed(db, existing, payload.provider, False, existing_ident, payload)
            if existing_ident.provider_account_id != payload.provider_account_id:
                label = provider_label(payload.provider)
                raise _rejection(
                    409,
                    "provider_mismatch",
                    payload.provider,
                    f"This email is linked to a different {label} account. Sign in with that account.",
                )
            # Same account but step 1 didn't match (shouldn't happen) - succeed
            return await _succeed(db, existing, payload.provider, False, existing_ident, payload)

        # Step 4: different provider
        raise _mismatch(existing.provider)

    # Step 5: create user, requires verified email
    await verification.require()

    user = User(
        email=email,
        name=payload.name,
        image=payload.image,
        provider=payload.provider,
        email_verified_at=now,
        signup_completed_at=None,
    )
    db.add(user)
    await db.flush()
    identity = UserIdentity(
        user_id=user.id,
        provider=payload.provider,
        provider_account_id=payload.provider_account_id,
        kind="login",
        provider_login=payload.provider_login,
        email_at_link=email,
    )
    db.add(identity)
    await db.flush()
    return await _succeed(db, user, payload.provider, True, identity, payload)
