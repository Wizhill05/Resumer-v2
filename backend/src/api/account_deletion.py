from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user
from src.core.database import get_db
from src.core.notify import send_account_deletion_scheduled_email
from src.models.user import User
from src.services.account_deletion import GRACE_PERIOD, schedule_deletion

router = APIRouter(prefix="/account", tags=["account"])


class DeletionStatusResponse(BaseModel):
    grace_period_days: int = GRACE_PERIOD.days
    # Set when a recent sign-in cancelled a pending deletion and the user hasn't
    # dismissed the notice yet. Pending accounts never reach this endpoint (401).
    restored_at: datetime | None = None


class DeletionRequest(BaseModel):
    confirm_email: str = Field(..., max_length=320, description="The account email, typed to confirm")


class DeletionScheduledResponse(BaseModel):
    ok: bool = True
    deletion_scheduled_for: datetime


@router.get("/deletion", response_model=DeletionStatusResponse)
async def get_deletion_status(user: User = Depends(get_current_user)):
    return DeletionStatusResponse(restored_at=user.deletion_restored_at)


@router.post("/deletion", response_model=DeletionScheduledResponse)
async def request_account_deletion(
    payload: DeletionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.confirm_email.strip().lower() != (user.email or "").strip().lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Type your account email exactly to confirm.",
        )
    scheduled_for = await schedule_deletion(db, user)
    await asyncio.to_thread(send_account_deletion_scheduled_email, user.email, user.name, scheduled_for)
    return DeletionScheduledResponse(deletion_scheduled_for=scheduled_for)


@router.delete("/deletion/restored-notice")
async def dismiss_restored_notice(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.deletion_restored_at is not None:
        user.deletion_restored_at = None
        await db.commit()
    return {"ok": True}
