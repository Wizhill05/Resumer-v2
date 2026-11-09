"""Drop guest_rate_limits table (replaced by row-counted quota)."""
from alembic import op
import sqlalchemy as sa

revision = "c8e9f0a1b2c3"
down_revision = "a7c3e9f1b7d5"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table("guest_rate_limits")


def downgrade():
    op.create_table(
        "guest_rate_limits",
        sa.Column("token_hash", sa.String(), primary_key=True, nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reset_at", sa.DateTime(timezone=True), nullable=False),
    )
