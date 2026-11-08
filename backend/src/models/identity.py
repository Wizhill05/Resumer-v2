from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.models.user import Base


def _uuid_col(*args, **kwargs):
    return mapped_column(PG_UUID(as_uuid=True).with_variant(String(36), "sqlite"), *args, **kwargs)


class UserIdentity(Base):
    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_account_id", name="uq_user_identities_provider_account"),
        UniqueConstraint("user_id", "provider", name="uq_user_identities_user_provider"),
    )

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = _uuid_col(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    provider_account_id: Mapped[str | None] = mapped_column(String, nullable=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    provider_login: Mapped[str | None] = mapped_column(String, nullable=True)
    email_at_link: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GithubToken(Base):
    __tablename__ = "github_tokens"
    __table_args__ = (
        UniqueConstraint("identity_id", "oauth_app", name="uq_github_tokens_identity_app"),
    )

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True, default=uuid.uuid4)
    identity_id: Mapped[uuid.UUID] = _uuid_col(ForeignKey("user_identities.id", ondelete="CASCADE"), nullable=False, index=True)
    oauth_app: Mapped[str] = mapped_column(String, nullable=False)
    access_token_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    scopes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GithubLinkState(Base):
    __tablename__ = "github_link_states"

    state_hash: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[uuid.UUID] = _uuid_col(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    code_verifier: Mapped[str] = mapped_column(Text, nullable=False)
    want_private: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    attempts: Mapped[int] = mapped_column(default=0, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
