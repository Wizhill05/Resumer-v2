"""add_section_order_to_users_and_generations

Revision ID: c7a1e2f3d4b5
Revises: b6e4f2a8c910
Create Date: 2026-11-03 16:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'c7a1e2f3d4b5'
down_revision: Union[str, Sequence[str], None] = 'b6e4f2a8c910'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('preferred_section_orders', JSONB().with_variant(sa.JSON(), 'sqlite'), nullable=True)
    )
    op.add_column(
        'generations',
        sa.Column('section_order', JSONB().with_variant(sa.JSON(), 'sqlite'), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('generations', 'section_order')
    op.drop_column('users', 'preferred_section_orders')
