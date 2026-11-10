import asyncio
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.database import get_db
from src.core.internal_token import is_valid_internal_token
from src.core.notify import send_account_restored_email, send_verification_code_email
from src.core.provider_messages import provider_mismatch_message
from src.core.security import hash_password, verify_password
from src.models.identity import EmailVerification
from src.models.user import User
from src.services.account_deletion import AccountDeletedError, is_due, purge_user, restore_if_pending

router = APIRouter(prefix="/auth/email", tags=["auth"])

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")

CODE_TTL_SECONDS = 900
RESEND_AFTER_SECONDS = 60
MAX_SENDS_PER_WINDOW = 3
MAX_SENDS_PER_IP_WINDOW = 10
SEND_WINDOW_SECONDS = 900
MIN_SEND_INTERVAL_SECONDS = 60
MAX_VERIFY_ATTEMPTS = 5

# Small in-process send limiter, keyed by normalized email AND by client IP.
# It is per-process only (no shared/distributed state) and exists to keep
# automated abuse of the verification emails in check without adding a
# migration for sent_count/last_sent_at columns.
_send_times: dict[str, list[datetime]] = {}


class EmailRegisterStartRequest(BaseModel):
    email: str = Field(..., description="User email address")
    password: str = Field(..., min_length=1, max_length=128, description="Password (8-128 characters)")
    name: str = Field(..., max_length=100, description="Display name (1-100 characters)")


class EmailRegisterVerifyRequest(BaseModel):
    email: str = Field(..., description="User email address")
    code: str = Field(..., description="6-digit verification code")
    password: str = Field(..., description="Password from the latest /register/start")


class EmailRegisterResendRequest(BaseModel):
    email: str = Field(..., description="User email address")


class EmailLoginRequest(BaseModel):
    email: str = Field(..., description="User email address")
    password: str = Field(..., description="Password")


class AuthUserResponse(BaseModel):
    id: str
    email: str
    name: str | None = None
    image: str | None = None
    provider: str | None = None
    needs_welcome: bool = False
    restored: bool = False


class RegisterStartResponse(BaseModel):
    ok: bool = True
    email: str
    expires_in: int = CODE_TTL_SECONDS
    resend_after: int = RESEND_AFTER_SECONDS


class RegisterResendResponse(BaseModel):
    ok: bool = True
    resend_after: int = RESEND_AFTER_SECONDS


def _require_internal_token(request: Request) -> None:
    """The registration endpoints are only called by the Next.js server, which sends an internal token.

    Rejecting everything else keeps direct callers from bypassing the per-IP send limit
    (X-Client-IP is only trusted alongside a valid internal token).
    """
    if not is_valid_internal_token(request.headers.get("Authorization")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid internal token",
        )


def normalize_email(email: str) -> str:
    cleaned = email.strip().lower()
    if not EMAIL_REGEX.match(cleaned):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide a valid email address.",
        )
    return cleaned


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    """SQLite drops tzinfo in tests; treat naive values as UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _is_expired(expires_at: datetime, now: datetime) -> bool:
    return _aware(expires_at) <= now


def _hash_code(email: str, code: str) -> str:
    """HMAC-SHA256 over the code, keyed with JWT_SECRET, scoped to the email."""
    return hmac.new(
        settings.JWT_SECRET.encode("utf-8"),
        f"{email}:{code}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _new_code() -> str:
    return f"{secrets.randbelow(900_000) + 100_000:06d}"


def _new_expiry(now: datetime) -> datetime:
    return now + timedelta(seconds=CODE_TTL_SECONDS)


def _client_ip(request: Request) -> str | None:
    # Only trust X-Client-IP when the request carries a valid internal
    # token; a forwarded IP on a public endpoint can be spoofed.
    if not is_valid_internal_token(request.headers.get("Authorization")):
        return None
    client_ip = request.headers.get("X-Client-IP")
    if not client_ip:
        return None
    cleaned = client_ip.split(",")[0].strip()
    return cleaned or None


def _prune_sends(key: str, now: datetime) -> list[datetime]:
    times = [t for t in _send_times.get(key, []) if (now - t).total_seconds() < SEND_WINDOW_SECONDS]
    _send_times[key] = times
    return times


def _check_rate_limit(email: str, client_ip: str | None, now: datetime) -> None:
    email_key = f"email:{email}"
    times = _prune_sends(email_key, now)
    if times and (now - times[-1]).total_seconds() < MIN_SEND_INTERVAL_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Please wait a minute before requesting another code.",
        )
    if len(times) >= MAX_SENDS_PER_WINDOW:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification emails. Please try again later.",
        )
    if client_ip is not None:
        ip_times = _prune_sends(f"ip:{client_ip}", now)
        if len(ip_times) >= MAX_SENDS_PER_IP_WINDOW:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many verification emails. Please try again later.",
            )


def _record_send(email: str, client_ip: str | None, now: datetime) -> None:
    email_key = f"email:{email}"
    times = _prune_sends(email_key, now)
    times.append(now)
    _send_times[email_key] = times
    if client_ip is not None:
        ip_key = f"ip:{client_ip}"
        ip_times = _prune_sends(ip_key, now)
        ip_times.append(now)
        _send_times[ip_key] = ip_times


async def _get_pending(db: AsyncSession, email: str) -> EmailVerification | None:
    result = await db.execute(select(EmailVerification).where(EmailVerification.email == email))
    return result.scalar_one_or_none()


async def _purge_due_or_503(db: AsyncSession, user: User) -> None:
    """Delete an account whose grace period is over, so its email is free again right away."""
    if not await purge_user(db, user.id):
        # Storage cleanup failed or the purge job holds the row; the hourly job will finish it.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="This account is being deleted. Try again in a few minutes.",
        )


async def _existing_user_or_409(db: AsyncSession, email: str) -> None:
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    existing = result.scalar_one_or_none()
    if not existing:
        return
    if is_due(existing):
        await _purge_due_or_503(db, existing)
        return
    if existing.is_pending_deletion:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account is scheduled for deletion. Sign in to restore it instead.",
        )
    if existing.provider in ("google", "github"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=provider_mismatch_message(existing.provider),
        )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="An account with this email already exists. Sign in instead.",
    )


async def _send_code(email: str, name: str, code: str) -> None:
    try:
        send_verification_code_email(email, name, code)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email sending is unavailable right now.",
        )


@router.post("/register/start", response_model=RegisterStartResponse, dependencies=[Depends(_require_internal_token)])
async def start_email_registration(
    payload: EmailRegisterStartRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    email = normalize_email(payload.email)

    name = (payload.name or "").strip()
    if len(name) < 1 or len(name) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name must be between 1 and 100 characters.",
        )

    password = payload.password
    if len(password) < 8 or len(password) > 128:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long.",
        )

    await _existing_user_or_409(db, email)

    now = _utcnow()
    client_ip = _client_ip(request)
    _check_rate_limit(email, client_ip, now)

    code = _new_code()
    code_hash = _hash_code(email, code)
    expires_at = _new_expiry(now)

    pending = await _get_pending(db, email)
    if pending is None:
        pending = EmailVerification(
            email=email,
            code_hash=code_hash,
            password_hash=hash_password(password),
            name=name,
            attempts=0,
            expires_at=expires_at,
        )
        db.add(pending)
    else:
        pending.code_hash = code_hash
        pending.password_hash = hash_password(password)
        pending.name = name
        pending.attempts = 0
        pending.expires_at = expires_at
    await db.commit()

    await _send_code(email, name, code)
    _record_send(email, client_ip, now)

    return RegisterStartResponse(ok=True, email=email)


@router.post("/register/verify", response_model=AuthUserResponse, dependencies=[Depends(_require_internal_token)])
async def verify_email_registration(
    payload: EmailRegisterVerifyRequest,
    db: AsyncSession = Depends(get_db),
):
    email = normalize_email(payload.email)
    code = (payload.code or "").strip()
    now = _utcnow()

    pending = await _get_pending(db, email)
    if pending is None or _is_expired(pending.expires_at, now):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code is wrong or expired.",
        )

    if pending.attempts >= MAX_VERIFY_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Request a new code.",
        )

    code_ok = hmac.compare_digest(pending.code_hash, _hash_code(email, code))
    password_ok = verify_password(payload.password, pending.password_hash)
    if not code_ok or not password_ok:
        pending.attempts += 1
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code is wrong or expired.",
        )

    # One transaction: re-check the email is still free, create the user,
    # and drop the pending sign-up.
    await _existing_user_or_409(db, email)

    new_user = User(
        email=email,
        name=pending.name,
        hashed_password=pending.password_hash,
        provider="credentials",
        email_verified_at=now,
        signup_completed_at=None,
    )
    db.add(new_user)
    await db.execute(delete(EmailVerification).where(EmailVerification.email == email))
    await db.commit()
    await db.refresh(new_user)

    return AuthUserResponse(
        id=str(new_user.id),
        email=new_user.email,
        name=new_user.name,
        image=new_user.image,
        provider=new_user.provider,
        needs_welcome=new_user.signup_completed_at is None,
    )


@router.post("/register/resend", response_model=RegisterResendResponse, dependencies=[Depends(_require_internal_token)])
async def resend_email_registration(
    payload: EmailRegisterResendRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    email = normalize_email(payload.email)

    pending = await _get_pending(db, email)
    if pending is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending sign-up found for this email.",
        )

    now = _utcnow()
    client_ip = _client_ip(request)
    _check_rate_limit(email, client_ip, now)

    code = _new_code()
    pending.code_hash = _hash_code(email, code)
    pending.attempts = 0
    pending.expires_at = _new_expiry(now)
    await db.commit()

    await _send_code(email, pending.name, code)
    _record_send(email, client_ip, now)

    return RegisterResendResponse(ok=True)


@router.post("/login", response_model=AuthUserResponse)
async def login_email_user(
    payload: EmailLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    email = normalize_email(payload.email)
    password = payload.password

    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()

    no_account = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="No account found with this email. Please check your email or create an account.",
    )
    if not user:
        raise no_account
    if is_due(user):
        # Grace period over: the account is gone even if the hourly purge hasn't run yet.
        await _purge_due_or_503(db, user)
        raise no_account

    if not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=provider_mismatch_message(user.provider),
        )

    if not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Please try again.",
        )

    # Signing in with the right password inside the grace period cancels the deletion.
    try:
        restored = await restore_if_pending(db, user)
    except AccountDeletedError:
        raise no_account
    if restored:
        await db.commit()
        await asyncio.to_thread(send_account_restored_email, user.email, user.name)

    return AuthUserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        image=user.image,
        provider=user.provider,
        needs_welcome=user.signup_completed_at is None,
        restored=restored,
    )
