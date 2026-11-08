from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.token_crypto import decrypt_token, encrypt_token
from src.models.identity import GithubToken, UserIdentity


async def upsert_github_token(
    db: AsyncSession, identity_id: uuid.UUID, oauth_app: str, access_token: str, scopes: str
) -> GithubToken:
    encrypted = encrypt_token(access_token)
    result = await db.execute(
        select(GithubToken).where(GithubToken.identity_id == identity_id, GithubToken.oauth_app == oauth_app)
    )
    token = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if token is None:
        token = GithubToken(
            identity_id=identity_id,
            oauth_app=oauth_app,
            access_token_encrypted=encrypted,
            scopes=scopes or "",
            status="active",
            last_used_at=now,
        )
        db.add(token)
    else:
        token.access_token_encrypted = encrypted
        token.scopes = scopes or ""
        token.status = "active"
        token.last_used_at = now
    await db.commit()
    await db.refresh(token)
    return token


async def get_sync_token(db: AsyncSession, user_id: uuid.UUID) -> tuple[str, str] | None:
    for oauth_app in ("connect", "login"):
        result = await db.execute(
            select(GithubToken)
            .join(UserIdentity, GithubToken.identity_id == UserIdentity.id)
            .where(UserIdentity.user_id == user_id)
            .where(GithubToken.oauth_app == oauth_app)
            .where(GithubToken.status == "active")
        )
        token = result.scalar_one_or_none()
        if token is not None:
            try:
                return decrypt_token(token.access_token_encrypted), token.scopes
            except Exception:
                continue
    return None


async def mark_needs_reauth(db: AsyncSession, token_id: uuid.UUID) -> None:
    result = await db.execute(select(GithubToken).where(GithubToken.id == token_id))
    token = result.scalar_one_or_none()
    if token is not None:
        token.status = "needs_reauth"
        await db.commit()


async def get_github_identity(db: AsyncSession, user_id: uuid.UUID) -> UserIdentity | None:
    result = await db.execute(
        select(UserIdentity).where(UserIdentity.user_id == user_id, UserIdentity.provider == "github")
    )
    return result.scalar_one_or_none()
