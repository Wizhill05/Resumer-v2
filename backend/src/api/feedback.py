from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user, get_optional_user
from src.core.client_ip import trusted_client_ip
from src.core.config import settings
from src.core.database import get_db
from src.core.internal_token import is_valid_internal_token
from src.core.storage import StorageService
from src.services.rate_limit import check_rate_limit, cleanup_expired_rate_limits, insert_for
from src.models.generation import FeedbackRating, Generation, ReportAttachment, SupportPushSubscription, SupportRateLimit, SupportReport
from src.models.user import User
from src.services.support import (
    ReplyCreate,
    accessible_report,
    add_status_event,
    append_reply,
    guest_key_from_request,
    guest_key_hash_from_cookie,
    guest_token,
    hash_guest_key,
    is_admin,
    last_admin_reply_map,
    new_guest_key,
    notify_submission,
    report_detail,
    report_out,
    set_guest_cookie,
    validate_push_endpoint,
    verify_turnstile,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["feedback"])

MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_VOICE_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_VOICE_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/mpeg"}


class RatingCreate(BaseModel):
    star_rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = None
    generation_id: Optional[uuid.UUID] = None
    shown_at: Optional[datetime] = None
    dismissed: bool = False


class FeedbackRatingOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    generation_id: Optional[uuid.UUID]
    star_rating: int
    comment: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class SupportReportSubmitResponse(BaseModel):
    id: uuid.UUID
    status: str
    message: str
    access_token: str | None = None


class RatingCheckResponse(BaseModel):
    should_prompt: bool
    already_rated: bool


async def get_support_user(request: Request, user: User | None = Depends(get_optional_user)) -> User | None:
    """Optional user for support routes.

    A request that carries a user Bearer token which no longer resolves (expired, or the
    account is gone) gets a clear 401 instead of silently becoming a guest. Guests send no
    Authorization header; the proxy's internal token is not a user token and is ignored.
    """
    if user is not None:
        return user
    authorization = request.headers.get("Authorization") or ""
    scheme, _, credentials = authorization.partition(" ")
    if scheme.lower() == "bearer" and credentials.strip() and not is_valid_internal_token(f"Bearer {credentials.strip()}"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session expired. Sign in again.")
    return None


def _trusted_client_ip(request: Request) -> str | None:
    return trusted_client_ip(request)


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


_untrusted_ip_logged = False


def _insert_for(db: AsyncSession):
    return insert_for(db)


# Fraction of limiter calls that also prune long-expired buckets.
_RATE_LIMIT_CLEANUP_PROBABILITY = 0.01


async def _cleanup_expired_rate_limits(db: AsyncSession, now: datetime) -> None:
    await cleanup_expired_rate_limits(db, now)


async def _check_support_rate_limit(db: AsyncSession, key: str, limit: int, friendly: str) -> None:
    await check_rate_limit(db, key, limit, timedelta(hours=1), friendly, cleanup_probability=_RATE_LIMIT_CLEANUP_PROBABILITY)


async def _rate_limit_ip_only(db: AsyncSession, current_user: User | None, client_ip: str | None, *, is_ticket: bool) -> None:
    """Apply only the IP (or shared untrusted) bucket for guests.

    Safe to call before access checks: junk requests only burn this bucket.
    """
    global _untrusted_ip_logged
    if current_user and is_admin(current_user):
        return
    if current_user:
        return
    # Guest: always apply IP bucket when trusted IP available.
    if client_ip:
        if is_ticket:
            await _check_support_rate_limit(db, f"ip:{client_ip}:tickets", settings.SUPPORT_TICKET_HOURLY_GUEST_IP, "Too many support requests. Please wait a little before sending another.")
        else:
            await _check_support_rate_limit(db, f"ip:{client_ip}:replies", settings.SUPPORT_REPLY_HOURLY_GUEST_IP, "Too many replies. Please wait a little before sending another.")
    else:
        if not _untrusted_ip_logged:
            logger.warning("Support request without a trusted client IP (direct backend hit or INTERNAL_API_SECRET missing); applying shared untrusted bucket")
            _untrusted_ip_logged = True
        if is_ticket:
            await _check_support_rate_limit(db, "guest-untrusted:tickets", settings.SUPPORT_TICKET_HOURLY_GUEST_UNTRUSTED, "Too many support requests. Please wait a little before sending another.")
        else:
            await _check_support_rate_limit(db, "guest-untrusted:replies", settings.SUPPORT_REPLY_HOURLY_GUEST_UNTRUSTED, "Too many replies. Please wait a little before sending another.")


async def _rate_limit_after_access(db: AsyncSession, current_user: User | None, raw_guest_key: str | None, *, is_ticket: bool, report_id: uuid.UUID | None = None) -> None:
    """Apply user, cookie and per-report buckets after access is confirmed."""
    if current_user and is_admin(current_user):
        return
    if current_user:
        if is_ticket:
            await _check_support_rate_limit(db, f"user:{current_user.id}:tickets", settings.SUPPORT_TICKET_HOURLY_USER, "Too many support requests. Please wait a little before sending another.")
        else:
            await _check_support_rate_limit(db, f"user:{current_user.id}:replies", settings.SUPPORT_REPLY_HOURLY_USER, "Too many replies. Please wait a little before sending another.")
        return
    # Guest: cookie bucket only when the request actually carried a cookie.
    if raw_guest_key:
        guest_hash = hash_guest_key(raw_guest_key)
        if is_ticket:
            await _check_support_rate_limit(db, f"guest-cookie:{guest_hash}:tickets", settings.SUPPORT_TICKET_HOURLY_GUEST_COOKIE, "Too many support requests. Please wait a little before sending another.")
        else:
            await _check_support_rate_limit(db, f"guest-cookie:{guest_hash}:replies", settings.SUPPORT_REPLY_HOURLY_GUEST_COOKIE, "Too many replies. Please wait a little before sending another.")
    if report_id is not None and not is_ticket:
        await _check_support_rate_limit(db, f"report:{report_id}:guest-replies", settings.SUPPORT_REPLY_HOURLY_GUEST_REPORT, "Too many replies. Please wait a little before sending another.")


async def _rate_limit_prepare(db: AsyncSession, current_user: User | None, raw_guest_key: str | None, client_ip: str | None, *, is_ticket: bool, report_id: uuid.UUID | None = None) -> None:
    await _rate_limit_ip_only(db, current_user, client_ip, is_ticket=is_ticket)
    await _rate_limit_after_access(db, current_user, raw_guest_key, is_ticket=is_ticket, report_id=report_id)


@router.get("/support/push/public-key")
async def push_public_key():
    if not settings.VAPID_PUBLIC_KEY:
        raise HTTPException(404, "Push not configured")
    return {"key": settings.VAPID_PUBLIC_KEY}


class PushKeys(BaseModel):
    p256dh: str = Field(..., min_length=1, max_length=256, pattern=r"^[A-Za-z0-9_-]+={0,2}$")
    auth: str = Field(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+={0,2}$")


class PushSubscribeBody(BaseModel):
    endpoint: str = Field(..., min_length=1, max_length=1024)
    keys: PushKeys


MAX_PUSH_SUBSCRIPTIONS_PER_REPORT = 5


async def _push_route_report(db: AsyncSession, id: uuid.UUID, request: Request, current_user: User | None, access_token: str | None) -> SupportReport:
    raw_key = guest_key_from_request(request)
    report = await accessible_report(db, id, current_user, access_token, guest_key_hash_from_cookie(raw_key))
    await _rate_limit_prepare(db, current_user, raw_key, _trusted_client_ip(request), is_ticket=False, report_id=report.id)
    return report


@router.get("/support/{id}/push")
async def push_subscription_status(id: uuid.UUID, request: Request, endpoint: str | None = None, access_token: str | None = None, current_user: User | None = Depends(get_support_user), db: AsyncSession = Depends(get_db)):
    """Whether this browser endpoint is subscribed to this specific report."""
    report = await _push_route_report(db, id, request, current_user, access_token)
    if not endpoint or len(endpoint) > 1024:
        return {"subscribed": False}
    existing = (await db.execute(select(SupportPushSubscription.id).where(SupportPushSubscription.report_id == report.id, SupportPushSubscription.endpoint == endpoint))).first()
    return {"subscribed": existing is not None}


@router.post("/support/{id}/push")
async def subscribe_push(id: uuid.UUID, body: PushSubscribeBody, request: Request, access_token: str | None = None, current_user: User | None = Depends(get_support_user), db: AsyncSession = Depends(get_db)):
    report = await _push_route_report(db, id, request, current_user, access_token)
    p256dh = body.keys.p256dh
    auth = body.keys.auth
    if not body.endpoint or not p256dh or not auth:
        raise HTTPException(422, "Invalid push subscription")
    try:
        validate_push_endpoint(body.endpoint)
    except ValueError:
        raise HTTPException(422, "Invalid push subscription")
    # Atomic upsert: concurrent subscribes for the same endpoint cannot hit the unique constraint.
    insert_fn = _insert_for(db)
    await db.execute(
        insert_fn(SupportPushSubscription)
        .values(id=uuid.uuid4(), report_id=report.id, endpoint=body.endpoint, p256dh=p256dh, auth=auth, created_at=datetime.now(timezone.utc))
        .on_conflict_do_update(
            index_elements=[SupportPushSubscription.report_id, SupportPushSubscription.endpoint],
            set_={"p256dh": p256dh, "auth": auth},
        )
    )
    # Cap subscriptions per report: evict the oldest others, never the one just saved.
    subs = (await db.execute(
        select(SupportPushSubscription)
        .where(SupportPushSubscription.report_id == report.id)
        .order_by(SupportPushSubscription.created_at.asc(), SupportPushSubscription.id.asc())
    )).scalars().all()
    excess = len(subs) - MAX_PUSH_SUBSCRIPTIONS_PER_REPORT
    for sub in subs:
        if excess <= 0:
            break
        if sub.endpoint == body.endpoint:
            continue
        await db.delete(sub)
        excess -= 1
    await db.commit()
    return {"ok": True}


@router.delete("/support/{id}/push")
async def unsubscribe_push(id: uuid.UUID, request: Request, endpoint: str | None = None, access_token: str | None = None, current_user: User | None = Depends(get_support_user), db: AsyncSession = Depends(get_db)):
    report = await _push_route_report(db, id, request, current_user, access_token)
    if endpoint:
        await db.execute(delete(SupportPushSubscription).where(SupportPushSubscription.report_id == report.id, SupportPushSubscription.endpoint == endpoint))
        await db.commit()
    return {"ok": True}


@router.post("/support", response_model=SupportReportSubmitResponse)
async def submit_support_report(
    background_tasks: BackgroundTasks,
    response: Response,
    request: Request,
    message: str = Form(..., max_length=10000),
    title: Optional[str] = Form(None, max_length=200),
    where_happened: Optional[str] = Form(None, max_length=2000),
    steps_to_reproduce: Optional[str] = Form(None, max_length=10000),
    expected_behavior: Optional[str] = Form(None, max_length=5000),
    category: Optional[str] = Form("other"),
    email_override: Optional[str] = Form(None),
    generation_id: Optional[uuid.UUID] = Form(None),
    turnstile_token: Optional[str] = Form(None),
    screenshots: List[UploadFile] = File(default=[]),
    voice: Optional[UploadFile] = File(default=None),
    current_user: Optional[User] = Depends(get_support_user),
    db: AsyncSession = Depends(get_db),
):
    if not message.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message content cannot be empty",
        )
    raw_guest_key = guest_key_from_request(request)
    client_ip = _trusted_client_ip(request)
    # Only a valid cookie actually carried by the request gets a cookie bucket.
    # Mint a fresh key only after rate limiting so cookieless guests cannot
    # bypass the bucket with a fresh key per request.
    await _rate_limit_prepare(db, current_user, raw_guest_key, client_ip, is_ticket=True)

    if email_override:
        email_override = email_override.strip()
        if len(email_override) > 254 or "@" not in email_override or any(c.isspace() for c in email_override):
            raise HTTPException(422, "Enter a valid email address")
    if category not in {"bug", "billing", "feedback", "feature", "generation", "import", "template", "account", "other"}:
        raise HTTPException(422, "Choose a valid report category")
    if generation_id:
        generation = await db.get(Generation, generation_id)
        if not current_user or not generation or generation.user_id != current_user.id:
            raise HTTPException(404, "Generation not found")
    if len(screenshots) > 5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Maximum 5 screenshots allowed per report")
    validated_screenshots = []
    for img in screenshots:
        if img.filename:
            content = await img.read()
            if len(content) > MAX_IMAGE_SIZE_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=f"Image {img.filename} exceeds maximum allowed size of 5 MB")
            mime = img.content_type or "image/png"
            if mime not in ALLOWED_IMAGE_TYPES:
                raise HTTPException(415, "Screenshots must be JPEG, PNG, WebP, or GIF images")
            validated_screenshots.append((img.filename, content, mime))
    validated_voice = None
    if voice and voice.filename:
        voice_content = await voice.read()
        if len(voice_content) > MAX_VOICE_SIZE_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Voice recording exceeds maximum allowed size of 25 MB")
        voice_mime = voice.content_type or "audio/webm"
        if voice_mime.split(";", 1)[0] not in ALLOWED_VOICE_TYPES:
            raise HTTPException(415, "Unsupported audio recording format")
        validated_voice = (voice.filename, voice_content, voice_mime)

    # Turnstile runs after the cheap checks (so form errors surface first and a valid token
    # is not burned on them) but before any upload or report write.
    if not current_user:
        await verify_turnstile(turnstile_token, client_ip)
    need_new_key = False
    if not current_user and not raw_guest_key:
        raw_guest_key = new_guest_key()
        need_new_key = True

    user_id = current_user.id if current_user else None
    guest_hash = None
    if not current_user and raw_guest_key:
        guest_hash = hash_guest_key(raw_guest_key)
    report = SupportReport(
        user_id=user_id,
        email_override=email_override or (current_user.email if current_user else None),
        message=message.strip(),
        title=title.strip() if title else None,
        where_happened=where_happened,
        steps_to_reproduce=steps_to_reproduce,
        expected_behavior=expected_behavior,
        category=category or "other",
        status="open",
        generation_id=generation_id,
        guest_key_hash=guest_hash,
    )
    db.add(report)
    await db.flush()
    storage = StorageService()
    for filename, content, mime in validated_screenshots:
        att_id = uuid.uuid4()
        ext = "webp" if "webp" in mime else ("png" if "png" in mime else "jpg")
        key = f"feedback/screenshots/{report.id}/{att_id}.{ext}"
        uploaded_key = storage.upload_bytes(content, key, content_type=mime)
        if not uploaded_key:
            await db.rollback()
            raise HTTPException(503, "Screenshot upload failed. Please try again.")
        attachment = ReportAttachment(id=att_id, report_id=report.id, attachment_type="screenshot", storage_key=key, filename=filename, mime_type=mime, file_size_bytes=len(content))
        db.add(attachment)
    if validated_voice:
        v_name, v_content, v_mime = validated_voice
        att_id = uuid.uuid4()
        ext = "webm" if "webm" in v_mime else ("mp4" if "mp4" in v_mime else "wav")
        key = f"feedback/voice/{report.id}/{att_id}.{ext}"
        if not storage.upload_bytes(v_content, key, content_type=v_mime):
            await db.rollback()
            raise HTTPException(503, "Voice recording upload failed. Please try again.")
        db.add(ReportAttachment(id=att_id, report_id=report.id, attachment_type="voice_recording", storage_key=key, filename=v_name, mime_type=v_mime, file_size_bytes=len(v_content)))
    await db.commit()
    if need_new_key and raw_guest_key:
        set_guest_cookie(response, raw_guest_key)
    background_tasks.add_task(notify_submission, report.id)
    try:
        from src.services.feedback_ai import process_new_support_report
        background_tasks.add_task(process_new_support_report, report.id)
    except Exception as e:
        logger.error(f"Failed to enqueue background task for report {report.id}: {e}")
    return SupportReportSubmitResponse(id=report.id, status=report.status, message="Support request submitted successfully", access_token=guest_token(report.id) if not current_user else None)


@router.get("/support")
async def list_my_support_reports(request: Request, current_user: User | None = Depends(get_support_user), db: AsyncSession = Depends(get_db)):
    reports: list[SupportReport] = []
    seen: set = set()
    if current_user:
        user_reports = (await db.execute(select(SupportReport).where(SupportReport.user_id == current_user.id).order_by(SupportReport.updated_at.desc()))).scalars().all()
        for r in user_reports:
            if r.id not in seen:
                seen.add(r.id)
                reports.append(r)
    guest_hash = guest_key_hash_from_cookie(guest_key_from_request(request))
    if guest_hash:
        guest_reports = (await db.execute(select(SupportReport).where(SupportReport.guest_key_hash == guest_hash).order_by(SupportReport.updated_at.desc()))).scalars().all()
        for r in guest_reports:
            if r.id not in seen:
                seen.add(r.id)
                reports.append(r)
    reports.sort(key=lambda r: (r.updated_at or r.created_at or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    last_map = await last_admin_reply_map(db, [r.id for r in reports])
    output = []
    for r in reports:
        row = report_out(r, last_admin_reply_at=last_map.get(r.id), include_access_token=(r.user_id is None))
        output.append(row)
    return output


@router.get("/support/{id}")
async def get_my_support_report(id: uuid.UUID, request: Request, access_token: str | None = None, current_user: User | None = Depends(get_support_user), db: AsyncSession = Depends(get_db)):
    report = await accessible_report(db, id, current_user, access_token, guest_key_hash_from_cookie(guest_key_from_request(request)))
    return await report_detail(db, report, is_admin(current_user))


@router.post("/support/{id}/messages")
async def reply_to_support_report(id: uuid.UUID, data: ReplyCreate, request: Request, access_token: str | None = None, current_user: User | None = Depends(get_support_user), db: AsyncSession = Depends(get_db)):
    raw_cookie = guest_key_from_request(request)
    client_ip = _trusted_client_ip(request)
    # IP bucket before access so junk requests cannot burn real users' buckets.
    await _rate_limit_ip_only(db, current_user, client_ip, is_ticket=False)
    report = await accessible_report(db, id, current_user, access_token, guest_key_hash_from_cookie(raw_cookie))
    await _rate_limit_after_access(db, current_user, raw_cookie, is_ticket=False, report_id=report.id)
    return await append_reply(db, report, data, current_user, is_admin(current_user))


class OwnerStatusUpdate(BaseModel):
    status: Literal["open", "resolved", "closed"]


@router.patch("/support/{id}")
async def update_my_support_report(id: uuid.UUID, data: OwnerStatusUpdate, request: Request, access_token: str | None = None, current_user: User | None = Depends(get_support_user), db: AsyncSession = Depends(get_db)):
    raw_cookie = guest_key_from_request(request)
    report = await accessible_report(db, id, current_user, access_token, guest_key_hash_from_cookie(raw_cookie))
    await _rate_limit_prepare(db, current_user, raw_cookie, _trusted_client_ip(request), is_ticket=False, report_id=report.id)
    add_status_event(db, report, data.status, current_user)
    await db.commit()
    return {"status": "success", "report_status": report.status}


@router.post("/rating", response_model=FeedbackRatingOut)
async def submit_feedback_rating(
    data: RatingCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(FeedbackRating).where(FeedbackRating.user_id == current_user.id)
    if data.generation_id:
        stmt = stmt.where(FeedbackRating.generation_id == data.generation_id)
    result = await db.execute(stmt)
    existing_rating = result.scalars().first()
    if existing_rating:
        existing_rating.star_rating = data.star_rating
        existing_rating.comment = data.comment
        existing_rating.dismissed = data.dismissed
        if data.shown_at:
            existing_rating.shown_at = data.shown_at
        current_user.feedback_submitted = True
        await db.commit()
        await db.refresh(existing_rating)
        return existing_rating
    rating = FeedbackRating(user_id=current_user.id, generation_id=data.generation_id, star_rating=data.star_rating, comment=data.comment, shown_at=data.shown_at, dismissed=data.dismissed)
    db.add(rating)
    current_user.feedback_submitted = True
    await db.commit()
    await db.refresh(rating)
    return rating


@router.get("/rating/check", response_model=RatingCheckResponse)
async def check_feedback_prompt(generation_id: Optional[uuid.UUID] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    stmt = select(FeedbackRating).where(FeedbackRating.user_id == current_user.id)
    result = await db.execute(stmt)
    existing_rating = result.scalars().first()
    if existing_rating is not None:
        return RatingCheckResponse(should_prompt=False, already_rated=not existing_rating.dismissed)
    count_stmt = select(func.count(Generation.id)).where(Generation.user_id == current_user.id, Generation.status == "completed")
    count_result = await db.execute(count_stmt)
    completed_count = count_result.scalar() or 0
    return RatingCheckResponse(should_prompt=completed_count >= 2, already_rated=False)


@router.post("/rating/dismiss")
async def dismiss_feedback_prompt(generation_id: Optional[uuid.UUID] = None, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    stmt = select(FeedbackRating).where(FeedbackRating.user_id == current_user.id)
    result = await db.execute(stmt)
    rating = result.scalar_one_or_none()
    if not rating:
        rating = FeedbackRating(user_id=current_user.id, generation_id=generation_id, star_rating=0, comment=None, dismissed=True)
        db.add(rating)
    else:
        rating.dismissed = True
    await db.commit()
    return {"status": "dismissed"}
