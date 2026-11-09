from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.auth import get_current_user
from src.core.database import get_db
from src.models.profile import Profile
from src.models.user import User

router = APIRouter(prefix="/account", tags=["account"])


def _clean(value):
    """Strip strings; empty strings are treated as not provided (None)."""
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _is_linkedin_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except Exception:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    return host == "linkedin.com" or host.endswith(".linkedin.com")


@router.get("/welcome")
async def get_welcome(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
    profile = result.scalar_one_or_none()
    if profile:
        full_name = profile.full_name or current_user.name or None
        return {
            "full_name": full_name,
            "subtitle": profile.subtitle or None,
            "location": profile.location or None,
            "phone": profile.phone or None,
            "linkedin_url": profile.linkedin_url or None,
        }
    return {
        "full_name": current_user.name or None,
        "subtitle": None,
        "location": None,
        "phone": None,
        "linkedin_url": None,
    }


@router.post("/welcome")
async def post_welcome(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request body.")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid request body.")

    skip = payload.get("skip", False)
    if skip is None:
        skip = False
    if not isinstance(skip, bool):
        raise HTTPException(status_code=400, detail="Skip must be true or false.")

    # full_name: required, stripped, 1-100 chars
    raw_name = payload.get("full_name")
    if not isinstance(raw_name, str):
        raise HTTPException(status_code=400, detail="Name is required.")
    full_name = raw_name.strip()
    if not full_name:
        raise HTTPException(status_code=400, detail="Name is required.")
    if len(full_name) > 100:
        raise HTTPException(status_code=400, detail="Name must be 100 characters or fewer.")

    subtitle: str | None = None
    location: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None

    if not skip:
        raw_subtitle = payload.get("subtitle")
        if raw_subtitle is not None and not isinstance(raw_subtitle, str):
            raise HTTPException(status_code=400, detail="Invalid subtitle.")
        subtitle = _clean(raw_subtitle) if isinstance(raw_subtitle, str) else None
        if subtitle is None:
            raise HTTPException(status_code=400, detail="Please tell us what role you're targeting.")
        if len(subtitle) > 120:
            raise HTTPException(status_code=400, detail="Subtitle must be 120 characters or fewer.")

        for field, max_len, label in (
            ("location", 120, "Location must be 120 characters or fewer."),
            ("phone", 40, "Phone must be 40 characters or fewer."),
        ):
            raw_val = payload.get(field)
            if raw_val is not None and not isinstance(raw_val, str):
                raise HTTPException(status_code=400, detail=f"Invalid {field}.")
            cleaned = _clean(raw_val) if isinstance(raw_val, str) else None
            if cleaned is not None and len(cleaned) > max_len:
                raise HTTPException(status_code=400, detail=label)
            if field == "location":
                location = cleaned
            else:
                phone = cleaned

        raw_linkedin = payload.get("linkedin_url")
        if raw_linkedin is not None and not isinstance(raw_linkedin, str):
            raise HTTPException(status_code=400, detail="Invalid linkedin_url.")
        linkedin_url = _clean(raw_linkedin) if isinstance(raw_linkedin, str) else None
        if linkedin_url is not None and not _is_linkedin_url(linkedin_url):
            raise HTTPException(status_code=400, detail="Enter a valid LinkedIn URL.")

    result = await db.execute(select(Profile).where(Profile.user_id == current_user.id))
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = Profile(user_id=current_user.id)
        db.add(profile)

    current_user.name = full_name
    profile.full_name = full_name

    # Seed the contact email from the account email, but never overwrite one the
    # user (or an import) already set.
    if not _clean(profile.email) and _clean(current_user.email):
        profile.email = current_user.email.strip()

    if not skip:
        if subtitle is not None:
            profile.subtitle = subtitle
        if location is not None:
            profile.location = location
        if phone is not None:
            profile.phone = phone
        if linkedin_url is not None:
            profile.linkedin_url = linkedin_url

    if current_user.signup_completed_at is None:
        current_user.signup_completed_at = datetime.now(timezone.utc)

    await db.commit()
    return {"ok": True}
