from __future__ import annotations

import uuid
from datetime import datetime
import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user, get_optional_user
from src.core.database import get_db
from src.core.storage import StorageService
from src.models.generation import FeedbackRating, Generation, ReportAttachment, SupportReport
from src.models.user import User
from src.services.support import (ReplyCreate, accessible_report, add_status_event, append_reply, guest_token, is_admin, notify_submission, report_detail, report_out)

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


@router.post("/support", response_model=SupportReportSubmitResponse)
async def submit_support_report(
    background_tasks: BackgroundTasks,
    message: str = Form(..., max_length=10000),
    title: Optional[str] = Form(None, max_length=200),
    where_happened: Optional[str] = Form(None, max_length=2000),
    steps_to_reproduce: Optional[str] = Form(None, max_length=10000),
    expected_behavior: Optional[str] = Form(None, max_length=5000),
    category: Optional[str] = Form("other"),
    email_override: Optional[str] = Form(None),
    generation_id: Optional[uuid.UUID] = Form(None),
    screenshots: List[UploadFile] = File(default=[]),
    voice: Optional[UploadFile] = File(default=None),
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Submit a support report / bug feedback with optional screenshot images and a voice message recording.
    """
    if not message.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message content cannot be empty",
        )

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

    # Validate screenshots count and size
    if len(screenshots) > 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 5 screenshots allowed per report",
        )

    validated_screenshots = []
    for img in screenshots:
        if img.filename:
            content = await img.read()
            if len(content) > MAX_IMAGE_SIZE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Image {img.filename} exceeds maximum allowed size of 5 MB",
                )
            mime = img.content_type or "image/png"
            if mime not in ALLOWED_IMAGE_TYPES:
                raise HTTPException(415, "Screenshots must be JPEG, PNG, WebP, or GIF images")
            validated_screenshots.append((img.filename, content, mime))

    # Validate voice message
    validated_voice = None
    if voice and voice.filename:
        voice_content = await voice.read()
        if len(voice_content) > MAX_VOICE_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Voice recording exceeds maximum allowed size of 25 MB",
            )
        voice_mime = voice.content_type or "audio/webm"
        if voice_mime.split(";", 1)[0] not in ALLOWED_VOICE_TYPES:
            raise HTTPException(415, "Unsupported audio recording format")
        validated_voice = (voice.filename, voice_content, voice_mime)

    # Create SupportReport record
    user_id = current_user.id if current_user else None
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
    )
    db.add(report)
    await db.flush()  # Generate report.id

    storage = StorageService()

    # Upload screenshots to R2
    for filename, content, mime in validated_screenshots:
        att_id = uuid.uuid4()
        ext = "webp" if "webp" in mime else ("png" if "png" in mime else "jpg")
        key = f"feedback/screenshots/{report.id}/{att_id}.{ext}"

        uploaded_key = storage.upload_bytes(content, key, content_type=mime)
        if not uploaded_key:
            await db.rollback()
            raise HTTPException(503, "Screenshot upload failed. Please try again.")

        attachment = ReportAttachment(
            id=att_id,
            report_id=report.id,
            attachment_type="screenshot",
            storage_key=key,
            filename=filename,
            mime_type=mime,
            file_size_bytes=len(content),
        )
        db.add(attachment)

    # Upload voice recording to R2
    if validated_voice:
        v_name, v_content, v_mime = validated_voice
        att_id = uuid.uuid4()
        ext = "webm" if "webm" in v_mime else ("mp4" if "mp4" in v_mime else "wav")
        key = f"feedback/voice/{report.id}/{att_id}.{ext}"

        if not storage.upload_bytes(v_content, key, content_type=v_mime):
            await db.rollback()
            raise HTTPException(503, "Voice recording upload failed. Please try again.")
        v_attachment = ReportAttachment(
            id=att_id,
            report_id=report.id,
            attachment_type="voice_recording",
            storage_key=key,
            filename=v_name,
            mime_type=v_mime,
            file_size_bytes=len(v_content),
        )
        db.add(v_attachment)

    await db.commit()

    background_tasks.add_task(notify_submission, report.id)

    # AI enrichment is optional and must not delay the support notification.
    try:
        from src.services.feedback_ai import process_new_support_report
        background_tasks.add_task(process_new_support_report, report.id)
    except Exception as e:
        logger.error(f"Failed to enqueue background task for report {report.id}: {e}")

    return SupportReportSubmitResponse(
        id=report.id,
        status=report.status,
        message="Support request submitted successfully",
        access_token=guest_token(report.id) if not current_user else None,
    )


@router.get("/support")
async def list_my_support_reports(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    reports = (await db.execute(select(SupportReport).where(SupportReport.user_id == current_user.id).order_by(SupportReport.updated_at.desc()))).scalars().all()
    return [report_out(report) for report in reports]


@router.get("/support/{id}")
async def get_my_support_report(id: uuid.UUID, access_token: str | None = None,
                                current_user: User | None = Depends(get_optional_user), db: AsyncSession = Depends(get_db)):
    report = await accessible_report(db, id, current_user, access_token)
    return await report_detail(db, report, is_admin(current_user))


@router.post("/support/{id}/messages")
async def reply_to_support_report(id: uuid.UUID, data: ReplyCreate, access_token: str | None = None,
                                  current_user: User | None = Depends(get_optional_user), db: AsyncSession = Depends(get_db)):
    report = await accessible_report(db, id, current_user, access_token)
    return await append_reply(db, report, data, current_user, is_admin(current_user))


class OwnerStatusUpdate(BaseModel):
    status: Literal["open", "resolved", "closed"]


@router.patch("/support/{id}")
async def update_my_support_report(id: uuid.UUID, data: OwnerStatusUpdate, access_token: str | None = None,
                                   current_user: User | None = Depends(get_optional_user), db: AsyncSession = Depends(get_db)):
    report = await accessible_report(db, id, current_user, access_token)
    add_status_event(db, report, data.status, current_user)
    await db.commit()
    return {"status": "success", "report_status": report.status}


@router.post("/rating", response_model=FeedbackRatingOut)
async def submit_feedback_rating(
    data: RatingCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Submit a post-first-generation experience rating (1 to 5 stars).
    """
    # Check for existing rating for this user and generation
    stmt = select(FeedbackRating).where(
        FeedbackRating.user_id == current_user.id
    )
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

    rating = FeedbackRating(
        user_id=current_user.id,
        generation_id=data.generation_id,
        star_rating=data.star_rating,
        comment=data.comment,
        shown_at=data.shown_at,
        dismissed=data.dismissed,
    )
    db.add(rating)

    current_user.feedback_submitted = True
    await db.commit()
    await db.refresh(rating)

    return rating


@router.get("/rating/check", response_model=RatingCheckResponse)
async def check_feedback_prompt(
    generation_id: Optional[uuid.UUID] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Check if the post-generation feedback modal should be prompted to the current user.
    Only prompts on the SECOND (or higher) completed generation and only ONCE per user.
    """
    # 1. Check if user already has ANY rating or dismissal record
    stmt = select(FeedbackRating).where(FeedbackRating.user_id == current_user.id)
    result = await db.execute(stmt)
    existing_rating = result.scalars().first()

    if existing_rating is not None:
        return RatingCheckResponse(
            should_prompt=False,
            already_rated=not existing_rating.dismissed,
        )

    # 2. Count total completed generations for current user
    count_stmt = (
        select(func.count(Generation.id))
        .where(
            Generation.user_id == current_user.id,
            Generation.status == "completed",
        )
    )
    count_result = await db.execute(count_stmt)
    completed_count = count_result.scalar() or 0

    # 3. Only prompt if the user has completed AT LEAST 2 generations
    should_prompt = completed_count >= 2

    return RatingCheckResponse(
        should_prompt=should_prompt,
        already_rated=False,
    )


@router.post("/rating/dismiss")
async def dismiss_feedback_prompt(
    generation_id: Optional[uuid.UUID] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Permanently dismiss the post-generation rating modal for the current user.
    """
    stmt = select(FeedbackRating).where(FeedbackRating.user_id == current_user.id)
    result = await db.execute(stmt)
    rating = result.scalar_one_or_none()

    if not rating:
        rating = FeedbackRating(
            user_id=current_user.id,
            generation_id=generation_id,
            star_rating=0,
            comment=None,
            dismissed=True,
        )
        db.add(rating)
    else:
        rating.dismissed = True

    await db.commit()
    return {"status": "dismissed"}
