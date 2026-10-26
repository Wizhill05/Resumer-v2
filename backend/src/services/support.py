"""Support ownership, conversation history, and notification delivery."""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Literal

from fastapi import HTTPException
from jose import JWTError, jwt
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from src.core.config import settings
from src.core.storage import StorageService
from src.models.generation import ReportAttachment, SupportMessage, SupportReport
from src.models.user import User

logger = logging.getLogger(__name__)
ReportStatus = Literal["open", "in_progress", "resolved", "closed"]


class ReplyCreate(BaseModel):
    message: str = Field(min_length=1, max_length=10000)

    @field_validator("message")
    @classmethod
    def nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Write a message before sending")
        return value.strip()


def is_admin(user: User | None) -> bool:
    return bool(user and ("*" in settings.admin_emails or user.email in settings.admin_emails))


def guest_token(report_id: uuid.UUID) -> str:
    return jwt.encode(
        {"sub": str(report_id), "purpose": "support_thread", "exp": datetime.now(timezone.utc) + timedelta(days=90)},
        settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM,
    )


async def get_report(db: AsyncSession, report_id: uuid.UUID) -> SupportReport:
    report = await db.get(SupportReport, report_id)
    if report is None:
        raise HTTPException(404, "Support report not found")
    return report


async def accessible_report(db: AsyncSession, report_id: uuid.UUID, user: User | None, access_token: str | None) -> SupportReport:
    report = await get_report(db, report_id)
    if is_admin(user) or (user and report.user_id == user.id):
        return report
    if report.user_id is None and access_token:
        try:
            claims = jwt.decode(access_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
            if claims.get("purpose") == "support_thread" and claims.get("sub") == str(report.id):
                return report
        except JWTError:
            pass
    # Do not reveal whether another person's report exists.
    raise HTTPException(404, "Support report not found")


def message_out(message: SupportMessage) -> dict:
    return {"id": message.id, "message": message.message, "author_role": message.author_role, "created_at": message.created_at}


def report_out(report: SupportReport) -> dict:
    return {name: getattr(report, name) for name in (
        "id", "title", "message", "status", "category", "where_happened", "steps_to_reproduce",
        "expected_behavior", "generation_id", "created_at", "updated_at", "resolved_at",
    )}


async def report_detail(db: AsyncSession, report: SupportReport, viewer_is_admin: bool = False) -> dict:
    messages = (await db.execute(select(SupportMessage).where(SupportMessage.report_id == report.id).order_by(SupportMessage.created_at, SupportMessage.id))).scalars().all()
    attachments = (await db.execute(select(ReportAttachment).where(ReportAttachment.report_id == report.id))).scalars().all()
    storage = StorageService()
    result = report_out(report)
    result.update({
        "viewer_is_admin": viewer_is_admin,
        "messages": [message_out(message) for message in messages],
        "attachments": [{
            "id": att.id, "attachment_type": att.attachment_type, "filename": att.filename,
            "mime_type": att.mime_type, "file_size_bytes": att.file_size_bytes,
            "transcription": att.transcription, "created_at": att.created_at,
            "presigned_url": storage.get_presigned_url(att.storage_key, expires_in=3600),
        } for att in attachments],
    })
    if viewer_is_admin:
        user = await db.get(User, report.user_id) if report.user_id else None
        result.update({"user_id": report.user_id, "user_email": report.email_override or (user.email if user else None),
                       "user_name": user.name if user else None, "email_override": report.email_override,
                       "admin_note": report.admin_note, "auto_summary": report.auto_summary, "sentiment_score": report.sentiment_score})
    return result


def add_status_event(db: AsyncSession, report: SupportReport, status: str, actor: User | None) -> None:
    if report.status == status:
        return
    report.status = status
    report.updated_at = datetime.now(timezone.utc)
    report.resolved_at = report.updated_at if status in ("resolved", "closed") else None
    db.add(SupportMessage(report_id=report.id, author_id=actor.id if actor else None,
                          author_role="system", message=f"Request marked {status.replace('_', ' ')}."))


def _send_update(to_email: str | None, report_id: uuid.UUID, message: str, url: str, subject: str) -> str:
    if not to_email:
        return "no_recipient"
    if not settings.RESEND_API_KEY:
        return "not_configured"
    try:
        import resend
        resend.api_key = settings.RESEND_API_KEY
        result = resend.Emails.send({
            "from": settings.NOTIFICATION_FROM_EMAIL, "to": to_email, "subject": subject,
            "html": f'<div style="font-family:Arial,sans-serif;max-width:600px;padding:24px;border:2px solid #000"><h2>Support update</h2><p style="white-space:pre-wrap">{escape(message)}</p><p><a href="{escape(url, quote=True)}">Open your conversation</a></p><p>Reply on the conversation page so the team can see your response.</p></div>',
            "text": f"{message}\n\nOpen your conversation: {url}\n\nReply on the conversation page so the team can see your response.",
        })
        if not result or not result.get("id"):
            logger.error("Support notification provider returned no delivery id for %s", report_id)
            return "failed"
        return "sent"
    except Exception:
        logger.exception("Support notification failed for report %s", report_id)
        return "failed"


async def notify_owner(db: AsyncSession, report: SupportReport, message: str) -> str:
    user = await db.get(User, report.user_id) if report.user_id else None
    target = report.email_override or (user.email if user else None)
    url = f"{settings.FRONTEND_URL.rstrip('/')}/support/issues/{report.id}"
    if report.user_id is None:
        url += f"?access_token={guest_token(report.id)}"
    return await run_in_threadpool(_send_update, target, report.id, message, url, "A reply to your Resumer support request")


async def notify_submission(report_id: uuid.UUID) -> None:
    from src.core.database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        report = await get_report(db, report_id)
        await notify_admins(report, report.message)
        await notify_owner(db, report, "We received your support request. Use this conversation to read replies and send more details.")


async def notify_admins(report: SupportReport, message: str) -> str:
    recipients = [email for email in settings.admin_emails if email != "*"]
    if not recipients:
        return "no_recipient"
    outcomes = [await run_in_threadpool(_send_update, email, report.id, message,
                f"{settings.FRONTEND_URL.rstrip('/')}/support/issues/{report.id}",
                "New message in Resumer support") for email in recipients]
    return "failed" if "failed" in outcomes else outcomes[0]


async def append_reply(db: AsyncSession, report: SupportReport, data: ReplyCreate, actor: User | None, admin: bool) -> dict:
    message = SupportMessage(report_id=report.id, author_id=actor.id if actor else None,
                             author_role="admin" if admin else "user", message=data.message)
    db.add(message)
    if not admin and report.status in ("resolved", "closed"):
        add_status_event(db, report, "open", actor)
    report.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(message)
    notification = await notify_owner(db, report, data.message) if admin else await notify_admins(report, data.message)
    return {"message": message_out(message), "notification_status": notification}
