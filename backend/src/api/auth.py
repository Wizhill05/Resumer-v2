import re
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.database import get_db
from src.core.security import hash_password, verify_password
from src.models.user import User

router = APIRouter(prefix="/auth/email", tags=["auth"])

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


class EmailRegisterRequest(BaseModel):
    email: str = Field(..., description="User email address")
    password: str = Field(..., min_length=6, max_length=128, description="Password (at least 6 characters)")
    name: str | None = Field(default=None, max_length=100, description="Optional display name")


class EmailLoginRequest(BaseModel):
    email: str = Field(..., description="User email address")
    password: str = Field(..., description="Password")


class AuthUserResponse(BaseModel):
    id: str
    email: str
    name: str | None = None
    image: str | None = None
    provider: str | None = None


def normalize_email(email: str) -> str:
    cleaned = email.strip().lower()
    if not EMAIL_REGEX.match(cleaned):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide a valid email address.",
        )
    return cleaned


@router.post("/register", response_model=AuthUserResponse)
async def register_email_user(
    payload: EmailRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    email = normalize_email(payload.email)
    password = payload.password.strip()

    if len(password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters long.",
        )

    result = await db.execute(select(User).where(User.email == email))
    existing_user = result.scalar_one_or_none()

    if existing_user:
        if existing_user.hashed_password:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists. Please sign in instead.",
            )
        # Account exists from social login (Google/GitHub) without a password.
        # Allow attaching an email password so the user can log in via both methods.
        existing_user.hashed_password = hash_password(password)
        if payload.name and not existing_user.name:
            existing_user.name = payload.name.strip()
        await db.commit()
        await db.refresh(existing_user)
        return AuthUserResponse(
            id=str(existing_user.id),
            email=existing_user.email,
            name=existing_user.name,
            image=existing_user.image,
            provider=existing_user.provider,
        )

    # Create new user
    display_name = payload.name.strip() if payload.name else email.split("@")[0]
    new_user = User(
        email=email,
        name=display_name,
        hashed_password=hash_password(password),
        provider="credentials",
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    return AuthUserResponse(
        id=str(new_user.id),
        email=new_user.email,
        name=new_user.name,
        image=new_user.image,
        provider=new_user.provider,
    )


@router.post("/login", response_model=AuthUserResponse)
async def login_email_user(
    payload: EmailLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    email = normalize_email(payload.email)
    password = payload.password

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No account found with this email. Please check your email or create an account.",
        )

    if not user.hashed_password:
        social_provider = user.provider.capitalize() if user.provider else "social login"
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"This account was registered using {social_provider}. Please continue with {social_provider} or register a password.",
        )

    if not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password. Please try again.",
        )

    return AuthUserResponse(
        id=str(user.id),
        email=user.email,
        name=user.name,
        image=user.image,
        provider=user.provider,
    )
