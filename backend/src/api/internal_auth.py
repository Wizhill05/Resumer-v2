from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, status
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.models.identity import UserIdentity
from src.models.user import User
from src.services.github_tokens import upsert_github_token

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


def _label(provider: str | None) -> str:
    return {"google": "Google", "github": "GitHub", "credentials": "email"}.get(provider or "", provider or "")


def _mismatch(provider: str | None):
    label = _label(provider)
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"ok": False, "error": "provider_mismatch", "provider": provider, "message": f"This email is registered with {label}. Sign in with {label}."},
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
    except (JWTError, Exception):
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
        if isinstance(entry, dict) and str(entry.get("email", "")).strip().lower() == email and entry.get("primary") and entry.get("verified"):
            return True
    return False


async def _succeed(db: AsyncSession, user: User, provider: str, is_new: bool, identity: UserIdentity, payload: ResolveRequest):
    now = datetime.now(timezone.utc)
    identity.last_seen_at = now
    if payload.provider_login:
        identity.provider_login = payload.provider_login
    if payload.provider == "github" and payload.access_token:
        scopes = "read:user,user:email"
        await upsert_github_token(db, identity.id, "login", payload.access_token, scopes)
    else:
        await db.commit()
    needs_welcome = user.signup_completed_at is None
    return {"ok": True, "uid": str(user.id), "provider": provider, "is_new": is_new, "needs_welcome": needs_welcome}


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
            label = _label(user.provider)
            raise _rejection(409, "linked_not_login", user.provider, f"This GitHub account is connected to a Résumer account that signs in with {label}. Sign in with {label}.")
        return await _succeed(db, user, payload.provider, False, identity, payload)

    # Step 2: legacy claim (NULL provider_account_id, same email, same provider)
    result = await db.execute(
        select(UserIdentity).where(
            UserIdentity.provider == payload.provider,
            UserIdentity.provider_account_id.is_(None),
        )
    )
    legacy = None
    for candidate in result.scalars().all():
        try:
            candidate_user_res = await db.execute(select(User).where(User.id == uuid.UUID(str(candidate.user_id))))
        except Exception:
            continue
        candidate_user = candidate_user_res.scalar_one_or_none()
        if (
            candidate_user is not None
            and candidate_user.email.strip().lower() == email
            and candidate_user.provider == payload.provider
        ):
            legacy = candidate
            break
    if legacy is not None:
        legacy.provider_account_id = payload.provider_account_id
        user_res = await db.execute(select(User).where(User.id == uuid.UUID(str(legacy.user_id))))
        user = user_res.scalar_one()
        return await _succeed(db, user, payload.provider, False, legacy, payload)

    # Step 3: unlocked legacy user
    result = await db.execute(select(User).where(func.lower(User.email) == email).where(User.provider.is_(None)))
    unlocked = result.scalar_one_or_none()
    if unlocked is not None:
        unlocked.provider = payload.provider
        identity = UserIdentity(
            user_id=unlocked.id,
            provider=payload.provider,
            provider_account_id=payload.provider_account_id,
            kind="login",
            provider_login=payload.provider_login,
            email_at_link=email,
        )
        db.add(identity)
        await db.flush()
        return await _succeed(db, unlocked, payload.provider, False, identity, payload)

    # Step 4: email belongs to another provider
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    existing = result.scalar_one_or_none()
    if existing is not None:
        raise _mismatch(existing.provider)

    # Step 5: create user, requires verified email
    if payload.provider == "google":
        verified = bool(payload.email_verified)
    else:
        verified = await _github_email_verified(payload.access_token, email)
    if not verified:
        raise _rejection(409, "email_not_verified", None, "Your Google/GitHub email isn't verified.")

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
