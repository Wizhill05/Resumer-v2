"""add_content_split_to_generations

Revision ID: d2b5f1a9e347
Revises: c1a4e9f20d83
Create Date: 2026-07-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = 'd2b5f1a9e347'
down_revision: Union[str, Sequence[str], None] = 'c1a4e9f20d83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('generations', sa.Column('content_split', JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column('generations', 'content_split')
