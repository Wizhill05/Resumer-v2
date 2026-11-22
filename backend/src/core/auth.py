import uuid

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.models.user import User

bearer = HTTPBearer(auto_error=False)
OAUTH_HANDOFF_USE = "oauth_handoff"

# Sent with the 401 for accounts scheduled for deletion. The frontend proxy keys off it to
# drop the stale browser session; the detail text is safe to show as-is.
ACCOUNT_STATUS_HEADER = "X-Account-Status"
PENDING_DELETION = "pending_deletion"
PENDING_DELETION_DETAIL = "This account is scheduled for deletion. Sign in again to restore it."


def pending_deletion_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=PENDING_DELETION_DETAIL,
        headers={ACCOUNT_STATUS_HEADER: PENDING_DELETION},
    )


async def _lookup_user(db: AsyncSession, payload: dict) -> User | None:
    """Resolve the user from the token's `sub`, which must be a user UUID.

    Every backend JWT producer (frontend `backendTokenForSession`, OAuth access tokens) sets
    `sub`; email-only tokens are rejected so identity never depends on a mutable email match.
    """
    sub = payload.get("sub")
    if not sub:
        return None
    try:
        parsed = uuid.UUID(str(sub))
    except (ValueError, AttributeError, TypeError):
        return None
    result = await db.execute(select(User).where(User.id == parsed))
    return result.scalar_one_or_none()


def decode_api_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except (JWTError, ValueError, TypeError, OverflowError):
        return None
    if payload.get("token_use") == OAUTH_HANDOFF_USE or "aud" in payload:
        return None
    return payload


async def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    token: str | None = None
    if credentials:
        token = credentials.credentials
    elif request:
        # Check cookies. Auth.js session cookies are deliberately not read here: they are
        # encrypted JWEs (never valid HS256 JWTs) and are not sent to this host anyway.
        for cookie_name in [
            "auth_token",
            "token",
        ]:
            if cookie_name in request.cookies:
                token = request.cookies[cookie_name]
                break
        if not token:
            token = request.query_params.get("token")

    if not token:
        return None

    payload = decode_api_token(token)
    if payload is None:
        return None

    user = await _lookup_user(db, payload)
    # A pending-deletion account is signed out everywhere until a fresh sign-in restores it.
    if user is not None and user.is_pending_deletion:
        return None
    return user


async def _get_authenticated_user(
    credentials: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
    *,
    web_session_required: bool = False,
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_api_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    provider = payload.get("provider")
    if web_session_required and (
        not isinstance(provider, str) or not provider.strip() or "token_use" in payload or "client_id" in payload
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "web_session_required",
                "message": "Sign in to Résumer in your browser to change this.",
            },
        )
    user = await _lookup_user(db, payload)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if user.is_pending_deletion:
        raise pending_deletion_error()
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    return await _get_authenticated_user(credentials, db)


async def get_web_session_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    return await _get_authenticated_user(credentials, db, web_session_required=True)


async def get_current_admin(
    user: User = Depends(get_current_user),
) -> User:
    admin_emails = settings.admin_emails
    # If '*' is in admin_emails, anyone is allowed. Otherwise, exact check.
    if "*" in admin_emails or user.email in admin_emails:
        return user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Forbidden: Admin access required",
    )
