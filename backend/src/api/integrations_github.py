"""GitHub linking (Connect app): status, link start/complete, disconnect."""

from __future__ import annotations

import base64
import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user
from src.core.config import settings
from src.core.database import get_db
from src.core.token_crypto import decrypt_token
from src.models.identity import GithubLinkState, GithubToken, UserIdentity
from src.models.user import User
from src.services.github_tokens import get_github_identity, upsert_github_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations/github", tags=["integrations-github"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_scopes(scopes: str) -> list[str]:
    parts = re.split(r"[,\s]+", scopes or "")
    return [p.strip().lower() for p in parts if p.strip()]


def _normalize_scopes(scopes: str) -> str:
    return ",".join(_parse_scopes(scopes))


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _pkce_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


async def _get_tokens(db: AsyncSession, identity_id: uuid.UUID) -> list[GithubToken]:
    result = await db.execute(select(GithubToken).where(GithubToken.identity_id == identity_id))
    return list(result.scalars().all())


def _sync_token(tokens: list[GithubToken]) -> GithubToken | None:
    for oauth_app in ("connect", "login"):
        for token in tokens:
            if token.oauth_app == oauth_app:
                return token
    return None


async def exchange_code_for_token(code: str, code_verifier: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(
            "https://github.com/login/oauth/access_token",
            data={
                "client_id": settings.GITHUB_CONNECT_CLIENT_ID,
                "client_secret": settings.GITHUB_CONNECT_CLIENT_SECRET,
                "code": code,
                "redirect_uri": settings.GITHUB_CONNECT_REDIRECT_URI,
                "code_verifier": code_verifier,
            },
            headers={"Accept": "application/json"},
        )
    return res.json() if res.status_code == 200 else {}


async def fetch_github_user(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json"},
        )
    return res.json() if res.status_code == 200 else {}


async def revoke_github_grant(access_token: str) -> None:
    if not settings.GITHUB_CONNECT_CLIENT_ID:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.request(
                "DELETE",
                f"https://api.github.com/applications/{settings.GITHUB_CONNECT_CLIENT_ID}/grant",
                auth=(settings.GITHUB_CONNECT_CLIENT_ID, settings.GITHUB_CONNECT_CLIENT_SECRET),
                json={"access_token": access_token},
            )
    except Exception as exc:  # noqa: BLE001 - revoke is best effort
        logger.warning("[github-link] revoke failed (%s)", type(exc).__name__)


@router.get("")
async def get_github_status(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    identity = await get_github_identity(db, user.id)
    if identity is None:
        return {
            "connected": False,
            "login": None,
            "kind": None,
            "private_access": False,
            "status": None,
            "can_disconnect": False,
        }
    tokens = await _get_tokens(db, identity.id)
    connected = len(tokens) > 0
    kind = identity.kind
    if not tokens:
        status_value = None
    elif any(t.status == "active" for t in tokens):
        status_value = "active"
    else:
        status_value = "needs_reauth"
    private_access = any(
        t.oauth_app == "connect" and t.status == "active" and "repo" in _parse_scopes(t.scopes)
        for t in tokens
    )
    return {
        "connected": connected,
        "login": identity.provider_login if connected else None,
        "kind": kind,
        "private_access": private_access,
        "status": status_value,
        "can_disconnect": kind == "link",
    }


class LinkStartRequest(BaseModel):
    private: bool = False


@router.post("/link/start")
async def start_link(
    payload: LinkStartRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not settings.GITHUB_CONNECT_CLIENT_ID or not settings.GITHUB_CONNECT_CLIENT_SECRET:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="GitHub linking is not configured")
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    link_state = GithubLinkState(
        state_hash=_sha256_hex(state),
        user_id=user.id,
        code_verifier=code_verifier,
        want_private=payload.private,
        expires_at=_now() + timedelta(minutes=10),
    )
    db.add(link_state)
    await db.commit()
    scope = "read:user repo" if payload.private else "read:user"
    query = urlencode(
        {
            "client_id": settings.GITHUB_CONNECT_CLIENT_ID,
            "redirect_uri": settings.GITHUB_CONNECT_REDIRECT_URI,
            "scope": scope,
            "state": state,
            "code_challenge": _pkce_challenge(code_verifier),
            "code_challenge_method": "S256",
            "allow_signup": "false",
        }
    )
    return {"state": state, "authorize_url": f"https://github.com/login/oauth/authorize?{query}"}


class LinkCompleteRequest(BaseModel):
    code: str
    state: str


@router.post("/link/complete")
async def complete_link(
    payload: LinkCompleteRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(GithubLinkState).where(GithubLinkState.state_hash == _sha256_hex(payload.state)))
    link_state = result.scalar_one_or_none()
    if link_state is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expired")
    if str(link_state.user_id) != str(user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="failed")
    expires_at = link_state.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if link_state.used_at is not None or (expires_at is not None and expires_at < _now()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="expired")
    link_state.used_at = _now()
    await db.commit()

    try:
        token_data = await exchange_code_for_token(payload.code, link_state.code_verifier)
    except Exception:  # noqa: BLE001 - exchange errors map to failed
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="failed")
    if not isinstance(token_data, dict) or not token_data.get("access_token"):
        error = token_data.get("error") if isinstance(token_data, dict) else None
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="denied" if error == "access_denied" else "failed")
    access_token = token_data["access_token"]
    scopes = _normalize_scopes(str(token_data.get("scope") or ""))

    try:
        gh_user = await fetch_github_user(access_token)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="failed")
    if not isinstance(gh_user, dict) or "id" not in gh_user or "login" not in gh_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="failed")
    gh_id = str(gh_user["id"])
    gh_login = str(gh_user["login"])

    result = await db.execute(
        select(UserIdentity).where(UserIdentity.provider == "github", UserIdentity.provider_account_id == gh_id)
    )
    owner = result.scalar_one_or_none()
    if owner is not None and str(owner.user_id) != str(user.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="already_linked")

    identity = await get_github_identity(db, user.id)
    if identity is not None and identity.kind == "login":
        if identity.provider_account_id is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="sign_in_again")
        if identity.provider_account_id != gh_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="different_account")
        identity.provider_login = gh_login
    else:
        if identity is None:
            identity = UserIdentity(
                user_id=user.id,
                provider="github",
                provider_account_id=gh_id,
                kind="link",
                provider_login=gh_login,
                email_at_link=None,
            )
            db.add(identity)
            await db.flush()
        else:
            if identity.provider_account_id is not None and identity.provider_account_id != gh_id:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="different_account")
            identity.provider_account_id = gh_id
            identity.provider_login = gh_login
    await upsert_github_token(db, identity.id, "connect", access_token, scopes)
    return {"ok": True}


@router.delete("")
async def disconnect_github(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    identity = await get_github_identity(db, user.id)
    if identity is None or identity.kind != "link":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GitHub is not connected")
    tokens = await _get_tokens(db, identity.id)
    for token in tokens:
        try:
            plaintext = decrypt_token(token.access_token_encrypted)
        except Exception:  # noqa: BLE001 - skip if undecryptable
            continue
        await revoke_github_grant(plaintext)
    await db.execute(delete(GithubToken).where(GithubToken.identity_id == identity.id))
    await db.execute(delete(UserIdentity).where(UserIdentity.id == identity.id))
    await db.commit()
    return {"ok": True}


@router.delete("/private")
async def remove_private_access(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    identity = await get_github_identity(db, user.id)
    if identity is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="GitHub is not connected")
    if identity.kind == "link":
        tokens = await _get_tokens(db, identity.id)
        for token in tokens:
            try:
                plaintext = decrypt_token(token.access_token_encrypted)
            except Exception:  # noqa: BLE001 - skip if undecryptable
                continue
            await revoke_github_grant(plaintext)
        await db.execute(delete(GithubToken).where(GithubToken.identity_id == identity.id))
        await db.execute(delete(UserIdentity).where(UserIdentity.id == identity.id))
        await db.commit()
        return {"ok": True, "reconnect_required": True}
    # kind == "login": revoke and delete only the connect token.
    result = await db.execute(
        select(GithubToken).where(GithubToken.identity_id == identity.id, GithubToken.oauth_app == "connect")
    )
    connect_token = result.scalar_one_or_none()
    if connect_token is not None:
        try:
            plaintext = decrypt_token(connect_token.access_token_encrypted)
        except Exception:  # noqa: BLE001 - still delete the row
            plaintext = None
        if plaintext is not None:
            await revoke_github_grant(plaintext)
        await db.execute(delete(GithubToken).where(GithubToken.id == connect_token.id))
        await db.commit()
    return {"ok": True, "reconnect_required": False}
