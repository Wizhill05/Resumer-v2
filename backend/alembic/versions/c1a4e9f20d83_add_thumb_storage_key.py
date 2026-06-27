"""add_thumb_storage_key

Revision ID: c1a4e9f20d83
Revises: b3d348f86f00
Create Date: 2026-06-26 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c1a4e9f20d83'
down_revision: Union[str, Sequence[str], None] = 'b3d348f86f00'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('generations', sa.Column('thumb_storage_key', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('generations', 'thumb_storage_key')
