"""Add the MCP inference mode and confirmation challenges.

Drain all ``storage_objects`` cleanup tasks before rolling back to a code version
that cannot process that task kind.
"""

import sqlalchemy as sa
from alembic import op

revision = "e4f0c2b6a913"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("inference_mode", sa.String(), nullable=False, server_default="resumer"))
    op.add_column("users", sa.Column("inference_mode_changed_at", sa.DateTime(timezone=True)))
    op.add_column("generations", sa.Column("inference_source", sa.String(), nullable=False, server_default="server"))
    op.add_column("generations", sa.Column("client_model", sa.String()))
    op.create_table(
        "inference_mode_challenges",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_inference_mode_challenges_user_id", "inference_mode_challenges", ["user_id"])


def downgrade() -> None:
    op.execute(
        sa.text("""
            UPDATE generations
            SET status = 'failed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
                error_message = 'Draft abandoned before submission.',
                render_metadata = render_metadata - ARRAY[
                    'client_brief', 'client_draft', 'client_last_report', 'client_claim',
                    'client_best', 'client_latest', 'client_attempts', 'client_unverified_attempts',
                    'client_unverified_revisions', 'client_invalid_submissions', 'client_publish_failures'
                ]
            WHERE status = 'drafting'
        """)
    )
    op.drop_table("inference_mode_challenges")
    op.drop_column("generations", "client_model")
    op.drop_column("generations", "inference_source")
    op.drop_column("users", "inference_mode_changed_at")
    op.drop_column("users", "inference_mode")
