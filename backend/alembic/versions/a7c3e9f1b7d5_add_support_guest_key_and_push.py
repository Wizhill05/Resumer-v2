"""Add guest support key, rate limits, and push subscriptions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "a7c3e9f1b7d5"
down_revision = "a7c3e9f1b2d4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("support_reports", sa.Column("guest_key_hash", sa.String(), nullable=True))
    op.create_index("ix_support_reports_guest_key_hash", "support_reports", ["guest_key_hash"])
    op.create_table(
        "support_rate_limits",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("request_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reset_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "support_push_subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("support_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("report_id", "endpoint", name="uq_support_push_report_endpoint"),
    )
    op.create_index("ix_support_push_subscriptions_report_id", "support_push_subscriptions", ["report_id"])


def downgrade():
    op.drop_index("ix_support_push_subscriptions_report_id", table_name="support_push_subscriptions")
    op.drop_table("support_push_subscriptions")
    op.drop_table("support_rate_limits")
    op.drop_index("ix_support_reports_guest_key_hash", table_name="support_reports")
    op.drop_column("support_reports", "guest_key_hash")
