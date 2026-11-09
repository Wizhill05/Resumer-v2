"""Add users.onboarding_state for the getting-started guide."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b4d8e2f6a1c9"
down_revision = "c8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("onboarding_state", postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column("users", "onboarding_state")
