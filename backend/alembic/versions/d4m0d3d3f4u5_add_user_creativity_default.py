"""add_user_creativity_default_and_larp_default

Revision ID: d4m0d3d3f4u5
Revises: c3m0d3l4a5r6
Create Date: 2026-09-17 13:00:00.000000

Adds users.preferred_creativity_mode (default larp) and switches the
generations.creativity_mode server default from proper to larp.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4m0d3d3f4u5'
down_revision: Union[str, Sequence[str], None] = 'c3m0d3l4a5r6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('preferred_creativity_mode', sa.String(), nullable=True, server_default='larp'),
    )
    op.alter_column(
        'generations', 'creativity_mode',
        existing_type=sa.String(),
        server_default='larp',
    )


def downgrade() -> None:
    op.alter_column(
        'generations', 'creativity_mode',
        existing_type=sa.String(),
        server_default='proper',
    )
    op.drop_column('users', 'preferred_creativity_mode')
