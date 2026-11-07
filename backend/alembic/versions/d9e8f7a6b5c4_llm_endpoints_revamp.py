"""llm_endpoints_revamp

Revision ID: d9e8f7a6b5c4
Revises: aa1b2c3d4e5f
Create Date: 2026-11-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'd9e8f7a6b5c4'
down_revision: Union[str, Sequence[str], None] = 'aa1b2c3d4e5f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "llm_endpoints",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("base_url", sa.String(2048), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("api_key_hint", sa.String(16), nullable=True),
        sa.Column("extra_headers", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("extra_body", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("structured_output_mode", sa.String(16), server_default="json_schema", nullable=False),
        sa.Column("timeout_seconds", sa.Float(), server_default="60.0", nullable=False),
        sa.Column("max_retries", sa.Integer(), server_default="1", nullable=False),
        sa.Column("default_temperature", sa.Float(), server_default="0.2", nullable=False),
        sa.Column("max_output_tokens", sa.Integer(), nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("default_model", sa.String(256), nullable=True),
        sa.Column("models_cache", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("models_fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_check_status", sa.String(16), nullable=True),
        sa.Column("last_check_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_check_latency_ms", sa.Float(), nullable=True),
        sa.Column("last_check_error", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "llm_role_assignments",
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("targets", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=True),
        sa.Column("max_output_tokens", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("role"),
    )
    op.execute("DROP TABLE IF EXISTS llm_provider_configs")


def downgrade() -> None:
    op.drop_table("llm_role_assignments")
    op.drop_table("llm_endpoints")
    op.create_table(
        "llm_provider_configs",
        sa.Column("tier", sa.String(), nullable=False),
        sa.Column("provider_name", sa.String(), server_default="openai_compatible"),
        sa.Column("base_url", sa.String(), nullable=False),
        sa.Column("model", sa.String(), nullable=False),
        sa.Column("temperature", sa.Float(), server_default="0.2"),
        sa.Column("fallback_provider", sa.String(), server_default="openrouter"),
        sa.Column("fallback_model", sa.String(), server_default="google/gemini-3.8-flash"),
        sa.Column("extra_headers", postgresql.JSONB()),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("tier"),
    )
