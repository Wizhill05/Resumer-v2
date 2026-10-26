"""Add support conversation history and optional bug context."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b6e4f2a8c910"
down_revision = "18d960a407fa"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("support_reports", sa.Column("title", sa.String(200), nullable=True))
    for name in ("where_happened", "steps_to_reproduce", "expected_behavior"):
        op.add_column("support_reports", sa.Column(name, sa.Text(), nullable=True))
    op.create_table(
        "support_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("support_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("author_role", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_support_messages_report_id", "support_messages", ["report_id"])


def downgrade():
    op.drop_table("support_messages")
    for name in ("expected_behavior", "steps_to_reproduce", "where_happened", "title"):
        op.drop_column("support_reports", name)
