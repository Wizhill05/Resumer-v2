"""add_user_hashed_password

Revision ID: 18d960a407fa
Revises: d4m0d3d3f4u5
Create Date: 2026-10-09 10:04:27.783934

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '18d960a407fa'
down_revision: Union[str, Sequence[str], None] = 'd4m0d3d3f4u5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'users',
        sa.Column('hashed_password', sa.String(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'hashed_password')
