"""add_generations_user_created_index

Serves the History list (`WHERE user_id = ? ORDER BY created_at DESC, id DESC`)
and the dashboard summary aggregates without a sort or full table scan.

Revision ID: a7c3e9f1b2d4
Revises: f1a2b3c4d5e6
Create Date: 2026-11-09 00:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a7c3e9f1b2d4"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX_NAME = "ix_generations_user_created"
# Created by hand in production (not tracked by Alembic) as (user_id, created_at DESC).
# The new index covers it, so it is replaced rather than kept as a duplicate.
LEGACY_INDEX_NAME = "ix_generations_user_created_at"


def upgrade() -> None:
    # Plain (non-concurrent) build is fine at this table size.
    op.create_index(
        INDEX_NAME,
        "generations",
        ["user_id", sa.text("created_at DESC"), sa.text("id DESC")],
        postgresql_concurrently=False,
    )
    op.execute(f"DROP INDEX IF EXISTS {LEGACY_INDEX_NAME}")


def downgrade() -> None:
    op.execute(
        f"CREATE INDEX IF NOT EXISTS {LEGACY_INDEX_NAME} ON generations (user_id, created_at DESC)"
    )
    op.drop_index(INDEX_NAME, table_name="generations")
