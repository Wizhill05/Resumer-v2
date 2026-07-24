"""add_email_notification_toggles

Revision ID: a1b2c3d4e5f6
Revises: f8a2b7c9d4e5
Create Date: 2026-07-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'f8a2b7c9d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'profiles',
        sa.Column(
            'notify_on_completion',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('true'),
        ),
    )
    op.add_column(
        'generations',
        sa.Column('send_email', sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('generations', 'send_email')
    op.drop_column('profiles', 'notify_on_completion')
