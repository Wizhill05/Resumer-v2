"""add_guest_generations

Revision ID: e7b1a9c4d8f2
Revises: d2b5f1a9e347
Create Date: 2026-07-04 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = "e7b1a9c4d8f2"
down_revision: Union[str, Sequence[str], None] = "d2b5f1a9e347"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("generations", sa.Column("is_guest", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("generations", sa.Column("guest_token_hash", sa.String(), nullable=True))
    op.add_column("generations", sa.Column("guest_input_snapshot", JSONB(), nullable=True))
    op.add_column("generations", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_generations_guest_token_hash", "generations", ["guest_token_hash"])
    op.create_table(
        "guest_rate_limits",
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reset_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("token_hash"),
    )


def downgrade() -> None:
    op.drop_table("guest_rate_limits")
    op.drop_index("ix_generations_guest_token_hash", table_name="generations")
    op.drop_column("generations", "expires_at")
    op.drop_column("generations", "guest_input_snapshot")
    op.drop_column("generations", "guest_token_hash")
    op.drop_column("generations", "is_guest")
