from __future__ import annotations

import contextvars
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import AsyncSessionLocal
from src.models.user import User

_current_mcp_user_var: contextvars.ContextVar[User | None] = contextvars.ContextVar(
    "current_mcp_user", default=None
)


def set_current_mcp_user(user: User | None) -> contextvars.Token:
    """Set the authenticated User in the current async context."""
    return _current_mcp_user_var.set(user)


def reset_current_mcp_user(token: contextvars.Token) -> None:
    """Reset the User contextvar token."""
    _current_mcp_user_var.reset(token)


def get_current_mcp_user() -> User:
    """Retrieve the current authenticated User in this MCP request context."""
    user = _current_mcp_user_var.get()
    if not user:
        raise PermissionError("Unauthenticated MCP tool invocation. Bearer token missing or invalid.")
    return user


@asynccontextmanager
async def get_mcp_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an active async database session for MCP tool execution."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
