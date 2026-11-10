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
    # Account deletion grace period (see src/services/account_deletion.py). While
    # deletion_scheduled_for is set the account is locked out of every auth path; a fresh
    # sign-in before that moment restores it, after it the purge job deletes the row.
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deletion_scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when a sign-in cancels a pending deletion; cleared once the user dismisses the notice.
    deletion_restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def is_pending_deletion(self) -> bool:
        return self.deletion_scheduled_for is not None


class AccountCleanupTask(Base):
    """External cleanup owed for a purged account (PostHog person, GitHub app grant).

    Written in the same transaction that deletes the user, so the obligation survives
    outages and restarts; src/services/account_deletion.py retries until it succeeds.
    Not linked to users.id on purpose: the user row is gone by the time this runs.
    """

    __tablename__ = "account_cleanup_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # "posthog_person" or "github_grant"
    kind: Mapped[str] = mapped_column(String, nullable=False)
    # posthog_person: {"distinct_ids": [...]}; github_grant: {"app": "login"|"connect",
    # "token_encrypted": <Fernet ciphertext copied from github_tokens>}
    payload: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False)
    # "pending" until done (then the row is deleted) or "failed" after too many attempts.
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending", server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
