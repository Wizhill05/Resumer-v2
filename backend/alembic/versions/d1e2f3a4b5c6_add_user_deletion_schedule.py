"""Add the account-deletion grace period columns to users, plus account_cleanup_tasks.

deletion_requested_at / deletion_scheduled_for are set when a user asks to delete
their account. Signing in before deletion_scheduled_for clears both (and stamps
deletion_restored_at so the app can say so); after it, the purge job deletes the row.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d1e2f3a4b5c6"
down_revision = "b4d8e2f6a1c9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("deletion_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("deletion_scheduled_for", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("deletion_restored_at", sa.DateTime(timezone=True), nullable=True))
    # The purge job scans only pending rows, so a partial index stays tiny.
    op.create_index(
        "ix_users_deletion_scheduled_for",
        "users",
        ["deletion_scheduled_for"],
        postgresql_where=sa.text("deletion_scheduled_for IS NOT NULL"),
    )
    # External cleanup (PostHog person, GitHub grants) owed for purged accounts.
    op.create_table(
        "account_cleanup_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_account_cleanup_tasks_status", "account_cleanup_tasks", ["status"])


def downgrade():
    op.drop_index("ix_account_cleanup_tasks_status", table_name="account_cleanup_tasks")
    op.drop_table("account_cleanup_tasks")
    op.drop_index("ix_users_deletion_scheduled_for", table_name="users")
    op.drop_column("users", "deletion_restored_at")
    op.drop_column("users", "deletion_scheduled_for")
    op.drop_column("users", "deletion_requested_at")
