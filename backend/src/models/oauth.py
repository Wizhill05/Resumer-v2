from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ARRAY, Boolean, DateTime, ForeignKey, JSON, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.models.user import Base


class OAuthClient(Base):
    __tablename__ = "oauth_clients"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True).with_variant(String(36), "sqlite"), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    client_secret_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    client_name: Mapped[str] = mapped_column(String, nullable=False)
    redirect_uris: Mapped[list[str]] = mapped_column(ARRAY(String).with_variant(JSON, "sqlite"), nullable=False, default=list)
    grant_types: Mapped[list[str]] = mapped_column(ARRAY(String).with_variant(JSON, "sqlite"), nullable=False, default=lambda: ["authorization_code", "refresh_token"])
    response_types: Mapped[list[str]] = mapped_column(ARRAY(String).with_variant(JSON, "sqlite"), nullable=False, default=lambda: ["code"])
    scope: Mapped[str] = mapped_column(String, nullable=False, default="profile:read profile:write resume:generate resume:edit offline_access")
    is_confidential: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OAuthAuthorizationCode(Base):
    __tablename__ = "oauth_authorization_codes"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True).with_variant(String(36), "sqlite"), primary_key=True, default=uuid.uuid4)
    code_hash: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    client_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True).with_variant(String(36), "sqlite"), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(String, nullable=False)
    scope: Mapped[str] = mapped_column(String, nullable=False)
    code_challenge: Mapped[str] = mapped_column(String, nullable=False)
    code_challenge_method: Mapped[str] = mapped_column(String, default="S256", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OAuthRefreshToken(Base):
    __tablename__ = "oauth_refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True).with_variant(String(36), "sqlite"), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    client_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True).with_variant(String(36), "sqlite"), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    scope: Mapped[str] = mapped_column(String, nullable=False)
    family_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True).with_variant(String(36), "sqlite"), default=uuid.uuid4, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
