"""add_creativity_mode_to_generations

Revision ID: c3m0d3l4a5r6
Revises: e5c9f7a3b1d8
Create Date: 2026-09-17 12:00:00.000000

Adds creativity_mode (proper | larp | super_larp) to generations.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3m0d3l4a5r6'
down_revision: Union[str, Sequence[str], None] = 'e5c9f7a3b1d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'generations',
        sa.Column('creativity_mode', sa.String(), nullable=False, server_default='proper'),
    )


def downgrade() -> None:
    op.drop_column('generations', 'creativity_mode')
