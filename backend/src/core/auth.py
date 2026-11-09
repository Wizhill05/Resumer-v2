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

    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None

    return await _lookup_user(db, payload)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = await _lookup_user(db, payload)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


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
