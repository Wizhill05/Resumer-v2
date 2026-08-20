"""remove_api_keys_from_llm_provider_configs

Revision ID: c2d3e4f5a6b7
Revises: b8c9d0e1f2a3
Create Date: 2026-08-20 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, Sequence[str], None] = 'b8c9d0e1f2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Safely drop api_keys column from llm_provider_configs if it exists
    op.execute(
        sa.text("ALTER TABLE llm_provider_configs DROP COLUMN IF EXISTS api_keys")
    )


def downgrade() -> None:
    op.execute(
        sa.text("ALTER TABLE llm_provider_configs ADD COLUMN IF NOT EXISTS api_keys JSONB")
    )
