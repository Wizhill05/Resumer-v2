"""Default new users and generations to proper mode."""

from alembic import op

revision = "aa1b2c3d4e5f"
down_revision = "c7a1e2f3d4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "preferred_creativity_mode", server_default="proper")
    op.alter_column("generations", "creativity_mode", server_default="proper")


def downgrade() -> None:
    op.alter_column("users", "preferred_creativity_mode", server_default="larp")
    op.alter_column("generations", "creativity_mode", server_default="larp")
