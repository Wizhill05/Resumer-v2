"""add_user_content_split_preference

Revision ID: e5c9f7a3b1d8
Revises: c2d3e4f5a6b7
Create Date: 2026-09-12 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5c9f7a3b1d8'
down_revision: Union[str, Sequence[str], None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('preferred_projects', sa.Integer(), nullable=True))
    op.add_column('users', sa.Column('preferred_experience', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'preferred_experience')
    op.drop_column('users', 'preferred_projects')
