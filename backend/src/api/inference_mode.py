"""Account inference preference and human confirmation of MCP requests."""

from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.core.analytics import capture_inference_mode_changed
from src.core.auth import bearer, get_current_user, get_web_session_user
from src.core.database import get_db
from src.core.oauth import generate_random_token, hash_token
from src.models.user import InferenceModeChallenge, User

router = APIRouter(prefix="/inference-mode", tags=["inference mode"])


class ChallengeRoute(APIRoute):
    """Apply the challenge response headers to auth and validation errors too."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                response = await handler(request)
            except StarletteHTTPException as exc:
                response = await http_exception_handler(request, exc)
            except RequestValidationError as exc:
                response = await request_validation_exception_handler(request, exc)
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
            return response

        return handle


challenge_router = APIRouter(prefix="/challenge", route_class=ChallengeRoute)
InferenceMode = Literal["resumer", "own_model"]


class InferenceModeRequest(BaseModel):
    mode: InferenceMode


class InferenceModeResponse(InferenceModeRequest):
    changed_at: datetime | None


class ChallengeRequest(BaseModel):
    token: str


class ChallengeResponse(BaseModel):
    valid: bool
    reason: Literal["invalid", "used", "expired", "wrong_account"] | None = None
    expires_at: datetime | None = None
    current_mode: InferenceMode | None = None
    account_matches: bool = False


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def mode_response(user: User) -> InferenceModeResponse:
    return InferenceModeResponse(
        mode=user.inference_mode,
        changed_at=utc(user.inference_mode_changed_at) if user.inference_mode_changed_at else None,
    )


async def _lock_user(db: AsyncSession, user_id: UUID) -> User:
    user = await db.get(User, user_id, with_for_update=True, populate_existing=True)
    if user is None or user.is_pending_deletion:
        raise HTTPException(404, detail={"code": "account_not_found"})
    return user


async def _invalidate_challenges(db: AsyncSession, user_id: UUID, now: datetime) -> None:
    await db.execute(
        update(InferenceModeChallenge)
        .where(InferenceModeChallenge.user_id == user_id, InferenceModeChallenge.used_at.is_(None))
        .values(used_at=now)
    )


async def create_challenge(db: AsyncSession, user_id: UUID) -> str:
    await _lock_user(db, user_id)
    now = datetime.now(timezone.utc)
    token = generate_random_token()
    await _invalidate_challenges(db, user_id, now)
    db.add(InferenceModeChallenge(
        user_id=user_id, token_hash=hash_token(token), created_at=now,
        expires_at=now + timedelta(minutes=15),
    ))
    await db.commit()
    return token


async def _save_mode(
    db: AsyncSession, user: User, mode: InferenceMode, via: str, now: datetime,
) -> InferenceModeResponse:
    previous = user.inference_mode
    if previous != mode or via == "mcp_link":
        user.inference_mode = mode
        user.inference_mode_changed_at = now
    await _invalidate_challenges(db, user.id, now)
    result = mode_response(user)
    distinct_id = user.email.strip().lower()
    await db.commit()
    if previous != mode:
        capture_inference_mode_changed(distinct_id, previous, mode, via)
    return result


async def set_account_mode(
    db: AsyncSession, user_id: UUID, mode: InferenceMode, *, via: str,
) -> InferenceModeResponse:
    user = await _lock_user(db, user_id)
    return await _save_mode(db, user, mode, via, datetime.now(timezone.utc))


@router.get("", response_model=InferenceModeResponse)
async def get_inference_mode(current_user: User = Depends(get_current_user)):
    return mode_response(current_user)


@router.put("", response_model=InferenceModeResponse)
async def put_inference_mode(
    data: InferenceModeRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
):
    authenticate = get_web_session_user if data.mode == "own_model" else get_current_user
    current_user = await authenticate(credentials, db)
    return await set_account_mode(db, current_user.id, data.mode, via="web")


@challenge_router.post("/inspect", response_model=ChallengeResponse)
async def inspect_challenge(
    data: ChallengeRequest,
    current_user: User = Depends(get_web_session_user),
    db: AsyncSession = Depends(get_db),
):
    challenge = await db.scalar(
        select(InferenceModeChallenge).where(InferenceModeChallenge.token_hash == hash_token(data.token))
    )
    if challenge is None:
        return ChallengeResponse(valid=False, reason="invalid")
    if challenge.user_id != current_user.id:
        return ChallengeResponse(valid=False, reason="wrong_account")
    expires_at = utc(challenge.expires_at)
    if challenge.used_at is not None:
        return ChallengeResponse(valid=False, reason="used", account_matches=True)
    if expires_at <= datetime.now(timezone.utc):
        return ChallengeResponse(valid=False, reason="expired", account_matches=True)
    return ChallengeResponse(
        valid=True, expires_at=expires_at, current_mode=current_user.inference_mode, account_matches=True,
    )


@challenge_router.post("/confirm", response_model=InferenceModeResponse)
async def confirm_challenge(
    data: ChallengeRequest,
    current_user: User = Depends(get_web_session_user),
    db: AsyncSession = Depends(get_db),
):
    digest = hash_token(data.token)
    user_id = await db.scalar(
        select(InferenceModeChallenge.user_id).where(InferenceModeChallenge.token_hash == digest)
    )
    if user_id is None:
        raise HTTPException(404, detail={"code": "invalid_challenge"})
    if user_id != current_user.id:
        raise HTTPException(403, detail={"code": "wrong_account"})

    # All writers lock the account first, including requests invalidating its tokens.
    user = await _lock_user(db, user_id)
    now = datetime.now(timezone.utc)
    consumed = await db.scalar(
        update(InferenceModeChallenge)
        .where(
            InferenceModeChallenge.token_hash == digest,
            InferenceModeChallenge.used_at.is_(None),
            InferenceModeChallenge.expires_at > now,
        )
        .values(used_at=now)
        .returning(InferenceModeChallenge.id)
    )
    if consumed is None:
        used_at = await db.scalar(
            select(InferenceModeChallenge.used_at).where(InferenceModeChallenge.token_hash == digest)
        )
        if used_at is not None:
            raise HTTPException(409, detail={"code": "already_used"})
        raise HTTPException(410, detail={"code": "expired"})

    return await _save_mode(db, user, "own_model", "mcp_link", now)


router.include_router(challenge_router)
