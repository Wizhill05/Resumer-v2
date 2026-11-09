"""identity_provider_lock

Revision ID: f1a2b3c4d5e6
Revises: d9e8f7a6b5c4
Create Date: 2026-11-08 00:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'd9e8f7a6b5c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # fail fast on duplicates before any data change
    conn = op.get_bind()
    dup = conn.execute(
        sa.text("SELECT lower(email) AS e, count(*) AS c FROM users GROUP BY 1 HAVING count(*) > 1 LIMIT 1")
    ).fetchone()
    if dup is not None:
        raise RuntimeError(f"Duplicate lower(email) values exist (e.g. {dup[0]}); resolve duplicates before migrating")

    # users columns
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("signup_completed_at", sa.DateTime(timezone=True), nullable=True))

    # data steps
    # any provider value that is not a real login method (e.g. 'unknown', 'oauth-session',
    # 'oauth-mcp', '') is reset so those users stay unlocked and the first real sign-in claims them
    op.execute(
        "UPDATE users SET provider = NULL "
        "WHERE provider IS NOT NULL AND provider NOT IN ('google', 'github', 'credentials', 'guest')"
    )
    op.execute("UPDATE users SET hashed_password = NULL WHERE coalesce(provider, '') <> 'credentials'")
    op.execute("UPDATE users SET signup_completed_at = now()")
    op.execute("UPDATE users SET email_verified_at = created_at WHERE provider IN ('google', 'github')")

    op.create_table(
        "user_identities",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("provider_account_id", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("provider_login", sa.String(), nullable=True),
        sa.Column("email_at_link", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "provider_account_id", name="uq_user_identities_provider_account"),
        sa.UniqueConstraint("user_id", "provider", name="uq_user_identities_user_provider"),
    )
    op.create_index("ix_user_identities_user_id", "user_identities", ["user_id"])

    op.create_table(
        "github_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("identity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("oauth_app", sa.String(), nullable=False),
        sa.Column("access_token_encrypted", sa.Text(), nullable=False),
        sa.Column("scopes", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["identity_id"], ["user_identities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("identity_id", "oauth_app", name="uq_github_tokens_identity_app"),
    )
    op.create_index("ix_github_tokens_identity_id", "github_tokens", ["identity_id"])

    op.create_table(
        "github_link_states",
        sa.Column("state_hash", sa.String(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("code_verifier", sa.Text(), nullable=False),
        sa.Column("want_private", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("state_hash"),
    )

    op.create_table(
        "email_verifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_verifications_email", "email_verifications", ["email"], unique=True)

    # backfill identities
    op.execute(
        "INSERT INTO user_identities (id, user_id, provider, provider_account_id, kind, email_at_link) "
        "SELECT gen_random_uuid(), id, provider, NULL, 'login', lower(email) FROM users WHERE provider IN ('google', 'github')"
    )

    op.create_index("uq_users_lower_email", "users", [sa.text("lower(email)")], unique=True)


def downgrade() -> None:
    op.drop_index("uq_users_lower_email", table_name="users")
    op.drop_table("email_verifications")
    op.drop_table("github_link_states")
    op.drop_table("github_tokens")
    op.drop_table("user_identities")
    op.drop_column("users", "signup_completed_at")
    op.drop_column("users", "email_verified_at")
