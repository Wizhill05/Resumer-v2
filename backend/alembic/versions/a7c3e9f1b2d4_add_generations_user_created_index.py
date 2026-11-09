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


def upgrade() -> None:
    # Plain (non-concurrent) build is fine at this table size.
    op.create_index(
        INDEX_NAME,
        "generations",
        ["user_id", sa.text("created_at DESC"), sa.text("id DESC")],
        postgresql_concurrently=False,
    )


def downgrade() -> None:
    op.drop_index(INDEX_NAME, table_name="generations")
