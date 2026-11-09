from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Integer, Boolean, JSON, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String)
    image: Mapped[str | None] = mapped_column(String)
    provider: Mapped[str | None] = mapped_column(String)
    hashed_password: Mapped[str | None] = mapped_column(String, nullable=True)
    first_generation_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    feedback_submitted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    is_pro: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    preferred_projects: Mapped[int | None] = mapped_column(Integer)
    preferred_experience: Mapped[int | None] = mapped_column(Integer)
    preferred_section_orders: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
    preferred_creativity_mode: Mapped[str | None] = mapped_column(String, default="proper", server_default="proper")
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    signup_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Getting-started guide state, synced across devices: {"dismissed": bool, "seen": [tip ids]}.
    onboarding_state: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
