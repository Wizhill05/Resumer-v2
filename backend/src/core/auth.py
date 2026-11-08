import uuid

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.models.user import User

bearer = HTTPBearer(auto_error=False)


async def _lookup_user(db: AsyncSession, payload: dict) -> User | None:
    sub = payload.get("sub")
    if sub:
        try:
            uid = sub if isinstance(sub, str) else str(sub)
            parsed = uuid.UUID(str(uid))
        except Exception:
            return None
        result = await db.execute(select(User).where(User.id == parsed))
        return result.scalar_one_or_none()
    email = payload.get("email")
    if email:
        result = await db.execute(
            select(User).where(func.lower(User.email) == str(email).strip().lower())
        )
        return result.scalar_one_or_none()
    return None


async def get_optional_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    token: str | None = None
    if credentials:
        token = credentials.credentials
    elif request:
        # Check cookies
        for cookie_name in [
            "auth_token",
            "authjs.session-token",
            "__Secure-authjs.session-token",
            "next-auth.session-token",
            "__Secure-next-auth.session-token",
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
