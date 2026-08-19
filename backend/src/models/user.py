from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Integer, Boolean, func
from sqlalchemy.dialects.postgresql import UUID
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
    first_generation_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    feedback_submitted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    is_pro: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
