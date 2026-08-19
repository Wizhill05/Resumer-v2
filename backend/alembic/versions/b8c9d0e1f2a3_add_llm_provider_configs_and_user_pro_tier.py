"""add_llm_provider_configs_and_user_pro_tier

Revision ID: b8c9d0e1f2a3
Revises: a7d8e9f0c1b2
Create Date: 2026-08-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b8c9d0e1f2a3'
down_revision: Union[str, Sequence[str], None] = 'a7d8e9f0c1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add is_pro column to users
    op.execute(
        sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT false")
    )

    # 2. Create llm_provider_configs table
    op.execute(
        sa.text("""
        CREATE TABLE IF NOT EXISTS llm_provider_configs (
            tier VARCHAR PRIMARY KEY,
            provider_name VARCHAR NOT NULL DEFAULT 'openai_compatible',
            base_url VARCHAR NOT NULL,
            model VARCHAR NOT NULL,
            api_keys JSONB,
            temperature FLOAT NOT NULL DEFAULT 0.2,
            fallback_provider VARCHAR DEFAULT 'google',
            fallback_model VARCHAR DEFAULT 'gemma-4-31b-it',
            extra_headers JSONB,
            is_active BOOLEAN NOT NULL DEFAULT true,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """)
    )


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS llm_provider_configs"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS is_pro"))
